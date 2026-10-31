import os
import sqlite3
import tempfile

from django.conf import settings
from django.core.management import call_command
from django.db import connection


def add_database_backup(zip_file):
    with tempfile.TemporaryDirectory() as temp_dir:
        if connection.vendor == "sqlite":
            db_path = settings.DATABASES["default"]["NAME"]
            if os.path.isfile(db_path):
                snapshot_path = os.path.join(temp_dir, "db.sqlite3")
                with sqlite3.connect(db_path) as source_db:
                    with sqlite3.connect(snapshot_path) as snapshot_db:
                        source_db.backup(snapshot_db)
                zip_file.write(snapshot_path, arcname="db.sqlite3")

        dump_path = os.path.join(temp_dir, "database.json")
        with open(dump_path, "w", encoding="utf-8") as dump_file:
            call_command(
                "dumpdata",
                "--natural-foreign",
                "--natural-primary",
                exclude=["contenttypes", "auth.permission", "django_q", "sessions"],
                stdout=dump_file,
            )
        zip_file.write(dump_path, arcname="database.json")
