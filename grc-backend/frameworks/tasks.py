"""
Edge-GRC Django-Q Background Tasks.

Scheduled jobs executed by `grc-worker` (qcluster):
- `automated_nightly_backup`: Full database snapshot + media backup with 7-day retention policy.
- Automated audit schedule processing & recurring compliance cycle advancement.
"""

import os
import zipfile
from datetime import timedelta
from django.conf import settings
from django.utils import timezone

def automated_nightly_backup():
    """
    Creates a full ZIP backup of the active database (SQLite or PostgreSQL) and media evidence.
    Saves to /opt/grc-appliance/backups/ (or settings.BASE_DIR/backups)
    and retains only the last 7 days of backups to prevent disk exhaustion.
    """
    from .database_backup import add_database_backup

    BACKUPS_DIR = os.path.join(settings.BASE_DIR, 'backups')
    os.makedirs(BACKUPS_DIR, exist_ok=True)
    
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    filename = f"grc_automated_backup_{timestamp}.zip"
    file_path = os.path.join(BACKUPS_DIR, filename)

    try:
        with zipfile.ZipFile(file_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            add_database_backup(zip_file)
                
            media_root = settings.MEDIA_ROOT
            if os.path.exists(media_root):
                for folder_name, subfolders, filenames in os.walk(media_root):
                    for fname in filenames:
                        f_path = os.path.join(folder_name, fname)
                        arcname = os.path.relpath(f_path, media_root)
                        zip_file.write(f_path, arcname=f"media/{arcname}")
    except Exception:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise
            
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
