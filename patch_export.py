import re

with open("grc-backend/frameworks/views.py", "r") as f:
    content = f.read()

task_code = """
def background_audit_pdf_task(export_data, company_name, export_password, logo_data_url):
    import os, uuid
    from django.conf import settings
    from frameworks.services.pdf_generator import generate_audit_pdf
    
    pdf_buffer = generate_audit_pdf(export_data, company_name, export_password, logo_data_url)
    
    RESULTS_DIR = os.path.join(settings.BASE_DIR, 'task_results')
    os.makedirs(RESULTS_DIR, exist_ok=True)
    
    file_path = os.path.join(RESULTS_DIR, f"{uuid.uuid4().hex}.pdf")
    
    with open(file_path, 'wb') as f:
        f.write(pdf_buffer.getvalue())
        
    return {
        'file_path': file_path,
        'filename': 'audit-report.pdf',
        'content_type': 'application/pdf'
    }
"""

# Insert task_code before ExportAuditPackageView
content = content.replace("class ExportAuditPackageView(APIView):", task_code.strip() + "\n\nclass ExportAuditPackageView(APIView):")

# Replace PDF response logic in ExportAuditPackageView
old_pdf = """        if export_format == 'pdf':
            pdf_buffer = generate_audit_pdf(export_data, company_name, export_password, logo_data_url)
            response = HttpResponse(pdf_buffer.getvalue(), content_type='application/pdf')
            response['Content-Disposition'] = 'attachment; filename="audit-report.pdf"'
            return response"""

new_pdf = """        if export_format == 'pdf':
            from django_q.tasks import async_task
            task_id = async_task('frameworks.views.background_audit_pdf_task', export_data, company_name, export_password, logo_data_url)
            return Response({'task_id': task_id})"""

content = content.replace(old_pdf, new_pdf)

with open("grc-backend/frameworks/views.py", "w") as f:
    f.write(content)
