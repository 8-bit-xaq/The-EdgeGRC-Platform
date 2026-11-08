from django.test import SimpleTestCase, TestCase
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.contrib.auth.models import User
from pathlib import Path
from rest_framework import serializers
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import Mock, patch
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa, utils as asym_utils
import io
import json
import sqlite3
import tempfile
import zipfile
from types import SimpleNamespace

from .models import AssessmentActivity, Control, RemediationTask, validate_secure_upload
from .log_sanitizer import sanitize_log_line
from .serializers import RemediationTaskSerializer
from .views import (
    DeviceLogView,
    FrameworkLibraryFileView,
    FrameworkLibraryView,
    MainBranchUpdateView,
    UpdatePackageError,
    _verify_and_start_update,
    execute_system_update,
)
from .database_backup import add_database_backup
from .permissions import (
    AssessmentPermissions,
    ControlMatrixPermissions,
    EvidenceUploadPermissions,
    RemediationTaskPermissions,
    RiskPermissions,
    TestPlanPermissions,
)


class DatabaseBackupArchiveTests(SimpleTestCase):
    def test_sqlite_backup_contains_native_snapshot_and_portable_data(self):
        archive_buffer = io.BytesIO()

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "source.sqlite3"
            with sqlite3.connect(db_path) as source_db:
                source_db.execute("CREATE TABLE backup_test (value TEXT)")
                source_db.execute("INSERT INTO backup_test VALUES ('preserved')")

            with (
                patch("frameworks.database_backup.connection") as db_connection,
                patch("frameworks.database_backup.settings.DATABASES", {"default": {"NAME": db_path}}),
                patch("frameworks.database_backup.call_command") as dumpdata,
            ):
                db_connection.vendor = "sqlite"
                dumpdata.side_effect = lambda *args, **kwargs: kwargs["stdout"].write("[]")
                with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                    add_database_backup(archive)

        with zipfile.ZipFile(archive_buffer) as archive:
            self.assertCountEqual(archive.namelist(), ["db.sqlite3", "database.json"])
            with tempfile.NamedTemporaryFile(suffix=".sqlite3") as restored_db:
                restored_db.write(archive.read("db.sqlite3"))
                restored_db.flush()
                with sqlite3.connect(restored_db.name) as snapshot:
                    result = snapshot.execute("SELECT value FROM backup_test").fetchone()
            self.assertEqual(result, ("preserved",))
        dumpdata.assert_called_once()

    def test_postgresql_backup_contains_portable_database_data(self):
        archive_buffer = io.BytesIO()

        with (
            patch("frameworks.database_backup.connection") as db_connection,
            patch("frameworks.database_backup.call_command") as dumpdata,
        ):
            db_connection.vendor = "postgresql"
            dumpdata.side_effect = lambda *args, **kwargs: kwargs["stdout"].write("[]")
            with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                add_database_backup(archive)

        with zipfile.ZipFile(archive_buffer) as archive:
            self.assertEqual(archive.namelist(), ["database.json"])
            self.assertEqual(archive.read("database.json"), b"[]")
        dumpdata.assert_called_once()

    def test_database_dump_failure_is_propagated(self):
        archive_buffer = io.BytesIO()

        with (
            patch("frameworks.database_backup.connection") as db_connection,
            patch(
                "frameworks.database_backup.call_command",
                side_effect=RuntimeError("database export failed"),
            ),
        ):
            db_connection.vendor = "postgresql"
            with zipfile.ZipFile(archive_buffer, "w", zipfile.ZIP_DEFLATED) as archive:
                with self.assertRaisesMessage(RuntimeError, "database export failed"):
                    add_database_backup(archive)


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


class DeviceLogViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="device-log-admin")
        self.admin.profile.role = "Admin"
        self.admin.profile.save()
        self.auditor = User.objects.create_user(username="device-log-auditor")
        self.auditor.profile.role = "Auditor"
        self.auditor.profile.save()
        self.factory = APIRequestFactory()

    def test_admin_can_read_backend_log_lines(self):
        with tempfile.TemporaryDirectory() as log_dir:
            log_path = Path(log_dir) / "grc-backend.log"
            log_path.write_text(
                "INFO startup\nWARNING delayed task\n"
                "ERROR password=secret-pass Authorization: Bearer abc.def "
                "email=user@example.com remote_addr=192.0.2.10\n",
                encoding="utf-8",
            )
            with patch("frameworks.views.settings.LOGS_DIR", Path(log_dir)):
                request = self.factory.get("/api/system/device-logs/")
                force_authenticate(request, user=self.admin)
                response = DeviceLogView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["logs"][:2], ["INFO startup", "WARNING delayed task"])
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(response.data["view"], "sanitized")
        sanitized_line = response.data["logs"][2]
        for sensitive_value in ("secret-pass", "abc.def", "user@example.com", "192.0.2.10"):
            self.assertNotIn(sensitive_value, sanitized_line)
        self.assertIn("password=[REDACTED]", sanitized_line)
        self.assertIn("Authorization: [REDACTED]", sanitized_line)
        self.assertIn("email=[REDACTED]", sanitized_line)
        self.assertIn("remote_addr=[REDACTED]", sanitized_line)

    def test_admin_receives_only_the_latest_500_lines(self):
        with tempfile.TemporaryDirectory() as log_dir:
            log_path = Path(log_dir) / "grc-backend.log"
            log_path.write_text("".join(f"line {number}\n" for number in range(501)), encoding="utf-8")
            with patch("frameworks.views.settings.LOGS_DIR", Path(log_dir)):
                request = self.factory.get("/api/system/device-logs/")
                force_authenticate(request, user=self.admin)
                response = DeviceLogView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 500)
        self.assertEqual(response.data["logs"][0], "line 1")
        self.assertEqual(response.data["logs"][-1], "line 500")
        self.assertTrue(response.data["truncated"])

    def test_admin_can_request_explicit_unsanitized_logs(self):
        raw_line = "ERROR user=alice@example.com password=secret"
        with tempfile.TemporaryDirectory() as log_dir:
            log_path = Path(log_dir) / "grc-backend.log"
            log_path.write_text(raw_line, encoding="utf-8")
            with patch("frameworks.views.settings.LOGS_DIR", Path(log_dir)):
                request = self.factory.get("/api/system/device-logs/?view=unsanitized")
                force_authenticate(request, user=self.admin)
                response = DeviceLogView.as_view()(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["view"], "unsanitized")
        self.assertEqual(response.data["logs"], [raw_line])

    def test_non_admin_cannot_read_backend_logs(self):
        request = self.factory.get("/api/system/device-logs/?view=unsanitized")
        force_authenticate(request, user=self.auditor)

        response = DeviceLogView.as_view()(request)

        self.assertEqual(response.status_code, 403)

    def test_sanitizer_redacts_url_credentials_tokens_and_identifiers(self):
        line = (
            "connect https://alice:secret@appliance.local "
            "grc_token=abc123 username=alice contact alice@example.com "
            "peer=2001:db8::1"
        )

        sanitized = sanitize_log_line(line)

        for sensitive_value in (
            "alice:secret",
            "abc123",
            "username=alice",
            "alice@example.com",
            "2001:db8::1",
        ):
            self.assertNotIn(sensitive_value, sanitized)
        self.assertIn("https://[REDACTED]@appliance.local", sanitized)
        self.assertIn("peer=[REDACTED_IP]", sanitized)


class FrameworkLibraryViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="framework-library-admin")
        self.admin.profile.role = "Admin"
        self.admin.profile.save()
        self.auditor = User.objects.create_user(username="framework-library-auditor")
        self.auditor.profile.role = "Auditor"
        self.auditor.profile.save()
        self.factory = APIRequestFactory()

    def make_request(self, view, user, path, framework_id=None):
        request = self.factory.get(path)
        force_authenticate(request, user=user)
        if framework_id is None:
            return view.as_view()(request)
        return view.as_view()(request, framework_id=framework_id)

    def test_admin_lists_bundled_framework_metadata(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            app_root = Path(temp_dir) / "appliance"
            library = app_root / "Frameworks"
            library.mkdir(parents=True)
            (library / "pci-dss.json").write_text(
                json.dumps({
                    "framework": "PCI DSS v4",
                    "description": "Payment card security",
                    "controls": [{"id": "1.1"}, {"id": "1.2"}],
                }),
                encoding="utf-8",
            )
            (library / "notes.txt").write_text("not a framework", encoding="utf-8")
            with patch("frameworks.views.settings.BASE_DIR", app_root / "grc-backend"):
                response = self.make_request(
                    FrameworkLibraryView,
                    self.admin,
                    "/api/framework-library/",
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data["frameworks"],
            [{
                "id": "pci-dss",
                "name": "PCI DSS v4",
                "description": "Payment card security",
                "item_count": 2,
            }],
        )

    def test_admin_can_load_framework_file_for_import(self):
        definition = {"framework": "PCI DSS", "controls": [{"id": "1.1"}]}
        with tempfile.TemporaryDirectory() as temp_dir:
            app_root = Path(temp_dir) / "appliance"
            library = app_root / "Frameworks"
            library.mkdir(parents=True)
            (library / "pci-dss.json").write_text(json.dumps(definition), encoding="utf-8")
            with patch("frameworks.views.settings.BASE_DIR", app_root / "grc-backend"):
                response = self.make_request(
                    FrameworkLibraryFileView,
                    self.admin,
                    "/api/framework-library/pci-dss/",
                    "pci-dss",
                )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, definition)

    def test_non_admin_cannot_access_framework_library(self):
        response = self.make_request(
            FrameworkLibraryView,
            self.auditor,
            "/api/framework-library/",
        )

        self.assertEqual(response.status_code, 403)

    def test_missing_library_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as temp_dir, patch(
            "frameworks.views.settings.BASE_DIR", Path(temp_dir) / "grc-backend"
        ):
            response = self.make_request(
                FrameworkLibraryView,
                self.admin,
                "/api/framework-library/",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["frameworks"], [])

    def test_framework_id_cannot_traverse_outside_library(self):
        response = self.make_request(
            FrameworkLibraryFileView,
            self.admin,
            "/api/framework-library/..%2Fsecret/",
            "../secret",
        )

        self.assertEqual(response.status_code, 404)


class MainBranchUpdateViewTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="main-update-admin")
        self.admin.profile.role = "Admin"
        self.admin.profile.save()
        self.auditor = User.objects.create_user(username="main-update-auditor")
        self.auditor.profile.role = "Auditor"
        self.auditor.profile.save()
        self.factory = APIRequestFactory()
        self.commit = "a" * 40

    def make_request(self, method, user, data=None):
        if method == "get":
            request = self.factory.get("/api/update/main/")
        else:
            request = self.factory.post("/api/update/main/", data, format="json")
        force_authenticate(request, user=user)
        return MainBranchUpdateView.as_view()(request)

    @patch("frameworks.views._get_main_update_asset", return_value="https://github.com/download")
    @patch("frameworks.views._get_installed_commit", return_value=None)
    @patch("frameworks.views._get_main_commit")
    def test_admin_check_reports_signed_update_for_latest_main_commit(
        self, get_main_commit, _get_installed_commit, _get_asset
    ):
        get_main_commit.return_value = self.commit

        response = self.make_request("get", self.admin)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["available"])
        self.assertEqual(response.data["commit"], self.commit)

    @patch("frameworks.views._get_main_commit")
    def test_non_admin_cannot_check_for_updates(self, get_main_commit):
        response = self.make_request("get", self.auditor)

        self.assertEqual(response.status_code, 403)
        get_main_commit.assert_not_called()

    @patch("frameworks.views._get_main_commit")
    def test_install_requires_explicit_backup_confirmation(self, get_main_commit):
        response = self.make_request(
            "post",
            self.admin,
            {"confirm_backup": False, "expected_commit": self.commit},
        )

        self.assertEqual(response.status_code, 400)
        get_main_commit.assert_not_called()

    @patch("frameworks.views._get_main_commit", return_value="b" * 40)
    def test_install_rejects_main_commit_changed_since_check(self, get_main_commit):
        response = self.make_request(
            "post",
            self.admin,
            {"confirm_backup": True, "expected_commit": self.commit},
        )

        self.assertEqual(response.status_code, 409)
        get_main_commit.assert_called_once()

    @patch("frameworks.views._verify_and_start_update")
    @patch("frameworks.views._download_main_update", return_value="/tmp/main-update.zip")
    @patch("frameworks.views._get_main_update_asset", return_value="https://github.com/download")
    @patch("frameworks.views._get_installed_commit", return_value=None)
    @patch("frameworks.views._get_main_commit")
    def test_confirmed_install_downloads_and_verifies_signed_package(
        self,
        get_main_commit,
        _get_installed_commit,
        _get_asset,
        download_update,
        verify_update,
    ):
        get_main_commit.return_value = self.commit

        with tempfile.TemporaryDirectory() as temp_dir, patch(
            "frameworks.views.settings.BASE_DIR", Path(temp_dir) / "grc-backend"
        ):
            response = self.make_request(
                "post",
                self.admin,
                {"confirm_backup": True, "expected_commit": self.commit},
            )

        self.assertEqual(response.status_code, 200)
        download_update.assert_called_once()
        verify_update.assert_called_once_with(
            "/tmp/main-update.zip",
            expected_commit=self.commit,
        )


class SignedUpdateVerificationTests(SimpleTestCase):
    def create_signed_package(self, root, payload_bytes=b"trusted payload", signed_payload=None):
        config_dir = root / "configs"
        config_dir.mkdir()
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        (config_dir / "update_pub.pem").write_bytes(public_key)

        payload_digest = hashes.Hash(hashes.SHA256())
        payload_digest.update(signed_payload if signed_payload is not None else payload_bytes)
        signature = private_key.sign(
            payload_digest.finalize(),
            padding.PKCS1v15(),
            asym_utils.Prehashed(hashes.SHA256()),
        )
        package_path = root / "update.zip"
        with zipfile.ZipFile(package_path, "w") as archive:
            archive.writestr("payload.zip", payload_bytes)
            archive.writestr("signature.sig", signature)
        return package_path

    @staticmethod
    def make_main_payload(commit):
        payload = io.BytesIO()
        with zipfile.ZipFile(payload, "w") as archive:
            archive.writestr(
                "grc-frontend/public/version.json",
                f'{{"version":"1.0.0","commit":"{commit}"}}',
            )
        return payload.getvalue()

    def test_valid_signature_and_commit_schedules_verified_main_update(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            commit = "c" * 40
            payload_bytes = self.make_main_payload(commit)
            package_path = self.create_signed_package(root, payload_bytes=payload_bytes)
            with (
                patch("frameworks.views.settings.BASE_DIR", root),
                patch("frameworks.views.threading.Thread") as thread,
            ):
                _verify_and_start_update(str(package_path), expected_commit=commit)

            thread.assert_called_once()
            self.assertIs(thread.call_args.kwargs["target"], execute_system_update)
            self.assertEqual(thread.call_args.kwargs["args"][1], str(root.parent))
            thread.return_value.start.assert_called_once()
            verified_payload = Path(thread.call_args.kwargs["args"][0])
            self.assertEqual(verified_payload.read_bytes(), payload_bytes)
            verified_payload.unlink()

    def test_invalid_signature_is_rejected_and_staged_payload_removed(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_path = self.create_signed_package(root, signed_payload=b"other payload")
            with (
                patch("frameworks.views.settings.BASE_DIR", root),
                patch("frameworks.views.threading.Thread") as thread,
            ):
                with self.assertRaises(UpdatePackageError) as error:
                    _verify_and_start_update(str(package_path))

            self.assertEqual(error.exception.status_code, 403)
            thread.assert_not_called()
            self.assertEqual(
                {path.name for path in root.iterdir()},
                {"configs", "update.zip"},
            )

    def test_signed_package_for_different_commit_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            package_path = self.create_signed_package(
                root,
                payload_bytes=self.make_main_payload("a" * 40),
            )
            with (
                patch("frameworks.views.settings.BASE_DIR", root),
                patch("frameworks.views.threading.Thread") as thread,
            ):
                with self.assertRaises(UpdatePackageError) as error:
                    _verify_and_start_update(str(package_path), expected_commit="b" * 40)

            self.assertEqual(error.exception.status_code, 403)
            thread.assert_not_called()
            self.assertEqual(
                {path.name for path in root.iterdir()},
                {"configs", "update.zip"},
            )


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


class RolePermissionAlignmentTests(SimpleTestCase):
    @staticmethod
    def make_user(role, user_id=1):
        return SimpleNamespace(
            id=user_id,
            is_superuser=role == "Admin",
            is_authenticated=True,
            profile=SimpleNamespace(role=role),
        )

    def test_executives_cannot_write_risks(self):
        request = SimpleNamespace(method="POST", user=self.make_user("Executive"))

        self.assertFalse(RiskPermissions().has_permission(request, SimpleNamespace()))

    def test_reviewers_cannot_create_assessments_but_can_update_qa(self):
        reviewer = self.make_user("Reviewer")
        permissions = AssessmentPermissions()
        view = SimpleNamespace()
        assessment = SimpleNamespace(status="In QA Review", assessor_id=2)

        self.assertFalse(permissions.has_permission(SimpleNamespace(method="POST", user=reviewer), view))
        self.assertTrue(permissions.has_permission(SimpleNamespace(method="PATCH", user=reviewer), view))
        self.assertTrue(permissions.has_object_permission(
            SimpleNamespace(method="PATCH", user=reviewer, data={"status": "Completed"}),
            view,
            assessment,
        ))

    def test_assessors_cannot_approve_their_own_assessment(self):
        reviewer = self.make_user("Reviewer", user_id=12)
        assessment = SimpleNamespace(status="In QA Review", assessor_id=12)
        request = SimpleNamespace(method="PATCH", user=reviewer, data={"status": "Completed"})

        self.assertFalse(AssessmentPermissions().has_object_permission(request, SimpleNamespace(), assessment))

    def test_admin_cannot_approve_their_own_assessment(self):
        admin = self.make_user("Admin", user_id=12)
        assessment = SimpleNamespace(status="In QA Review", assessor_id=12)
        request = SimpleNamespace(method="PATCH", user=admin, data={"status": "Completed"})

        self.assertFalse(AssessmentPermissions().has_object_permission(request, SimpleNamespace(), assessment))

    def test_assigned_contributor_can_only_update_their_task(self):
        contributor = self.make_user("Contributor", user_id=25)
        assigned_task = SimpleNamespace(assigned_to=contributor)
        other_task = SimpleNamespace(assigned_to=self.make_user("Contributor", user_id=26))
        permission = RemediationTaskPermissions()
        view = SimpleNamespace()
        request = SimpleNamespace(method="PATCH", user=contributor)

        self.assertTrue(permission.has_permission(request, view))
        self.assertTrue(permission.has_object_permission(request, view, assigned_task))
        self.assertFalse(permission.has_object_permission(request, view, other_task))

    def test_contributor_task_serializer_accepts_status_only(self):
        contributor = self.make_user("Contributor", user_id=25)
        task = RemediationTask(assigned_to_id=25, status="Open")
        task.save = Mock()
        serializer = RemediationTaskSerializer(
            task,
            data={"status": "In Progress"},
            partial=True,
            context={"request": SimpleNamespace(user=contributor)},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        self.assertEqual(task.status, "In Progress")

    def test_contributor_task_serializer_rejects_other_fields(self):
        contributor = self.make_user("Contributor", user_id=25)
        task = RemediationTask(assigned_to_id=25, status="Open")
        serializer = RemediationTaskSerializer(
            task,
            data={"title": "Changed task title"},
            partial=True,
            context={"request": SimpleNamespace(user=contributor)},
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        with self.assertRaises(serializers.ValidationError):
            serializer.save()
