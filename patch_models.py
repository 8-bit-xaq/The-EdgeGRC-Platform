import re

with open("grc-backend/frameworks/models.py", "r") as f:
    content = f.read()

new_logic = """import mimetypes
mimetypes.add_type('application/vnd.ms-outlook', '.msg')
mimetypes.add_type('message/rfc822', '.eml')
mimetypes.add_type('application/x-x509-ca-cert', '.cer')
mimetypes.add_type('application/x-pem-file', '.pem')
mimetypes.add_type('application/pkcs8', '.key')

def validate_secure_upload(upload):
    \"\"\"Validates that the file's extension loosely matches its cryptographic signature to prevent spoofing.\"\"\"
    file_header = upload.read(2048)
    upload.seek(0) 
    
    real_mime_type = magic.from_buffer(file_header, mime=True)
    
    if real_mime_type == 'inode/x-empty':
        return
        
    expected_mime_type, _ = mimetypes.guess_type(upload.name)
    
    if not expected_mime_type:
        return

    if real_mime_type == expected_mime_type:
        return

    if expected_mime_type.startswith('text/'):
        if real_mime_type.startswith('text/') or real_mime_type in ['application/json', 'application/xml', 'application/csv']:
            return

    if real_mime_type == 'application/zip' and expected_mime_type in [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/epub+zip',
        'application/java-archive',
    ]:
        return
        
    if expected_mime_type == 'text/csv' and real_mime_type == 'text/plain':
        return

    ext = os.path.splitext(upload.name)[1].lower()
    raise ValidationError(f"File spoofing detected. A {ext} file should not contain '{real_mime_type}' data.")
"""

# Regex to replace from SECURE_MIME_MAPPING up to the end of validate_secure_upload
pattern = re.compile(r'SECURE_MIME_MAPPING = \{.*?\ndef validate_secure_upload\(upload\):.*?raise ValidationError.*?data\."\)', re.DOTALL)
new_content = pattern.sub(new_logic, content)

with open("grc-backend/frameworks/models.py", "w") as f:
    f.write(new_content)
