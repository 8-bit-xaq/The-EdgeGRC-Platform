from django.test import TestCase
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from unittest.mock import patch
import io
import zipfile

from .models import validate_secure_upload


class SecureUploadValidationTests(TestCase):
    @staticmethod
    def make_docx():
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as document:
            document.writestr("[Content_Types].xml", "<Types/>")
            document.writestr("word/document.xml", "<document/>")
        return content.getvalue()

    @patch("frameworks.models.scan_antivirus_if_available")
    @patch("frameworks.models.magic.from_buffer", return_value="application/octet-stream")
    def test_accepts_valid_docx_package_with_generic_detected_mime(self, _magic, _scan):
        upload = SimpleUploadedFile("evidence.docx", self.make_docx())

        validate_secure_upload(upload)

    @patch("frameworks.models.scan_antivirus_if_available")
    @patch("frameworks.models.magic.from_buffer", return_value="application/octet-stream")
    def test_rejects_non_docx_data_with_docx_extension(self, _magic, _scan):
        upload = SimpleUploadedFile("evidence.docx", b"not a Word document")

        with self.assertRaises(ValidationError):
            validate_secure_upload(upload)
