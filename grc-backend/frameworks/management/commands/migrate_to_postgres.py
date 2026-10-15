import os
import sys
import tempfile
from pathlib import Path
from django.core.management.base import BaseCommand, CommandError
from django.core.management import call_command
from django.conf import settings
from django.db import connection, connections

class Command(BaseCommand):
    help = "Migrates an existing Edge-GRC SQLite database to PostgreSQL."

    def add_arguments(self, parser):
        parser.add_argument('--host', default='127.0.0.1', help='PostgreSQL host (default: 127.0.0.1)')
        parser.add_argument('--port', default='5432', help='PostgreSQL port (default: 5432)')
        parser.add_argument('--db', default='edgegrc', help='PostgreSQL database name (default: edgegrc)')
        parser.add_argument('--user', default='edgegrc_user', help='PostgreSQL user (default: edgegrc_user)')
        parser.add_argument('--password', required=True, help='PostgreSQL password')
        parser.add_argument('--sslmode', default='', help='Optional PostgreSQL sslmode (e.g. require, verify-full)')
        parser.add_argument('--no-prompt', action='store_true', help='Skip interactive confirmation')

    def handle(self, *args, **options):
        host = options['host']
        port = options['port']
        db_name = options['db']
        user = options['user']
        password = options['password']
        sslmode = options['sslmode']

        if connection.vendor != 'sqlite':
            self.stdout.write(self.style.WARNING(f"Current active database is already '{connection.vendor}', not SQLite."))

        self.stdout.write(self.style.NOTICE(f"=== Edge-GRC: SQLite to PostgreSQL Migration ==="))
        self.stdout.write(f"Target Database: {user}@{host}:{port}/{db_name}")

        # 1. Test PostgreSQL Connectivity
        self.stdout.write("Testing PostgreSQL connectivity...")
        try:
            import psycopg2
            conn_params = {
                'dbname': db_name,
                'user': user,
                'password': password,
                'host': host,
                'port': port,
                'connect_timeout': 5,
            }
            if sslmode:
                conn_params['sslmode'] = sslmode
            test_conn = psycopg2.connect(**conn_params)
            test_conn.close()
            self.stdout.write(self.style.SUCCESS("✔ PostgreSQL connection verified successfully."))
        except Exception as e:
            raise CommandError(f"Failed to connect to PostgreSQL: {e}")

        # 2. Dump current SQLite data to temporary file
        temp_dump = tempfile.mktemp(suffix='.json')
        self.stdout.write(f"Exporting data from SQLite to temporary dump...")
        try:
            with open(temp_dump, 'w', encoding='utf-8') as f:
                call_command(
                    'dumpdata',
                    '--natural-foreign',
                    '--natural-primary',
                    exclude=['contenttypes', 'auth.permission'],
                    stdout=f
                )
            self.stdout.write(self.style.SUCCESS(f"✔ SQLite data exported ({os.path.getsize(temp_dump)} bytes)."))
        except Exception as e:
            if os.path.exists(temp_dump):
                os.remove(temp_dump)
            raise CommandError(f"Failed to dump SQLite data: {e}")

        # 3. Create or Update configs/db.env
        configs_dir = Path(settings.BASE_DIR) / 'configs'
        configs_dir.mkdir(parents=True, exist_ok=True)
        db_env_file = configs_dir / 'db.env'

        self.stdout.write(f"Writing configuration to {db_env_file}...")
        env_lines = [
            f"# Edge-GRC Pluggable Database Configuration",
            f"DB_ENGINE=postgres",
            f"POSTGRES_DB={db_name}",
            f"POSTGRES_USER={user}",
            f"POSTGRES_PASSWORD={password}",
            f"POSTGRES_HOST={host}",
            f"POSTGRES_PORT={port}",
        ]
        if sslmode:
            env_lines.append(f"POSTGRES_SSLMODE={sslmode}")

        with open(db_env_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(env_lines) + '\n')

        try:
            os.chmod(db_env_file, 0o600)
        except Exception:
            pass

        self.stdout.write(self.style.SUCCESS(f"✔ Database environment configuration saved."))

        # 4. Dynamically configure default connection to PostgreSQL
        connections.close_all()
        settings.DATABASES['default'] = {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': db_name,
            'USER': user,
            'PASSWORD': password,
            'HOST': host,
            'PORT': str(port),
            'CONN_MAX_AGE': 60,
        }
        if sslmode:
            settings.DATABASES['default']['OPTIONS'] = {'sslmode': sslmode}

        # 5. Run Migrations on PostgreSQL
        self.stdout.write("Applying schema migrations on PostgreSQL...")
        try:
            call_command('migrate', '--noinput')
            self.stdout.write(self.style.SUCCESS("✔ PostgreSQL tables migrated."))
        except Exception as e:
            raise CommandError(f"Failed to run migrations on PostgreSQL: {e}")

        # 6. Load Dumped Data into PostgreSQL
        self.stdout.write("Importing data into PostgreSQL...")
        try:
            call_command('loaddata', temp_dump)
            self.stdout.write(self.style.SUCCESS("✔ Data imported into PostgreSQL."))
        except Exception as e:
            raise CommandError(f"Failed to load data into PostgreSQL: {e}")
        finally:
            if os.path.exists(temp_dump):
                os.remove(temp_dump)

        # 7. Reset PostgreSQL Primary Key Sequences
        self.stdout.write("Resetting PostgreSQL primary key auto-increment sequences...")
        try:
            import io
            out = io.StringIO()
            call_command('sqlsequencereset', 'frameworks', 'auth', stdout=out)
            sql = out.getvalue()
            if sql:
                with connection.cursor() as cursor:
                    cursor.execute(sql)
            self.stdout.write(self.style.SUCCESS("✔ Sequences synchronized."))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Sequence reset warning: {e}"))

        self.stdout.write(self.style.SUCCESS("\n========================================================"))
        self.stdout.write(self.style.SUCCESS("🎉 Migration to PostgreSQL Completed Successfully!"))
        self.stdout.write(self.style.SUCCESS("========================================================"))
        self.stdout.write("To apply the new database configuration to all services, run:")
        self.stdout.write(self.style.NOTICE("  sudo systemctl restart grc-backend grc-worker\n"))
