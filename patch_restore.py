import re

with open("grc-backend/frameworks/views.py", "r") as f:
    content = f.read()

task_code = """
def background_restore_task(zip_path):
    import zipfile, os
    from django.conf import settings
    from django.db import connection
    
    try:
        connection.close()
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            file_names = zip_ref.namelist()
            db_path = settings.DATABASES['default']['NAME']
            media_root = os.path.abspath(settings.MEDIA_ROOT)
            
            for name in file_names:
                if name == 'db.sqlite3':
                    with open(db_path, 'wb') as db_file:
                        db_file.write(zip_ref.read(name))
                elif name.startswith('media/'):
                    rel_path = name.replace('media/', '', 1)
                    if rel_path: 
                        target_path = os.path.abspath(os.path.join(media_root, rel_path))
                        if not target_path.startswith(media_root + os.path.sep):
                            raise Exception(f"Security Violation: Path traversal attempt detected with file {name}")
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        with open(target_path, 'wb') as media_file:
                            media_file.write(zip_ref.read(name))
                            
        return {"status": "success"}
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)

class SystemRestoreView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Administrators can restore system backups."}, status=status.HTTP_403_FORBIDDEN)
        
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No backup file provided."}, status=status.HTTP_400_BAD_REQUEST)
        
        if not file_obj.name.endswith('.zip'):
            return Response({"error": "Invalid file format. Please provide a valid ZIP backup."}, status=status.HTTP_400_BAD_REQUEST)

        # Save uploaded file to temp path so worker can read it
        import tempfile, os
        temp_fd, temp_zip_path = tempfile.mkstemp(suffix='.zip')
        with os.fdopen(temp_fd, 'wb') as f:
            for chunk in file_obj.chunks():
                f.write(chunk)
                
        from django_q.tasks import async_task
        task_id = async_task('frameworks.views.background_restore_task', temp_zip_path)
        return Response({'task_id': task_id})
"""

# Replace SystemRestoreView
pattern = re.compile(r'class SystemRestoreView\(APIView\):.*?return Response\(\{"error": f"Failed to restore backup: \{str\(e\)\}"\}, status=status\.HTTP_500_INTERNAL_SERVER_ERROR\)', re.DOTALL)
content = pattern.sub(task_code.strip(), content)

with open("grc-backend/frameworks/views.py", "w") as f:
    f.write(content)
