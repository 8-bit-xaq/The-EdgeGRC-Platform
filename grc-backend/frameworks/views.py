"""
Edge-GRC API Views & Controllers.

Orchestrates all appliance HTTP endpoints including:
- Compliance Matrix (Controls, Test Plans, Proof Uploads, Assessments)
- Risk Management & Remediation Tasks (POA&M)
- Identity & RBAC (Authentication, Sessions, User Profiles)
- Appliance Operations (Backups, System Updates, HTTPS/SSL, Health Checks, Factory Reset)
- Export Pipeline (Third-party audit PDF package generation)
"""

from django.middleware.csrf import get_token
from rest_framework import generics, views, status
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import Control, Proof, Risk, RemediationTask, TestPlan, AssessmentActivity, Notification, ActiveSession
from django.contrib.auth.models import User
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.authtoken.views import ObtainAuthToken
from rest_framework.authtoken.models import Token
from .serializers import (
    ControlSerializer, LogEntrySerializer, UserSerializer, RiskSerializer, 
    RemediationTaskSerializer, TestPlanSerializer, AssessmentActivitySerializer, NotificationSerializer
)
from django.db import connection
from auditlog.models import LogEntry
from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from django.http import HttpResponse, Http404, FileResponse
from .models import OrganizationSettings
from django.core.exceptions import ValidationError

# --- NEW: Security & Authentication Imports ---
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.throttling import ScopedRateThrottle
# ----------------------------------------------

import datetime
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import rsa

from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import load_pem_public_key
from cryptography.exceptions import InvalidSignature

from cryptography import x509
from cryptography.x509.oid import NameOID
import io
import os
import ipaddress
import zipfile
import json
import base64
import subprocess
import sys
import threading
import shutil
import sqlite3
import tempfile

from .services.pdf_generator import generate_audit_pdf
from .log_sanitizer import sanitize_log_line

from .permissions import (
    IsAdminUserOrReadOnly, 
    ControlMatrixPermissions, 
    AssessmentPermissions, 
    TestPlanPermissions, 
    EvidenceUploadPermissions,
    IsAdminOrSelf,
    RiskPermissions,
    RemediationTaskPermissions,
    AuditLogPermissions,
    control_is_submitted_for_audit,
    get_user_role,
)

class TestPlanRetrieveUpdateView(generics.RetrieveUpdateAPIView):
    """Retrieves or updates audit testing plans, expectations, and attachments for a control."""
    queryset = TestPlan.objects.all()
    serializer_class = TestPlanSerializer
    permission_classes = [IsAuthenticated, TestPlanPermissions]
    parser_classes = (MultiPartParser, FormParser, JSONParser)
    
    def get_object(self):
        control_id = self.kwargs['control_id']
        control = generics.get_object_or_404(Control, control_id=control_id)
        test_plan, created = TestPlan.objects.get_or_create(control=control)
        return test_plan


class AssessmentActivityListCreateView(generics.ListCreateAPIView):
    """Lists or logs formal audit assessment activities and findings for a control."""
    serializer_class = AssessmentActivitySerializer
    permission_classes = [IsAuthenticated, AssessmentPermissions]

    def get_queryset(self):
        control_id = self.kwargs['control_id']
        return AssessmentActivity.objects.filter(control__control_id=control_id).order_by('-date_started')

    def perform_create(self, serializer):
        control_id = self.kwargs['control_id']
        control = generics.get_object_or_404(Control, control_id=control_id)
        serializer.save(control=control, assessor=self.request.user)


class AssessmentActivityDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieves, updates, or deletes individual assessment audit activity records."""
    queryset = AssessmentActivity.objects.all()
    serializer_class = AssessmentActivitySerializer
    permission_classes = [IsAuthenticated, AssessmentPermissions]


class RemediationTaskListCreateView(generics.ListCreateAPIView):
    """Manages Plan of Action & Milestones (POA&M) remediation tasks."""
    queryset = RemediationTask.objects.all().order_by('-created_at')
    serializer_class = RemediationTaskSerializer
    permission_classes = [IsAuthenticated, RemediationTaskPermissions]

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)


class RemediationTaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieves, modifies, or closes individual remediation tasks."""
    queryset = RemediationTask.objects.all()
    serializer_class = RemediationTaskSerializer
    permission_classes = [IsAuthenticated, RemediationTaskPermissions]


class RiskListCreateView(generics.ListCreateAPIView):
    """Manages enterprise risk register entries with mitigating control associations."""
    queryset = Risk.objects.all().prefetch_related('mitigating_controls')
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated, RiskPermissions]


class RiskDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieves, updates, or deletes individual risk register entries."""
    queryset = Risk.objects.all()
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated, RiskPermissions]


class ControlListCreateView(generics.ListCreateAPIView):
    """Lists compliance controls with pre-fetched proof, risk, and crosswalk relations."""
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]
    serializer_class = ControlSerializer

    def get_queryset(self):
        qs = Control.objects.prefetch_related(
            'proofs',
            'remediation_tasks',
            'cross_walked_controls',
            'cross_walked_controls__proofs',
            'cross_walked_controls__remediation_tasks',
            'mitigated_risks',
            'assessments'
        ).select_related('test_plan').all()

        framework_param = self.request.query_params.get('framework')
        if framework_param and framework_param != 'All':
            qs = qs.filter(framework=framework_param)
        return qs


class ControlDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieves, updates, or deletes individual compliance controls by control_id."""
    queryset = Control.objects.all()
    serializer_class = ControlSerializer
    lookup_field = 'control_id'
    permission_classes = [IsAuthenticated, ControlMatrixPermissions]


class ProofUploadView(views.APIView):
    """Validates uploaded evidence files with MIME verification and malware scanning before attaching to controls."""
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated, EvidenceUploadPermissions]

    def post(self, request, control_id):
        try:
            control = Control.objects.get(control_id=control_id)
        except Control.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        user_role = 'Admin' if request.user.is_superuser else getattr(getattr(request.user, 'profile', None), 'role', 'Contributor')
        if user_role == 'Contributor' and (
            control.status == 'Passing' or
            control_is_submitted_for_audit(control)
        ):
            return Response(
                {'error': ['Contributors cannot upload evidence to controls that are Passing or submitted for audit.']},
                status=status.HTTP_403_FORBIDDEN
            )

        file_obj = request.FILES.get('file')
        if file_obj:
            # 1. Instantiate the object without saving to the database yet
            proof = Proof(control=control, file=file_obj)
            
            try:
                # 2. Explicitly trigger all model validators (including python-magic)
                proof.full_clean()
                # 3. Save only if validation passes
                proof.save()
                return Response({'status': 'file uploaded'}, status=status.HTTP_201_CREATED)
            except ValidationError as e:
                # Catch the python-magic rejection and return it to the frontend
                return Response({'error': e.messages}, status=status.HTTP_400_BAD_REQUEST)
        
        return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)


class ProofDeleteView(generics.DestroyAPIView):
    """Safely purges physical evidence files from the appliance disk and removes DB references."""
    queryset = Proof.objects.all()
    permission_classes = [IsAuthenticated, EvidenceUploadPermissions]
    
    def perform_destroy(self, instance):
        try:
            if instance.file:
                instance.file.delete(save=False)
        except Exception as e:
            print(f"Ignored missing file during delete: {e}")
            
        instance.delete()


class AuditLogListView(generics.ListAPIView):
    """Lists tamper-evident audit records generated by django-auditlog for compliance traceability."""
    permission_classes = [IsAuthenticated, AuditLogPermissions]
    queryset = LogEntry.objects.select_related('actor').order_by('-timestamp')
    serializer_class = LogEntrySerializer


class DeviceLogView(APIView):
    """Returns a bounded tail of backend operational logs to administrators."""
    permission_classes = [IsAuthenticated]
    max_log_bytes = 1024 * 1024
    max_log_lines = 500

    def get(self, request):
        if get_user_role(request) != 'Admin':
            return Response(
                {"error": "Only Administrators can view device logs."},
                status=status.HTTP_403_FORBIDDEN
            )

        log_path = settings.LOGS_DIR / 'grc-backend.log'
        try:
            with log_path.open('rb') as log_file:
                log_file.seek(0, os.SEEK_END)
                file_size = log_file.tell()
                start = max(0, file_size - self.max_log_bytes)
                log_file.seek(start)
                content = log_file.read(self.max_log_bytes)
        except OSError:
            return Response(
                {"error": "The backend log file is not available or could not be read."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

        lines = content.decode('utf-8', errors='replace').splitlines()
        if start and lines:
            lines = lines[1:]
        truncated = start > 0 or len(lines) > self.max_log_lines
        lines = lines[-self.max_log_lines:]
        unsanitized = request.query_params.get('view') == 'unsanitized'
        if not unsanitized:
            lines = [sanitize_log_line(line) for line in lines]

        return Response({
            "logs": lines,
            "count": len(lines),
            "truncated": truncated,
            "view": "unsanitized" if unsanitized else "sanitized",
        })


class UserCreateView(generics.ListCreateAPIView):
    """
    Enables Administrators to list all users and provision new accounts.
    Non-admin users receive only their own user profile record to prevent account enumeration.
    """
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or getattr(getattr(user, 'profile', None), 'role', '') == 'Admin':
            return User.objects.select_related('profile').all()
        return User.objects.select_related('profile').filter(pk=user.pk)


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Enables users to manage their profile details and Admins to manage system accounts."""
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminOrSelf]
    parser_classes = (MultiPartParser, FormParser, JSONParser)


class CustomAuthToken(ObtainAuthToken):
    """
    Authenticates user credentials, generates or refreshes a secure auth token,
    records device/IP metadata in ActiveSession, and injects an HttpOnly session cookie.
    """
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        serializer = self.serializer_class(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        
        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
        
        user_agent = request.META.get('HTTP_USER_AGENT', 'Unknown Browser')[:250]
        raw_ip = request.META.get('HTTP_X_FORWARDED_FOR', request.META.get('REMOTE_ADDR', '')).split(',')[0].strip()
        ip_address = raw_ip if raw_ip else None
        
        ActiveSession.objects.update_or_create(
            token_key=token.key,
            defaults={
                'user': user,
                'device_info': user_agent,
                'ip_address': ip_address,
                'location': "Appliance Network",
                'last_active': timezone.now()
            }
        )
        
        role = getattr(user.profile, 'role', 'Contributor') if hasattr(user, 'profile') else 'Contributor'
        avatar_url = request.build_absolute_uri(user.profile.avatar.url) if hasattr(user, 'profile') and user.profile.avatar else None
        must_change_password = getattr(user.profile, 'must_change_password', False) if hasattr(user, 'profile') else False

        # Do NOT return the token in the JSON body
        get_token(request)
        response = Response({
            'username': user.username,
            'role': role,
            'avatar': avatar_url,
            'must_change_password': must_change_password,
        })
        
        # Read the 'remember_me' flag passed from the frontend
        remember_me = request.data.get('remember_me', False)
        max_age = 14400 if remember_me else None # 4 hours or session-only
        
        # Inject the secure HttpOnly cookie (enforce Secure when request arrived over HTTPS)
        is_secure_conn = request.is_secure() or (not settings.DEBUG and request.headers.get('x-forwarded-proto') == 'https')
        response.set_cookie(
            key='grc_token',
            value=token.key,
            httponly=True,
            secure=is_secure_conn,
            samesite='Lax',
            max_age=max_age
        )
        return response


class LogoutView(APIView):
    """Terminates active session, purges database token and ActiveSession record, and clears cookie."""
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        # Delete the token and active session from the database
        if hasattr(request, 'auth') and request.auth:
            request.auth.delete()
            ActiveSession.objects.filter(token_key=request.auth.key).delete()
        
        # Tell the browser to delete the cookie
        response = Response({"status": "Logged out"})
        response.delete_cookie('grc_token')
        return response


class ActiveSessionsView(APIView):
    """Allows Administrators to audit active user sessions across devices and remotely revoke tokens."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user_role = getattr(request.user.profile, 'role', '') if hasattr(request.user, 'profile') else ''
        if user_role != 'Admin' and not request.user.is_superuser:
            return Response(
                {"error": "Only Administrators can view active sessions."}, 
                status=status.HTTP_403_FORBIDDEN
            )

        sessions = ActiveSession.objects.select_related('user').all().order_by('-last_active')
        data = []
        
        current_token = request.auth.key if hasattr(request, 'auth') and request.auth else None

        for s in sessions:
            data.append({
                'id': s.token_key,
                'device': f"[{s.user.username}] {s.device_info}", 
                'meta': s.ip_address or "Unknown IP",
                'location': s.location,
                'lastActive': s.last_active.strftime('%Y-%m-%d %H:%M'),
                'current': s.token_key == current_token
            })
            
        return Response(data)

    def delete(self, request):
        user_role = getattr(request.user.profile, 'role', '') if hasattr(request.user, 'profile') else ''
        if user_role != 'Admin' and not request.user.is_superuser:
            return Response(
                {"error": "Only Administrators can revoke sessions."}, 
                status=status.HTTP_403_FORBIDDEN
            )

        token_key = request.data.get('id')
        if not token_key:
            return Response({"error": "Session ID is required."}, status=status.HTTP_400_BAD_REQUEST)
        
        Token.objects.filter(key=token_key).delete()
        ActiveSession.objects.filter(token_key=token_key).delete()
        
        return Response({"message": "Session successfully revoked."}, status=status.HTTP_200_OK)


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

class ExportAuditPackageView(APIView):
    """
    Generates downloadable compliance audit packages (JSON, encrypted PDF, or ZIP archive).
    Supports PII/actor redaction, AES password-protected PDF reports, and proof attachment bundling.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_role = getattr(request.user.profile, 'role', '')
        if user_role not in ['Admin', 'Auditor', 'Executive']:
            return Response(
                {"error": "You do not have permission to export audit packages."}, 
                status=status.HTTP_403_FORBIDDEN
            )

        scope = request.data.get('scope', {})
        redact = request.data.get('redact', True)
        export_format = request.data.get('format', 'json')
        export_password = request.data.get('password')
        
        org_data = request.data.get('organization', {})
        company_name = org_data.get('companyName', 'Edge GRC')
        workspace_name = org_data.get('workspaceName', 'Compliance Solutions')
        logo_data_url = org_data.get('logoDataUrl')

        target_framework = request.data.get('target_framework', 'Generic Control Framework')
        assessment_boundary = request.data.get('assessment_boundary', workspace_name)
        
        export_data = {
            "metadata": {
                "generated_at": timezone.now().isoformat(),
                "generated_by": "REDACTED" if redact else request.user.username,
                "target_framework": target_framework,
                "assessment_boundary": assessment_boundary,
                "organization": company_name
            }
        }
        
        if scope.get('controls') or scope.get('evidence'):
            controls = Control.objects.prefetch_related(
                'proofs', 'remediation_tasks', 'cross_walked_controls', 
                'mitigated_risks', 'assessments'
            ).select_related('test_plan').all()
            
            controls_data = ControlSerializer(controls, many=True, context={'request': request}).data
            
            if not scope.get('evidence'):
                for c in controls_data:
                    c.pop('evidence', None)
                    c.pop('proofs', None)
                    
            export_data['controls'] = controls_data
            
        if scope.get('risks'):
            risks = Risk.objects.all().prefetch_related('mitigating_controls')
            risks_data = RiskSerializer(risks, many=True, context={'request': request}).data
            export_data['risks'] = risks_data

        if scope.get('logs'):
            logs = LogEntry.objects.select_related('actor').all().order_by('-timestamp')
            log_data = LogEntrySerializer(logs, many=True, context={'request': request}).data
            
            if redact:
                for log in log_data:
                    log['actor_name'] = 'REDACTED'
                    
            export_data['audit_logs'] = log_data

        if scope.get('summary'):
            total_controls = Control.objects.count()
            passing_controls = Control.objects.filter(status='Passing').count()
            failing_controls = Control.objects.filter(status='Failing').count()
            awaiting_controls = Control.objects.filter(status='Awaiting Approval').count()
            not_evaluated = Control.objects.filter(status='Not Evaluated').count()
            not_applicable = Control.objects.filter(status='Not Applicable').count()

            evaluatable_total = total_controls - not_applicable
            
            design_eff = Control.objects.filter(control_effectiveness='Effective').count()
            design_def = Control.objects.filter(control_effectiveness='Deficient').count()
            design_not = total_controls - (design_eff + design_def)
            
            op_eff = Control.objects.filter(implementation_effectiveness='Effective').count()
            op_def = Control.objects.filter(implementation_effectiveness='Deficient').count()
            op_not = total_controls - (op_eff + op_def)
            
            inherent_critical = inherent_high = inherent_medium = inherent_low = 0
            residual_critical = residual_high = residual_medium = residual_low = 0
            
            for risk in Risk.objects.all():
                i_score = risk.inherent_score
                if i_score >= 15: inherent_critical += 1
                elif i_score >= 10: inherent_high += 1
                elif i_score >= 5: inherent_medium += 1
                else: inherent_low += 1
                
                r_score = risk.residual_score
                if r_score >= 15: residual_critical += 1
                elif r_score >= 10: residual_high += 1
                elif r_score >= 5: residual_medium += 1
                else: residual_low += 1

            export_data['summary'] = {
                "total_controls": total_controls,
                "passing_controls": passing_controls,
                "failing_controls": failing_controls,
                "awaiting_controls": awaiting_controls,
                "not_evaluated": not_evaluated,
                "not_applicable": not_applicable,
                "compliance_score": round((passing_controls / evaluatable_total * 100) if evaluatable_total > 0 else 0),
                "design_effective": design_eff,
                "design_deficient": design_def,
                "design_not_tested": design_not,
                "operating_effective": op_eff,
                "operating_deficient": op_def,
                "operating_not_tested": op_not,
                "total_risks": Risk.objects.count(),
                "risk_inherent_critical": inherent_critical,
                "risk_inherent_high": inherent_high,
                "risk_inherent_medium": inherent_medium,
                "risk_inherent_low": inherent_low,
                "risk_residual_critical": residual_critical,
                "risk_residual_high": residual_high,
                "risk_residual_medium": residual_medium,
                "risk_residual_low": residual_low,
            }

        if export_format == 'pdf':
            from django_q.tasks import async_task
            task_id = async_task('frameworks.views.background_audit_pdf_task', export_data, company_name, export_password, logo_data_url)
            return Response({'task_id': task_id})

        if export_format == 'zip':
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
                zip_file.writestr('audit_summary.json', json.dumps(export_data, indent=2))
                
                if scope.get('evidence'):
                    # Pack standard Proof files
                    proofs = Proof.objects.all()
                    for proof in proofs:
                        if proof.file:
                            file_path = f"proofs/{proof.control.control_id}/{os.path.basename(proof.file.name)}"
                            try:
                                zip_file.writestr(file_path, proof.file.read())
                            except Exception as e:
                                print(f"Failed to zip proof file {file_path}: {e}")
                    
                    # Pack the new Test Plan Attachments
                    test_plans = TestPlan.objects.exclude(attachment='')
                    for tp in test_plans:
                        if tp.attachment:
                            file_path = f"test_plans/{tp.control.control_id}/{os.path.basename(tp.attachment.name)}"
                            try:
                                zip_file.writestr(file_path, tp.attachment.read())
                            except Exception as e:
                                print(f"Failed to zip test plan file {file_path}: {e}")
                                
            response = HttpResponse(zip_buffer.getvalue(), content_type='application/zip')
            response['Content-Disposition'] = 'attachment; filename="audit-package.zip"'
            return response

        return Response({
            "message": "Export generated successfully",
            "data": export_data
        })


import uuid
import os
from django.conf import settings

RESULTS_DIR = os.path.join(settings.BASE_DIR, 'task_results')
os.makedirs(RESULTS_DIR, exist_ok=True)

def background_backup_task():
    import io, zipfile
    from .database_backup import add_database_backup

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        add_database_backup(zip_file)
        # 2. Evidence media files
        media_root = settings.MEDIA_ROOT
        if os.path.exists(media_root):
            for folder_name, subfolders, filenames in os.walk(media_root):
                for filename in filenames:
                    file_path = os.path.join(folder_name, filename)
                    arcname = os.path.relpath(file_path, media_root)
                    zip_file.write(file_path, arcname=f"media/{arcname}")
            
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
    """Asynchronously generates a complete appliance backup (DB snapshot + media proofs) via django-q."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Administrators can generate system backups."}, status=status.HTTP_403_FORBIDDEN)
            
        from django_q.tasks import async_task
        task_id = async_task('frameworks.views.background_backup_task')
        return Response({'task_id': task_id})


def background_restore_task(zip_path):
    import zipfile, os, shutil, tempfile, sqlite3, json
    from django.conf import settings
    from django.db import connection, connections
    from django.core.management import call_command

    temp_dir = tempfile.mkdtemp()
    try:
        connections.close_all()

        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Zip Slip mitigation check
            for member in zip_ref.namelist():
                member_path = os.path.abspath(os.path.join(temp_dir, member))
                if not member_path.startswith(temp_dir + os.path.sep) and member_path != temp_dir:
                    raise Exception(f"Security Violation: Path traversal attempt detected with file {member}")

            zip_ref.extractall(temp_dir)

        # 1. Database Integrity Verification & Replacement
        extracted_db = os.path.join(temp_dir, 'db.sqlite3')
        extracted_json = os.path.join(temp_dir, 'database.json')

        if connection.vendor == 'sqlite' and os.path.exists(extracted_db):
            # Native SQLite Atomic Replacement
            with sqlite3.connect(extracted_db) as test_conn:
                test_cursor = test_conn.cursor()
                test_cursor.execute("PRAGMA integrity_check;")
                check_result = test_cursor.fetchone()
                if not check_result or check_result[0] != 'ok':
                    raise Exception(f"Database integrity verification failed: {check_result}")

                # SECURITY: Purge any queued django-q tasks or unauthorized schedule callables
                # from the uploaded SQLite database before replacing the active database file.
                try:
                    test_cursor.execute("DELETE FROM django_q_ormq;")
                except sqlite3.OperationalError:
                    pass
                try:
                    test_cursor.execute(
                        "DELETE FROM django_q_schedule WHERE func != 'frameworks.tasks.evaluate_audit_schedules';"
                    )
                except sqlite3.OperationalError:
                    pass
                test_conn.commit()

            connections.close_all()

            db_path = str(settings.DATABASES['default']['NAME'])
            for ext in ['-wal', '-shm']:
                wal_f = db_path + ext
                if os.path.exists(wal_f):
                    try:
                        os.remove(wal_f)
                    except OSError:
                        pass

            shutil.copyfile(extracted_db, db_path)

        elif os.path.exists(extracted_json):
            # SECURITY: Filter out dangerous internal/queue models (e.g., django_q, sessions,
            # contenttypes) before running loaddata to prevent arbitrary callable or pickle injection.
            with open(extracted_json, 'r', encoding='utf-8') as f:
                raw_fixture = json.load(f)
            if not isinstance(raw_fixture, list):
                raise Exception("Invalid database.json fixture format.")

            blocked_prefixes = ('django_q.', 'sessions.', 'admin.', 'contenttypes.')
            sanitized_fixture = [
                obj for obj in raw_fixture
                if isinstance(obj, dict) and not str(obj.get('model', '')).lower().startswith(blocked_prefixes)
            ]
            with open(extracted_json, 'w', encoding='utf-8') as f:
                json.dump(sanitized_fixture, f)

            # Universal / PostgreSQL Loaddata Restoration
            call_command('loaddata', extracted_json)

            # In PostgreSQL, reset primary key sequence counters after bulk import
            if connection.vendor == 'postgresql':
                try:
                    import io
                    out = io.StringIO()
                    call_command('sqlsequencereset', 'frameworks', 'auth', stdout=out)
                    sql = out.getvalue()
                    if sql:
                        with connection.cursor() as cursor:
                            cursor.execute(sql)
                except Exception as seq_err:
                    print(f"PostgreSQL sequence reset warning: {seq_err}")

        # 2. Media Directory Restoration — validate each file before copying
        extracted_media = os.path.join(temp_dir, 'media')
        media_root = os.path.abspath(str(settings.MEDIA_ROOT))
        if os.path.exists(extracted_media):
            from .models import ALLOWED_UPLOAD_EXTENSIONS
            for folder_name, _, filenames in os.walk(extracted_media):
                for filename in filenames:
                    ext = os.path.splitext(filename)[1].lower()
                    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
                        continue
                    src_file = os.path.join(folder_name, filename)
                    rel_path = os.path.relpath(src_file, extracted_media)
                    dest_file = os.path.abspath(os.path.join(media_root, rel_path))
                    if dest_file.startswith(media_root + os.path.sep):
                        os.makedirs(os.path.dirname(dest_file), exist_ok=True)
                        shutil.copyfile(src_file, dest_file)

        return {"status": "success"}

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        if os.path.exists(zip_path):
            try:
                os.remove(zip_path)
            except OSError:
                pass

class SystemRestoreView(APIView):
    """
    Asynchronously restores system state from an uploaded ZIP backup.
    Guards against Zip Slip path traversal and validates SQLite/Postgres database integrity.
    """
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


class NotificationListView(generics.ListAPIView):
    """Lists in-app security, task assignment, and compliance schedule notifications for the user."""
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.request.user.notifications.all().order_by('-timestamp')


class NotificationUpdateView(APIView):
    """Manages notification read status and dismissal/deletion."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk=None):
        if pk:
            try:
                notif = request.user.notifications.get(pk=pk)
                notif.read = True
                notif.save()
                return Response({"status": "marked read"})
            except Notification.DoesNotExist:
                return Response(status=status.HTTP_404_NOT_FOUND)
        else:
            request.user.notifications.filter(read=False).update(read=True)
            return Response({"status": "all marked read"})

    def delete(self, request, pk=None):
        if pk:
            try:
                request.user.notifications.get(pk=pk).delete()
                return Response({"status": "deleted"})
            except Notification.DoesNotExist:
                return Response(status=status.HTTP_404_NOT_FOUND)
        else:
            request.user.notifications.all().delete()
            return Response({"status": "all deleted"})


def execute_system_update(zip_path, base_dir):
    try:
        # Resolve the absolute path of our intended extraction target
        target_dir = os.path.abspath(base_dir)
        
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # ZIP SLIP MITIGATION: Iterate through every file in the archive
            for member in zip_ref.namelist():
                # Resolve the absolute path of where this specific file wants to go
                member_path = os.path.abspath(os.path.join(target_dir, member))
                
                # If the resolved path escapes our base_dir, it is a malicious payload
                if not member_path.startswith(target_dir + os.path.sep) and member_path != target_dir:
                    raise Exception(f"Security Violation: Path traversal attempt detected with file {member}")
            
            # If we make it through the loop without an exception, the archive is safe to extract
            zip_ref.extractall(base_dir)
            
        backend_dir = os.path.join(base_dir, 'grc-backend')
        manage_path = os.path.join(backend_dir, 'manage.py')
        if os.path.exists(manage_path):
            subprocess.run([sys.executable, manage_path, 'migrate'], cwd=backend_dir, check=True)
            try:
                subprocess.run([sys.executable, manage_path, 'collectstatic', '--noinput'], cwd=backend_dir, check=True)
            except Exception as cs_err:
                print(f"Warning: collectstatic during system update encountered: {cs_err}")
            
        if os.name != 'nt':
            systemctl_bin = '/bin/systemctl' if os.path.exists('/bin/systemctl') else '/usr/bin/systemctl'
            restart_cmd = f"sleep 2 && sudo {systemctl_bin} restart grc-backend grc-frontend grc-worker"
            subprocess.Popen(['nohup', 'sh', '-c', restart_cmd], start_new_session=True)
        
    except Exception as e:
        print(f"CRITICAL: System update failed: {e}")
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)


class SystemUpdateView(APIView):
    """
    Validates RSA digital signatures on update packages (`payload.zip` + `signature.sig`).
    Enforces Zip-Slip mitigation before extracting payloads and triggering automated service restarts.
    """
    permission_classes = [IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Administrators can perform system updates."}, status=status.HTTP_403_FORBIDDEN)
        
        file_obj = request.FILES.get('file')
        if not file_obj or not file_obj.name.endswith('.zip'):
            return Response({"error": "Please provide a valid .zip update package."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            update_dir = os.path.join(settings.BASE_DIR, 'updates')
            os.makedirs(update_dir, exist_ok=True)
            zip_path = os.path.join(update_dir, 'latest_update.zip')
            
            with open(zip_path, 'wb+') as dest:
                for chunk in file_obj.chunks():
                    dest.write(chunk)
            
            # --- Cryptographic Signature Verification ---
            pub_key_path = os.path.join(settings.BASE_DIR, 'configs', 'update_pub.pem')
            if not os.path.exists(pub_key_path):
                # If key doesn't exist yet, we fail closed to prevent unsigned updates
                return Response({"error": "Update public key not found. System cannot verify updates."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            with open(pub_key_path, 'rb') as f:
                public_key = load_pem_public_key(f.read())
            
            payload_path = os.path.join(update_dir, 'payload.zip')
            try:
                from cryptography.hazmat.primitives.asymmetric import utils as asym_utils
                with zipfile.ZipFile(zip_path, 'r') as outer_zip:
                    if 'payload.zip' not in outer_zip.namelist() or 'signature.sig' not in outer_zip.namelist():
                        return Response({"error": "Invalid update package format. Must contain payload.zip and signature.sig."}, status=status.HTTP_400_BAD_REQUEST)
                    
                    with outer_zip.open('signature.sig') as sig_f:
                        signature = sig_f.read()
                        
                    # Stream payload.zip in 64KB chunks to disk while computing SHA-256 digest
                    # to avoid loading up to 500MB into memory at once.
                    hasher = hashes.Hash(hashes.SHA256())
                    with outer_zip.open('payload.zip') as payload_f, open(payload_path, 'wb') as out_f:
                        while True:
                            chunk = payload_f.read(65536)
                            if not chunk:
                                break
                            hasher.update(chunk)
                            out_f.write(chunk)
                    digest = hasher.finalize()
                        
                    # Verify RSA signature against the prehashed SHA-256 digest
                    public_key.verify(
                        signature,
                        digest,
                        padding.PKCS1v15(),
                        asym_utils.Prehashed(hashes.SHA256())
                    )
                        
            except InvalidSignature:
                if os.path.exists(payload_path):
                    os.remove(payload_path)
                return Response({"error": "Signature verification failed! The update is not trusted."}, status=status.HTTP_403_FORBIDDEN)
            except zipfile.BadZipFile:
                if os.path.exists(payload_path):
                    os.remove(payload_path)
                return Response({"error": "Uploaded file is not a valid ZIP archive."}, status=status.HTTP_400_BAD_REQUEST)
            except Exception as e:
                if os.path.exists(payload_path):
                    os.remove(payload_path)
                return Response({"error": f"Error parsing update package: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)
            
            # Execute with the VERIFIED payload path against the appliance root directory
            appliance_root = str(settings.BASE_DIR.parent)
            threading.Thread(target=execute_system_update, args=(payload_path, appliance_root)).start()
            
            return Response({"status": "Signature verified. Update initiated. The system will apply changes and restart automatically."}, status=status.HTTP_200_OK)
            
        except Exception as e:
            return Response({"error": f"Failed to stage update: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FactoryResetView(APIView):
    """Purges controls, risks, notifications, and evidence files upon administrator password confirmation."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Admins can perform a factory reset."}, status=status.HTTP_403_FORBIDDEN)

        password = request.data.get('password')
        if not password:
            return Response({"error": "Password is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not request.user.check_password(password):
            return Response({"error": "Incorrect password."}, status=status.HTTP_403_FORBIDDEN)

        try:
            Control.objects.all().delete()
            Risk.objects.all().delete()
            Notification.objects.all().delete()

            evidence_dir = os.path.join(settings.MEDIA_ROOT, 'evidence_proofs')
            if os.path.exists(evidence_dir):
                shutil.rmtree(evidence_dir)
                os.makedirs(evidence_dir)

            return Response({"message": "Workspace successfully purged."})
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class HTTPSConfigurationView(APIView):
    """Generates X.509 SSL certificates with SAN entries, rewrites Nginx configurations, and reloads HTTPS."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)

        cert_path = os.path.join(settings.BASE_DIR, 'configs', 'ssl', 'appliance_cert.pem')
        
        if not os.path.exists(cert_path):
            return Response({"error": "Certificate has not been generated yet."}, status=status.HTTP_404_NOT_FOUND)

        with open(cert_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type='application/x-x509-ca-cert')
            response['Content-Disposition'] = 'attachment; filename="edge-grc-root.pem"'
            return response

    def post(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Admin access required."}, status=status.HTTP_403_FORBIDDEN)

        import re
        # Extract and strictly validate values submitted from the frontend dialog
        common_name = str(request.data.get('common_name', 'edge-grc.local')).strip()
        if not common_name or len(common_name) > 253 or not re.match(r'^[a-zA-Z0-9.-]+$', common_name):
            return Response(
                {"error": "Invalid Common Name (CN). Only alphanumeric characters, hyphens, and dots are permitted."},
                status=status.HTTP_400_BAD_REQUEST
            )

        org_name = str(request.data.get('organization', 'Edge-GRC Appliance')).strip()[:64] or 'Edge-GRC Appliance'
        country = str(request.data.get('country', 'US')).strip()[:2]
        state = str(request.data.get('state', '')).strip()[:64]
        locality = str(request.data.get('locality', '')).strip()[:64]

        # 1. Generate Cryptographic Assets
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        
        # Build the dynamic X.509 Subject Name block
        attributes = [
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, org_name),
        ]
        if country and len(country) == 2:
            attributes.append(x509.NameAttribute(NameOID.COUNTRY_NAME, country.upper()))
        if state: 
            attributes.append(x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, state))
        if locality: 
            attributes.append(x509.NameAttribute(NameOID.LOCALITY_NAME, locality))

        subject = issuer = x509.Name(attributes)

        san_list = []
        try:
            ip = ipaddress.ip_address(common_name)
            san_list.append(x509.IPAddress(ip))
        except ValueError:
            san_list.append(x509.DNSName(common_name))

        # Always include localhost and 127.0.0.1 for local management
        san_list.append(x509.DNSName('localhost'))
        san_list.append(x509.IPAddress(ipaddress.ip_address('127.0.0.1')))

        builder = x509.CertificateBuilder().subject_name(
            subject
        ).issuer_name(
            issuer
        ).public_key(
            private_key.public_key()
        ).serial_number(
            x509.random_serial_number()
        ).not_valid_before(
            timezone.now()
        ).not_valid_after(
            timezone.now() + datetime.timedelta(days=365)
        ).add_extension(
            x509.SubjectAlternativeName(san_list),
            critical=False
        )

        cert = builder.sign(private_key, hashes.SHA256())

        cert_pem = cert.public_bytes(serialization.Encoding.PEM)
        key_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        )

        # Persist custom hostname/IP to appliance_domain.txt so Django ALLOWED_HOSTS & CSRF_TRUSTED_ORIGINS stay synced
        domain_file = os.path.join(settings.BASE_DIR, 'configs', 'appliance_domain.txt')
        os.makedirs(os.path.dirname(domain_file), exist_ok=True)
        existing_domains = set()
        if os.path.exists(domain_file):
            with open(domain_file, 'r', encoding='utf-8') as df:
                existing_domains = {line.strip() for line in df if line.strip()}
        if common_name not in existing_domains:
            with open(domain_file, 'a', encoding='utf-8') as df:
                df.write(f"\n{common_name}\n")
        if common_name not in settings.ALLOWED_HOSTS:
            settings.ALLOWED_HOSTS.append(common_name)
        for scheme in ('https', 'http'):
            origin = f"{scheme}://{common_name}"
            if origin not in settings.CSRF_TRUSTED_ORIGINS:
                settings.CSRF_TRUSTED_ORIGINS.append(origin)

        # 2. Rewrite the Nginx Configuration File (using catch-all server_name _; to prevent directive injection)
        nginx_conf_path = os.path.join(settings.BASE_DIR, 'configs', 'nginx.conf')
        
        https_nginx_config = """server {
    listen 80;
    server_name _;
    
    server_tokens off;
    # Force HTTP to redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    # Security: Hide Nginx version banner
    server_tokens off;

    # Baseline Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # Restrict standard request body size to 25MB
    client_max_body_size 25M;

    ssl_certificate /opt/grc-appliance/grc-backend/configs/ssl/appliance_cert.pem;
    ssl_certificate_key /opt/grc-appliance/grc-backend/configs/ssl/appliance_key.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Allow large payloads exclusively for system updates and database restores
    location /api/update/ {
        client_max_body_size 500M;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /api/restore/ {
        client_max_body_size 500M;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts to prevent 504 errors while Django processes 
        # large background tasks (e.g., extracting zips, running migrations)
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
    
    location /static/ {
        alias /opt/grc-appliance/grc-backend/staticfiles/;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /protected_media/ {
        internal;
        alias /opt/grc-appliance/grc-backend/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
"""
        with open(nginx_conf_path, 'w') as f:
            f.write(https_nginx_config)

        # 3. Write Certificates to disk
        ssl_dir = os.path.join(settings.BASE_DIR, 'configs', 'ssl')
        os.makedirs(ssl_dir, exist_ok=True)

        with open(os.path.join(ssl_dir, 'appliance_key.pem'), 'wb') as f:
            f.write(key_pem)
            
        # Write the public cert LAST. This file modification triggers the Systemd 
        # 'grc-ssl-watcher.path' to execute 'systemctl reload nginx' immediately.
        with open(os.path.join(ssl_dir, 'appliance_cert.pem'), 'wb') as f:
            f.write(cert_pem)

        return Response({"status": "HTTPS successfully enabled. Nginx reloading."})


class OrganizationSettingsView(APIView):
    """
    Manages global organization profile settings (company name, workspace title, logo, and session timeout).
    - GET: Publicly accessible without authentication classes so unauthenticated visitors and login pages
      can render organization branding without being rejected by expired cookies.
    - PUT: Strictly authenticated and restricted to Administrators.
    """
    def get_authenticators(self):
        if self.request.method == 'GET':
            return []
        return super().get_authenticators()

    def get_permissions(self):
        if self.request.method == 'GET':
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request):
        obj, _ = OrganizationSettings.objects.get_or_create(pk=1)
        return Response({
            'company_name': obj.company_name,
            'workspace_name': obj.workspace_name,
            'logo_data_url': obj.logo_data_url,
            'session_timeout': obj.session_timeout
        })

    def put(self, request):
        # Only Admins can change the branding
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Admins can update branding."}, status=status.HTTP_403_FORBIDDEN)
            
        obj, _ = OrganizationSettings.objects.get_or_create(pk=1)
        
        if 'company_name' in request.data:
            obj.company_name = str(request.data['company_name'])[:255]
        if 'workspace_name' in request.data:
            obj.workspace_name = str(request.data['workspace_name'])[:255]
        if 'logo_data_url' in request.data:
            logo_val = request.data['logo_data_url']
            if logo_val:
                logo_str = str(logo_val)
                allowed_prefixes = (
                    'data:image/png;base64,',
                    'data:image/jpeg;base64,',
                    'data:image/jpg;base64,',
                    'data:image/gif;base64,',
                    'data:image/webp;base64,',
                    'data:image/x-icon;base64,',
                )
                if not logo_str.startswith(allowed_prefixes) or len(logo_str) > 5 * 1024 * 1024:
                    return Response(
                        {"error": "Invalid logo format. Only raster image data URLs (PNG, JPEG, GIF, WebP, ICO) up to 5MB are allowed."},
                        status=status.HTTP_400_BAD_REQUEST
                    )
                obj.logo_data_url = logo_str
            else:
                obj.logo_data_url = None
        if 'session_timeout' in request.data:
            try:
                timeout_val = int(request.data['session_timeout'])
                obj.session_timeout = max(5, min(timeout_val, 1440))
            except (ValueError, TypeError):
                return Response({"error": "Invalid session_timeout value."}, status=status.HTTP_400_BAD_REQUEST)
            
        obj.save()
        
        return Response({
            'company_name': obj.company_name,
            'workspace_name': obj.workspace_name,
            'logo_data_url': obj.logo_data_url,
            'session_timeout': obj.session_timeout
        })


class FaviconView(APIView):
    """
    Dynamically serves the organization logo as the browser favicon.
    Falls back to the default platform icon if no custom logo is uploaded.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        import base64
        from django.http import HttpResponse, HttpResponseRedirect
        
        obj = OrganizationSettings.objects.filter(pk=1).first()
        if obj and obj.logo_data_url and obj.logo_data_url.startswith('data:image'):
            try:
                header, encoded = obj.logo_data_url.split(',', 1)
                mime_type = header.split(';')[0].replace('data:', '').strip().lower()
                if mime_type == 'image/jpg':
                    mime_type = 'image/jpeg'
                allowed_favicon_mimes = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon'}
                if mime_type in allowed_favicon_mimes:
                    binary_data = base64.b64decode(encoded)
                    response = HttpResponse(binary_data, content_type=mime_type)
                    response['Cache-Control'] = 'no-cache, must-revalidate'
                    response['X-Content-Type-Options'] = 'nosniff'
                    return response
            except Exception:
                pass
                
        return HttpResponseRedirect('/icon.svg')

class VerifySessionView(APIView):
    """
    Validates the HttpOnly cookie/token on initial app load.
    Returns 200 OK with the true user details if valid, or 401 if invalid.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        role = getattr(user.profile, 'role', 'Contributor') if hasattr(user, 'profile') else 'Contributor'
        avatar_url = request.build_absolute_uri(user.profile.avatar.url) if hasattr(user, 'profile') and user.profile.avatar else None
        must_change_password = getattr(user.profile, 'must_change_password', False) if hasattr(user, 'profile') else False

        get_token(request)
        return Response({
            'username': user.username,
            'role': role,
            'avatar': avatar_url,
            'must_change_password': must_change_password,
        })
from django_q.models import Task
import mimetypes

class JobStatusView(APIView):
    """Polls the execution state (PENDING, SUCCESS, FAILED) of background tasks managed by django-q."""
    permission_classes = [IsAuthenticated]
    
    def get(self, request, task_id):
        try:
            task = Task.objects.get(id=task_id)
            user_role = getattr(request.user.profile, 'role', '') if hasattr(request.user, 'profile') else ''
            
            # Role-based access control per task function
            if task.func in ['frameworks.views.background_backup_task', 'frameworks.views.background_restore_task']:
                if user_role != 'Admin' and not request.user.is_superuser:
                    return Response({'error': 'Administrative access required.'}, status=status.HTTP_403_FORBIDDEN)
            elif task.func == 'frameworks.views.background_audit_pdf_task':
                if user_role not in ['Admin', 'Auditor', 'Executive'] and not request.user.is_superuser:
                    return Response({'error': 'Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)
            elif user_role != 'Admin' and not request.user.is_superuser:
                return Response({'error': 'Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

            if task.success is True:
                filename = task.result.get('filename') if isinstance(task.result, dict) else None
                return Response({'status': 'SUCCESS', 'filename': filename})
            elif task.success is False:
                print(f"Background task {task_id} ({task.func}) failed: {task.result}")
                return Response({'status': 'FAILED', 'error': 'Background task failed during execution.'})
            else:
                return Response({'status': 'PENDING'})
        except Task.DoesNotExist:
            return Response({'status': 'PENDING'})

class JobDownloadView(APIView):
    """Securely streams completed task artifacts (PDF audit reports, system backups) to authorized users."""
    permission_classes = [IsAuthenticated]
    
    def get(self, request, task_id):
        try:
            task = Task.objects.get(id=task_id)
            user_role = getattr(request.user.profile, 'role', '') if hasattr(request.user, 'profile') else ''
            
            # Role-based access control per task function
            if task.func in ['frameworks.views.background_backup_task', 'frameworks.views.background_restore_task']:
                if user_role != 'Admin' and not request.user.is_superuser:
                    return Response({'error': 'Administrative access required.'}, status=status.HTTP_403_FORBIDDEN)
            elif task.func == 'frameworks.views.background_audit_pdf_task':
                if user_role not in ['Admin', 'Auditor', 'Executive'] and not request.user.is_superuser:
                    return Response({'error': 'Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)
            elif user_role != 'Admin' and not request.user.is_superuser:
                return Response({'error': 'Insufficient privileges.'}, status=status.HTTP_403_FORBIDDEN)

            if not task.success:
                return Response({'error': 'Task failed'}, status=status.HTTP_400_BAD_REQUEST)
                
            result = task.result
            if not isinstance(result, dict) or 'file_path' not in result:
                return Response({'error': 'Task does not contain a downloadable file'}, status=status.HTTP_400_BAD_REQUEST)
                
            file_path = os.path.abspath(result['file_path'])
            results_dir = os.path.abspath(RESULTS_DIR)
            
            # Prevent path traversal outside the results directory
            if not file_path.startswith(results_dir + os.path.sep):
                return Response({'error': 'Security violation: invalid file path.'}, status=status.HTTP_403_FORBIDDEN)

            filename = result.get('filename', 'download')
            content_type = result.get('content_type', 'application/octet-stream')
            
            if not os.path.exists(file_path):
                return Response({'error': 'File not found'}, status=status.HTTP_404_NOT_FOUND)
                
            with open(file_path, 'rb') as f:
                response = HttpResponse(f.read(), content_type=content_type)
                response['Content-Disposition'] = f'attachment; filename="{filename}"'
                
            # Safe cleanup after read
            try:
                os.remove(file_path)
            except OSError:
                pass
                
            return response
        except Task.DoesNotExist:
            return Response({'error': 'Task not found'}, status=status.HTTP_404_NOT_FOUND)


class ProtectedMediaView(APIView):
    """
    Secures media files (evidence proofs, test plan attachments, user avatars).
    Enforces authentication via cookies or tokens and utilizes Nginx X-Accel-Redirect
    for high-performance, zero-copy file delivery in production.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, path):
        media_root = os.path.abspath(str(settings.MEDIA_ROOT))
        target_path = os.path.abspath(os.path.join(media_root, path))

        # Path traversal guard
        if not target_path.startswith(media_root + os.path.sep) and target_path != media_root:
            raise Http404("File not found")

        if not os.path.exists(target_path) or os.path.isdir(target_path):
            raise Http404("File not found")

        content_type, _ = mimetypes.guess_type(target_path)
        content_type = (content_type or 'application/octet-stream').lower()

        # Never serve active web content types with their executable MIME type
        safe_inline_types = {'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'}
        if content_type not in safe_inline_types:
            content_type = 'application/octet-stream'

        if not settings.DEBUG:
            response = HttpResponse()
            response['Content-Type'] = content_type
            response['X-Accel-Redirect'] = f'/protected_media/{path}'
        else:
            response = FileResponse(open(target_path, 'rb'), content_type=content_type)

        # Force download attachment for non-inline file types and lock down browser execution
        if content_type not in safe_inline_types:
            safe_filename = os.path.basename(target_path).replace('"', '')
            response['Content-Disposition'] = f'attachment; filename="{safe_filename}"'
        response['X-Content-Type-Options'] = 'nosniff'
        response['Content-Security-Policy'] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
        return response


class ChangePasswordView(APIView):
    """
    Allows any authenticated user to securely update their own password.
    Requires verification of the user's current password and validates the new
    password against Django's configured password policies.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        current_password = request.data.get('current_password', '')
        new_password = request.data.get('new_password', '')

        if not current_password:
            return Response({"error": "Current password is required."}, status=status.HTTP_400_BAD_REQUEST)

        if not request.user.check_password(current_password):
            return Response({"error": "Incorrect current password."}, status=status.HTTP_400_BAD_REQUEST)

        if not new_password:
            return Response({"error": "New password is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=request.user)
        except DjangoValidationError as e:
            return Response({"error": list(e.messages)}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save()

        if hasattr(request.user, 'profile'):
            request.user.profile.must_change_password = False
            request.user.profile.save()

        # Keep current session authenticated by refreshing token and rotating ActiveSession
        Token.objects.filter(user=request.user).delete()
        ActiveSession.objects.filter(user=request.user).delete()
        token = Token.objects.create(user=request.user)
        ActiveSession.objects.create(user=request.user, token_key=token.key)

        response = Response({"message": "Password changed successfully."})
        is_secure_conn = request.is_secure() or (not settings.DEBUG and request.headers.get('x-forwarded-proto') == 'https')
        response.set_cookie(
            key='grc_token',
            value=token.key,
            httponly=True,
            secure=is_secure_conn,
            samesite='Lax'
        )
        return response


class BulkControlImportView(APIView):
    """
    Atomic bulk import endpoint for compliance framework controls.
    Processes the entire batch in a single database transaction, preventing
    partial / corrupted framework states and eliminating hundreds of sequential HTTP calls.
    """
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]

    def post(self, request):
        controls_data = request.data.get('controls', [])
        if not isinstance(controls_data, list) or len(controls_data) == 0:
            return Response({"error": "A non-empty list of controls is required."}, status=status.HTTP_400_BAD_REQUEST)

        from django.db import transaction
        created_count = 0
        updated_count = 0

        batch_framework = str(request.data.get('framework', '')).strip() or "General"

        try:
            with transaction.atomic():
                for c in controls_data:
                    cid = str(c.get('control_id', '')).strip()
                    if not cid:
                        continue

                    framework_val = str(c.get('framework', '')).strip() or batch_framework

                    defaults = {
                        'framework': framework_val,
                        'requirement_title': c.get('requirement_title', ''),
                        'description': c.get('description', ''),
                        'process_mechanism': c.get('process_mechanism', ''),
                        'testing_frequency': c.get('testing_frequency', 'None'),
                        'tags': c.get('tags', []),
                        'status': c.get('status', 'Not Evaluated'),
                        'control_effectiveness': c.get('control_effectiveness', 'Not Tested'),
                        'implementation_effectiveness': c.get('implementation_effectiveness', 'Not Tested'),
                        'evidence': c.get('evidence', '')
                    }

                    _, created = Control.objects.update_or_create(
                        control_id=cid,
                        defaults=defaults
                    )
                    if created:
                        created_count += 1
                    else:
                        updated_count += 1

            return Response({
                "message": f"Successfully processed {created_count + updated_count} controls.",
                "created": created_count,
                "updated": updated_count,
                "total": created_count + updated_count
            }, status=status.HTTP_200_OK)

        except Exception as e:
            return Response({"error": f"Failed to import controls: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)


class HealthCheckView(APIView):
    """
    Public health check endpoint for monitoring systems, load balancers,
    and Nginx reverse proxy health checks.
    Evaluates database connectivity, background worker readiness, and free disk capacity.
    """
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        import shutil
        from django.db import connection
        from django_q.models import Schedule

        components = {}
        all_healthy = True

        # 1. Database Connectivity & Integrity
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1;")
                row = cursor.fetchone()
                if row and row[0] == 1:
                    components["database"] = {"status": "healthy"}
                else:
                    components["database"] = {"status": "unhealthy", "error": "Unexpected query response"}
                    all_healthy = False
        except Exception as e:
            components["database"] = {"status": "unhealthy", "error": str(e)}
            all_healthy = False

        # 2. Disk Storage Check
        try:
            total, used, free = shutil.disk_usage(str(settings.BASE_DIR))
            free_gb = round(free / (1024 ** 3), 2)
            total_gb = round(total / (1024 ** 3), 2)
            percent_used = round((used / total) * 100, 1)

            disk_status = "healthy"
            if free_gb < 0.5:
                disk_status = "critical"
                all_healthy = False
            elif free_gb < 1.0 or percent_used > 90.0:
                disk_status = "warning"

            components["storage"] = {
                "status": disk_status,
                "free_gb": free_gb,
                "total_gb": total_gb,
                "percent_used": percent_used,
            }
        except Exception as e:
            components["storage"] = {"status": "unhealthy", "error": str(e)}

        # 3. Background Workers (Django Q)
        try:
            Schedule.objects.exists()
            components["background_workers"] = {"status": "healthy"}
        except Exception as e:
            components["background_workers"] = {"status": "unhealthy", "error": str(e)}
            all_healthy = False

        response_status = status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response({
            "status": "healthy" if all_healthy else "degraded",
            "timestamp": timezone.now().isoformat(),
            "components": components,
        }, status=response_status)
