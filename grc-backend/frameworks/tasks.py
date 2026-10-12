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
    Creates a full ZIP backup of the SQLite database and media evidence.
    Saves to /opt/grc-appliance/backups/ (or settings.BASE_DIR/backups)
    and retains only the last 7 days of backups to prevent disk exhaustion.
    """
    BACKUPS_DIR = os.path.join(settings.BASE_DIR, 'backups')
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    filename = f"grc_automated_backup_{timestamp}.zip"
    file_path = os.path.join(BACKUPS_DIR, filename)
    
    db_path = settings.DATABASES['default']['NAME']
    temp_fd, temp_db_path = tempfile.mkstemp(suffix='.sqlite3')
    os.close(temp_fd)
    
    try:
        # Safe SQLite backup via backup API
        if os.path.exists(db_path):
            with sqlite3.connect(db_path) as source_db:
                with sqlite3.connect(temp_db_path) as dest_db:
                    source_db.backup(dest_db)
                    
        with zipfile.ZipFile(file_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            if os.path.exists(temp_db_path):
                zip_file.write(temp_db_path, arcname='db.sqlite3')
                
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
                # Use file modification time
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
    1. Truncates and checkpoints the SQLite WAL file to prevent unbounded disk growth.
    2. Runs PRAGMA optimize to refresh query statistics and indexes.
    """
    from django.db import connection
    if connection.vendor == 'sqlite':
        try:
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA wal_checkpoint(TRUNCATE);")
                cursor.execute("PRAGMA optimize;")
            return "SQLite WAL successfully checkpointed and query planner optimized."
        except Exception as e:
            return f"Database maintenance error: {e}"
    return "Non-sqlite database; maintenance skipped."

