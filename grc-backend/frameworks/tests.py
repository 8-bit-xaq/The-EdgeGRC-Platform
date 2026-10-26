from django.test import SimpleTestCase, TestCase
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.models import User
from unittest.mock import Mock, patch
import io
import zipfile
from types import SimpleNamespace

from .models import AssessmentActivity, Control, validate_secure_upload
from .permissions import ControlMatrixPermissions, EvidenceUploadPermissions, TestPlanPermissions


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


class ControlQaLockPermissionTests(SimpleTestCase):
    @staticmethod
    def make_user(role):
        return SimpleNamespace(is_superuser=False, profile=SimpleNamespace(role=role))

    @staticmethod
    def make_control():
        control = SimpleNamespace(
            status="Ready for Audit",
            evidence="existing evidence",
            control_effectiveness="Not Tested",
            implementation_effectiveness="Not Tested",
        )
        control.assessments = Mock()
        control.assessments.filter.return_value.exists.return_value = True
        return control

    def test_only_qa_reviewer_can_edit_control_during_qa_review(self):
        control = self.make_control()
        control.status = "Awaiting Approval"
        view = SimpleNamespace()

        for role in ("Contributor", "Auditor"):
            request = SimpleNamespace(method="PATCH", user=self.make_user(role), data={})
            self.assertFalse(ControlMatrixPermissions().has_object_permission(request, view, control))

        reviewer_request = SimpleNamespace(method="PATCH", user=self.make_user("Reviewer"), data={})
        self.assertTrue(ControlMatrixPermissions().has_object_permission(reviewer_request, view, control))

        admin_request = SimpleNamespace(method="PATCH", user=self.make_user("Admin"), data={})
        self.assertTrue(ControlMatrixPermissions().has_object_permission(admin_request, view, control))

    def test_auditor_cannot_edit_submitted_control_before_qa_review(self):
        control = self.make_control()
        control.assessments.filter.return_value.exists.return_value = False
        request = SimpleNamespace(method="PATCH", user=self.make_user("Auditor"), data={})

        self.assertFalse(ControlMatrixPermissions().has_object_permission(request, SimpleNamespace(), control))

    def test_contributor_cannot_delete_proof_while_submitted_for_audit(self):
        control = self.make_control()
        proof = SimpleNamespace(control=control)
        request = SimpleNamespace(method="DELETE", user=self.make_user("Contributor"))

        self.assertFalse(EvidenceUploadPermissions().has_object_permission(request, SimpleNamespace(), proof))

    def test_auditor_cannot_edit_test_plan_while_submitted_for_audit(self):
        control = self.make_control()
        test_plan = SimpleNamespace(control=control)
        request = SimpleNamespace(method="PATCH", user=self.make_user("Auditor"))

        self.assertFalse(TestPlanPermissions().has_object_permission(request, SimpleNamespace(), test_plan))


class RejectedAssessmentControlStateTests(TestCase):
    def test_rejection_returns_control_to_failing_for_contributor_corrections(self):
        control = Control.objects.create(
            control_id="QA-REJECT-1",
            description="Test control",
            status="Awaiting Approval",
        )
        assessor = User.objects.create_user(username="qa-reject-assessor")
        assessment = AssessmentActivity.objects.create(
            control=control,
            assessor=assessor,
            status="In QA Review",
        )

        assessment.status = "In Progress"
        assessment.save(update_fields=["status"])

        control.refresh_from_db()
        self.assertEqual(control.status, "Failing")
        request = SimpleNamespace(
            method="PATCH",
            user=SimpleNamespace(is_superuser=False, profile=SimpleNamespace(role="Contributor")),
            data={},
        )
        self.assertTrue(ControlMatrixPermissions().has_object_permission(request, SimpleNamespace(), control))
