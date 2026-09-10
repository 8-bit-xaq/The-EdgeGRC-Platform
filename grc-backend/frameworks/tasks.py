import os
import io
import uuid
import zipfile
import shutil
from django.conf import settings
from .views import generate_audit_pdf, create_system_backup, execute_system_update

RESULTS_DIR = os.path.join(settings.BASE_DIR, 'task_results')
os.makedirs(RESULTS_DIR, exist_ok=True)

def generate_pdf_task(export_data, company_name, export_password, logo_data_url):
    pdf_buffer = generate_audit_pdf(export_data, company_name, export_password, logo_data_url)
    
    file_id = f"audit_report_{uuid.uuid4().hex}.pdf"
    file_path = os.path.join(RESULTS_DIR, file_id)
    
    with open(file_path, 'wb') as f:
        f.write(pdf_buffer.getvalue())
        
    return {
        'file_path': file_path,
        'filename': 'audit-report.pdf',
        'content_type': 'application/pdf'
    }

def system_backup_task():
    buffer = create_system_backup()
    
    file_id = f"backup_{uuid.uuid4().hex}.zip"
    file_path = os.path.join(RESULTS_DIR, file_id)
    
    with open(file_path, 'wb') as f:
        f.write(buffer.getvalue())
        
    return {
        'file_path': file_path,
        'filename': file_id,
        'content_type': 'application/zip'
    }

def system_restore_task(temp_zip_path):
    # Execute the update logic
    execute_system_update(temp_zip_path)
    # Cleanup
    if os.path.exists(temp_zip_path):
        os.remove(temp_zip_path)
    return {'status': 'success'}
