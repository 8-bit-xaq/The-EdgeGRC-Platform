from rest_framework import generics, views, status
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .models import Control, Proof, Risk, RemediationTask, TestPlan, AssessmentActivity, Notification, ActiveSession
from django.contrib.auth.models import User
from rest_framework.permissions import IsAuthenticated
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
from django.http import HttpResponse

import datetime
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography import x509
from cryptography.x509.oid import NameOID
import io
import os
import zipfile
import json
import base64
import subprocess
import sys
import threading
import shutil

from .services.pdf_generator import generate_audit_pdf

from .permissions import (
    IsAdminUserOrReadOnly, 
    ControlMatrixPermissions, 
    AssessmentPermissions, 
    TestPlanPermissions, 
    EvidenceUploadPermissions
)


class TestPlanRetrieveUpdateView(generics.RetrieveUpdateAPIView):
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
    queryset = AssessmentActivity.objects.all()
    serializer_class = AssessmentActivitySerializer
    permission_classes = [IsAuthenticated, AssessmentPermissions]


class RemediationTaskListCreateView(generics.ListCreateAPIView):
    queryset = RemediationTask.objects.all().order_by('-created_at')
    serializer_class = RemediationTaskSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)


class RemediationTaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = RemediationTask.objects.all()
    serializer_class = RemediationTaskSerializer
    permission_classes = [IsAuthenticated]


class RiskListCreateView(generics.ListCreateAPIView):
    queryset = Risk.objects.all().prefetch_related('mitigating_controls')
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated]


class RiskDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Risk.objects.all()
    serializer_class = RiskSerializer
    permission_classes = [IsAuthenticated]


class ControlListCreateView(generics.ListCreateAPIView):
    queryset = Control.objects.prefetch_related(
        'proofs',
        'remediation_tasks',
        'cross_walked_controls',
        'cross_walked_controls__proofs',
        'cross_walked_controls__remediation_tasks',
        'mitigated_risks',
        'assessments'
    ).select_related('test_plan').all()
    
    serializer_class = ControlSerializer


class ControlDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Control.objects.all()
    serializer_class = ControlSerializer
    lookup_field = 'control_id'
    permission_classes = [IsAuthenticated, ControlMatrixPermissions]


class ProofUploadView(views.APIView):
    parser_classes = (MultiPartParser, FormParser)
    permission_classes = [IsAuthenticated, EvidenceUploadPermissions]

    def post(self, request, control_id):
        try:
            control = Control.objects.get(control_id=control_id)
        except Control.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        
        file_obj = request.FILES.get('file')
        if file_obj:
            Proof.objects.create(control=control, file=file_obj)
            return Response({'status': 'file uploaded'}, status=status.HTTP_201_CREATED)
        
        return Response({'error': 'No file provided'}, status=status.HTTP_400_BAD_REQUEST)


class ProofDeleteView(generics.DestroyAPIView):
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
    queryset = LogEntry.objects.select_related('actor').order_by('-timestamp')
    serializer_class = LogEntrySerializer


class UserCreateView(generics.ListCreateAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated, IsAdminUserOrReadOnly]


class UserDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = User.objects.all()
    serializer_class = UserSerializer
    parser_classes = (MultiPartParser, FormParser, JSONParser)


class CustomAuthToken(ObtainAuthToken):
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
        
        role = 'Contributor'
        avatar_url = None
        if hasattr(user, 'profile'):
            role = user.profile.role
            if user.profile.avatar:
                avatar_url = request.build_absolute_uri(user.profile.avatar.url)

        return Response({
            'token': token.key,
            'username': user.username,
            'role': role,
            'avatar': avatar_url
        })
    

class ActiveSessionsView(APIView):
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


class ExportAuditPackageView(APIView):
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
        company_name = org_data.get('companyName', 'ByteTex')
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
            pdf_buffer = generate_audit_pdf(export_data, company_name, export_password, logo_data_url)
            response = HttpResponse(pdf_buffer.getvalue(), content_type='application/pdf')
            response['Content-Disposition'] = 'attachment; filename="audit-report.pdf"'
            return response

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


class SystemBackupView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if getattr(request.user.profile, 'role', '') != 'Admin':
            return Response({"error": "Only Administrators can generate system backups."}, status=403)
            
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            db_path = settings.DATABASES['default']['NAME']
            if os.path.exists(db_path):
                zip_file.write(db_path, arcname='db.sqlite3')
            
            media_root = settings.MEDIA_ROOT
            if os.path.exists(media_root):
                for folder_name, subfolders, filenames in os.walk(media_root):
                    for filename in filenames:
                        file_path = os.path.join(folder_name, filename)
                        arcname = os.path.relpath(file_path, media_root)
                        zip_file.write(file_path, arcname=f"media/{arcname}")
                        
        response = HttpResponse(zip_buffer.getvalue(), content_type='application/zip')
        timestamp = timezone.now().strftime("%Y%m%d_%H%M%S")
        response['Content-Disposition'] = f'attachment; filename="grc_system_backup_{timestamp}.zip"'
        return response


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

        try:
            connection.close()
            
            with zipfile.ZipFile(file_obj, 'r') as zip_ref:
                file_names = zip_ref.namelist()
                db_path = settings.DATABASES['default']['NAME']
                media_root = settings.MEDIA_ROOT
                
                for name in file_names:
                    if name == 'db.sqlite3':
                        with open(db_path, 'wb') as db_file:
                            db_file.write(zip_ref.read(name))
                    elif name.startswith('media/'):
                        rel_path = name.replace('media/', '', 1)
                        if rel_path: 
                            target_path = os.path.join(media_root, rel_path)
                            os.makedirs(os.path.dirname(target_path), exist_ok=True)
                            with open(target_path, 'wb') as media_file:
                                media_file.write(zip_ref.read(name))
                                
            return Response({"status": "System restored successfully."}, status=status.HTTP_200_OK)
            
        except Exception as e:
            return Response({"error": f"Failed to restore backup: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return self.request.user.notifications.all().order_by('-timestamp')


class NotificationUpdateView(APIView):
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
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(base_dir)
            
        backend_dir = os.path.join(base_dir, 'grc-backend')
        manage_path = os.path.join(backend_dir, 'manage.py')
        if os.path.exists(manage_path):
            subprocess.run([sys.executable, manage_path, 'migrate'], cwd=backend_dir, check=True)
            
        subprocess.run(['sudo', 'systemctl', 'restart', 'grc-backends', 'grc-frontend'], check=True)
        
    except Exception as e:
        print(f"CRITICAL: System update failed: {e}")
    finally:
        if os.path.exists(zip_path):
            os.remove(zip_path)


class SystemUpdateView(APIView):
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
            
            threading.Thread(target=execute_system_update, args=(zip_path, '/opt/grc-appliance/')).start()
            
            return Response({"status": "Update initiated. The system will apply changes and restart automatically."}, status=status.HTTP_200_OK)
            
        except Exception as e:
            return Response({"error": f"Failed to stage update: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class FactoryResetView(APIView):
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
    """
    Manages local HTTPS configuration. Generates certs to disk and reloads Nginx,
    or serves the public certificate for local machine trust.
    """
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

        # 1. Generate Cryptographic Assets
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        common_name = request.data.get('common_name', 'edge-grc.local')
        
        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"Edge-GRC Appliance"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ])

        cert = x509.CertificateBuilder().subject_name(
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
        ).sign(private_key, hashes.SHA256())

        cert_pem = cert.public_bytes(serialization.Encoding.PEM)
        key_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        )

        # 2. Write to the Host Filesystem
        ssl_dir = os.path.join(settings.BASE_DIR, 'configs', 'ssl')
        os.makedirs(ssl_dir, exist_ok=True)

        with open(os.path.join(ssl_dir, 'appliance_cert.pem'), 'wb') as f:
            f.write(cert_pem)
        with open(os.path.join(ssl_dir, 'appliance_key.pem'), 'wb') as f:
            f.write(key_pem)

        # The Systemd watcher automatically detects this file change and reloads Nginx.

        return Response({"status": "HTTPS successfully enabled on the appliance."})