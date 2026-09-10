import mimetypes

def check(filename, real_mime_type):
    expected_mime_type, _ = mimetypes.guess_type(filename)
    if not expected_mime_type:
        return True
    if real_mime_type == expected_mime_type:
        return True
    if expected_mime_type.startswith('text/'):
        if real_mime_type.startswith('text/') or real_mime_type in ['application/json', 'application/xml', 'application/csv']:
            return True
    if real_mime_type == 'application/zip' and expected_mime_type in [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]:
        return True
    return False

print("txt with pdf:", check("test.txt", "application/pdf")) # False
print("txt with text:", check("test.txt", "text/plain")) # True
print("docx with zip:", check("test.docx", "application/zip")) # True
print("png with exe:", check("test.png", "application/x-dosexec")) # False
print("msg with anything:", check("test.msg", "application/pdf")) # True (since expected is None)
