from django.apps import AppConfig
from django.db.models.signals import post_migrate
from django.db.backends.signals import connection_created

def configure_sqlite_wal(sender, connection, **kwargs):
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=20000;')
        cursor.close()

def create_factory_default_admin(sender, **kwargs):
    from django.contrib.auth.models import User
    from django.conf import settings
    import os
    import secrets
    import string
    
    if not User.objects.exists():
        initial_pw_paths = [
            os.path.join(settings.BASE_DIR, 'INITIAL_ADMIN_PASSWORD'),
            '/opt/grc-appliance/INITIAL_ADMIN_PASSWORD',
        ]
        admin_pw = None
        for p in initial_pw_paths:
            if os.path.exists(p):
                try:
                    with open(p, 'r') as f:
                        content = f.read().strip()
                        if content:
                            admin_pw = content
                            break
                except Exception:
                    pass

        if not admin_pw:
            alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
            admin_pw = ''.join(secrets.choice(alphabet) for _ in range(16))
            default_path = os.path.join(settings.BASE_DIR, 'INITIAL_ADMIN_PASSWORD')
            try:
                with open(default_path, 'w') as f:
                    f.write(admin_pw + "\n")
                os.chmod(default_path, 0o600)
            except Exception:
                pass

        user = User.objects.create_superuser(
            username='admin',
            email='admin@localhost',
            password=admin_pw
        )
        
        # The post_save signal in models.py automatically creates the UserProfile.
        # Escalate its role to Admin and require mandatory password change.
        profile = user.profile
        profile.role = 'Admin'
        profile.must_change_password = True
        profile.save()
        print("\n*** FACTORY DEFAULT APPLIANCE ACCOUNT CREATED ***")
        print("Username: admin")
        print(f"Password: {admin_pw}")
        print("Note: Mandatory password change required on first login.\n")

def schedule_system_tasks(sender, **kwargs):
    from django_q.models import Schedule
    import sys
    
    # Don't try to schedule tasks if we're just running a quick management command like makemigrations
    if 'migrate' not in sys.argv and 'runserver' not in sys.argv and 'qcluster' not in sys.argv:
        return
        
    try:
        # Schedule the backup to run daily at 2:00 AM
        if not Schedule.objects.filter(func='frameworks.tasks.automated_nightly_backup').exists():
            Schedule.objects.create(
                func='frameworks.tasks.automated_nightly_backup',
                schedule_type=Schedule.DAILY,
                repeats=-1,
                time='02:00'
            )
            print("Configured automated nightly backups (2:00 AM).")

        # Schedule weekly database maintenance (Sundays at 3:00 AM)
        if not Schedule.objects.filter(func='frameworks.tasks.maintain_database').exists():
            Schedule.objects.create(
                func='frameworks.tasks.maintain_database',
                schedule_type=Schedule.WEEKLY,
                repeats=-1,
                time='03:00'
            )
            print("Configured automated weekly database maintenance (Sunday 3:00 AM).")
    except Exception:
        # DB might not be ready during initial startup/migrations
        pass

class FrameworksConfig(AppConfig):
    name = 'frameworks'

    def ready(self):
        post_migrate.connect(create_factory_default_admin, sender=self)
        post_migrate.connect(schedule_system_tasks, sender=self)
        connection_created.connect(configure_sqlite_wal)