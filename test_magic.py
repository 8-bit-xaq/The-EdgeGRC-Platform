import magic
import os

SECURE_MIME_MAPPING = {
    'pdf': ['application/pdf'],
    'png': ['image/png'],
    'jpg': ['image/jpeg'],
    'jpeg': ['image/jpeg'],
    'docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
    'xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip'],
    'csv': ['text/csv', 'text/plain'],
    'txt': ['text/plain', 'inode/x-empty'],
    'gif': ['image/gif']
}

with open("test.txt", "wb") as f:
    f.write(b"Hello this is a test text file.\n")

with open("test.txt", "rb") as f:
    file_header = f.read(2048)
    real_mime_type = magic.from_buffer(file_header, mime=True)
    print("Mime type:", real_mime_type)
    ext = 'txt'
    allowed_mimes = SECURE_MIME_MAPPING[ext]
    if real_mime_type not in allowed_mimes:
        print("Spoofing detected!")
    else:
        print("Valid!")
