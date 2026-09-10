import re

with open("grc-backend/frameworks/views.py", "r") as f:
    content = f.read()

task_code = """
import uuid
import os
from django.conf import settings

RESULTS_DIR = os.path.join(settings.BASE_DIR, 'task_results')
os.makedirs(RESULTS_DIR, exist_ok=True)

def background_backup_task():
    import io, sqlite3, tempfile, zipfile
    from django.conf import settings
    zip_buffer = io.BytesIO()
    db_path = settings.DATABASES['default']['NAME']
    temp_fd, temp_db_path = tempfile.mkstemp(suffix='.sqlite3')
    os.close(temp_fd)
    try:
        if os.path.exists(db_path):
            with sqlite3.connect(db_path) as source_db:
                with sqlite3.connect(temp_db_path) as dest_db:
                    source_db.backup(dest_db)
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            if os.path.exists(temp_db_path):
                zip_file.write(temp_db_path, arcname='db.sqlite3')
            media_root = settings.MEDIA_ROOT
            if os.path.exists(media_root):
                for folder_name, subfolders, filenames in os.walk(media_root):
                    for filename in filenames:
                        file_path = os.path.join(folder_name, filename)
                        arcname = os.path.relpath(file_path, media_root)
                        zip_file.write(file_path, arcname=f"media/{arcname}")
    finally:
        if os.path.exists(temp_db_path):
            os.remove(temp_db_path)
            
    from django.utils import timezone
    timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
    filename = f"grc_system_backup_{timestamp}.zip"
    file_path = os.path.join(RESULTS_DIR, f"{uuid.uuid4().hex}.zip")
    
    with open(file_path, 'wb') as f:
        f.write(zip_buffer.getvalue())
        
    return {
        'file_path': file_path,
        'filename': filename,
        'content_type': 'application/zip'
    }

class SystemBackupView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Administrators can generate system backups."}, status=status.HTTP_403_FORBIDDEN)
            
        from django_q.tasks import async_task
        task_id = async_task('frameworks.views.background_backup_task')
        return Response({'task_id': task_id})
"""

# Replace the existing class SystemBackupView
pattern = re.compile(r'class SystemBackupView\(APIView\):.*?return response', re.DOTALL)
content = pattern.sub(task_code.strip(), content)

with open("grc-backend/frameworks/views.py", "w") as f:
    f.write(content)
