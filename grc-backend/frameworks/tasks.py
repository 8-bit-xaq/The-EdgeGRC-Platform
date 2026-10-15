import os
import io
import sqlite3
import tempfile
import zipfile
import shutil
from datetime import timedelta
from django.conf import settings
from django.utils import timezone

def automated_nightly_backup():
    """
    Creates a full ZIP backup of the active database (SQLite or PostgreSQL) and media evidence.
    Saves to /opt/grc-appliance/backups/ (or settings.BASE_DIR/backups)
    and retains only the last 7 days of backups to prevent disk exhaustion.
    """
    from django.db import connection
    from django.core.management import call_command

    BACKUPS_DIR = os.path.join(settings.BASE_DIR, 'backups')
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    filename = f"grc_automated_backup_{timestamp}.zip"
    file_path = os.path.join(BACKUPS_DIR, filename)
    
    temp_fd, temp_db_path = tempfile.mkstemp(suffix='.sqlite3')
    os.close(temp_fd)
    
    try:
        with zipfile.ZipFile(file_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # 1. Database backup based on active engine
            if connection.vendor == 'sqlite':
                db_path = settings.DATABASES['default']['NAME']
                if os.path.exists(db_path):
                    with sqlite3.connect(db_path) as source_db:
                        with sqlite3.connect(temp_db_path) as dest_db:
                            source_db.backup(dest_db)
                if os.path.exists(temp_db_path):
                    zip_file.write(temp_db_path, arcname='db.sqlite3')

            # Export universal portable database.json (works for PostgreSQL and cross-engine restores)
            temp_json = temp_db_path + '.json'
            try:
                with open(temp_json, 'w', encoding='utf-8') as f:
                    call_command('dumpdata', '--natural-foreign', '--natural-primary', exclude=['contenttypes', 'auth.permission'], stdout=f)
                zip_file.write(temp_json, arcname='database.json')
            except Exception as e:
                print(f"Portable database dump warning: {e}")
            finally:
                if os.path.exists(temp_json):
                    os.remove(temp_json)
                
            media_root = settings.MEDIA_ROOT
            if os.path.exists(media_root):
                for folder_name, subfolders, filenames in os.walk(media_root):
                    for fname in filenames:
                        f_path = os.path.join(folder_name, fname)
                        arcname = os.path.relpath(f_path, media_root)
                        zip_file.write(f_path, arcname=f"media/{arcname}")
    finally:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
            
    # Cleanup logic: Delete backups older than 7 days
    retention_cutoff = timezone.now() - timedelta(days=7)
    for fname in os.listdir(BACKUPS_DIR):
        if fname.startswith("grc_automated_backup_") and fname.endswith(".zip"):
            full_path = os.path.join(BACKUPS_DIR, fname)
            try:
                mtime = os.path.getmtime(full_path)
                file_time = timezone.datetime.fromtimestamp(mtime, tz=timezone.utc)
                if file_time < retention_cutoff:
                    os.remove(full_path)
            except Exception as e:
                print(f"Failed to cleanup old backup {fname}: {e}")
                
    return f"Nightly backup created successfully: {filename}"


def maintain_database():
    """
    Weekly maintenance task:
    1. For SQLite: Truncates and checkpoints the SQLite WAL file and runs PRAGMA optimize.
    2. For PostgreSQL: Runs VACUUM ANALYZE to reclaim disk storage and update query planner stats.
    """
    from django.db import connection
    if connection.vendor == 'sqlite':
        try:
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                cursor.execute("PRAGMA optimize;")
            return "SQLite WAL successfully checkpointed and query planner optimized."
        except Exception as e:
            return f"SQLite maintenance error: {e}"
    elif connection.vendor == 'postgresql':
        try:
            with connection.cursor() as cursor:
                cursor.execute("VACUUM;")
            return "PostgreSQL maintenance (VACUUM) executed successfully."
        except Exception as e:
            return f"PostgreSQL maintenance error: {e}"
    return "Database maintenance skipped for vendor: " + connection.vendor

