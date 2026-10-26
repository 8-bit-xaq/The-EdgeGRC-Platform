import os
import json
from rest_framework import serializers
from django.utils.timesince import timesince
from django.utils import timezone
from .models import ActiveSession
from django.contrib.auth.models import User
from auditlog.models import LogEntry
from .models import Control, Proof, Risk, UserProfile, RemediationTask, TestPlan, AssessmentActivity, Notification
from .permissions import control_is_submitted_for_audit, get_user_role

class ActiveSessionSerializer(serializers.ModelSerializer):
    # Map model fields to React's expected property names
    id = serializers.CharField(source='token_key')
    device = serializers.CharField(source='device_info')
    meta = serializers.CharField(source='ip_address')
    lastActive = serializers.SerializerMethodField()
    current = serializers.SerializerMethodField()

    class Meta:
        model = ActiveSession
        fields = ['id', 'device', 'meta', 'location', 'lastActive', 'current']

    def get_lastActive(self, obj):
        # Converts the timestamp into a readable format like "5 minutes ago"
        time_diff = timesince(obj.last_active, timezone.now())
        return f"{time_diff.split(',')[0]} ago"

    def get_current(self, obj):
        # Checks if the token making the request matches this row's token
        request = self.context.get('request')
        if request and hasattr(request, 'auth') and request.auth:
            return obj.token_key == request.auth.key
        return False

class ProofSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    size = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()

    class Meta:
        model = Proof
        fields = ['id', 'name', 'size', 'type', 'url']

    def get_name(self, obj):
        return os.path.basename(obj.file.name)

    def get_size(self, obj):
        try:
            return obj.file.size
        except Exception:
            return 0
            
    def get_type(self, obj):
        return "application/octet-stream"

    def get_url(self, obj):
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None

class RemediationTaskSerializer(serializers.ModelSerializer):
    assigned_to_username = serializers.ReadOnlyField(source='assigned_to.username')
    requested_by_username = serializers.ReadOnlyField(source='requested_by.username')
    control = serializers.SlugRelatedField(slug_field='control_id', queryset=Control.objects.all())

    class Meta:
        model = RemediationTask
        fields = [
            'id', 'control', 'title', 'description', 
            'assigned_to', 'assigned_to_username', 
            'requested_by', 'requested_by_username',
            'due_date', 'status', 'created_at', 'updated_at'
        ]

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and get_user_role(request) == 'Contributor':
            if set(validated_data) != {'status'}:
                raise serializers.ValidationError("Assigned contributors may only update task status.")
            if instance.assigned_to_id != request.user.id:
                raise serializers.ValidationError("Only the assigned contributor may update this task.")
        return super().update(instance, validated_data)

class TestPlanSerializer(serializers.ModelSerializer):
    attachment_name = serializers.SerializerMethodField()
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = TestPlan
        fields = [
            'id', 'test_methodology', 'test_steps', 'expected_evidence', 
            'attachment', 'attachment_name', 'attachment_url', 'updated_at'
        ]
        extra_kwargs = {
            'attachment': {'write_only': True}
        }

    def get_attachment_name(self, obj):
        return os.path.basename(obj.attachment.name) if obj.attachment else None

    def get_attachment_url(self, obj):
        if obj.attachment:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.attachment.url)
            return obj.attachment.url
        return None

class AssessmentActivitySerializer(serializers.ModelSerializer):
    assessor_username = serializers.ReadOnlyField(source='assessor.username')
    
    class Meta:
        model = AssessmentActivity
        fields = [
            'id', 'assessor', 'assessor_username', 'status', 
            'design_effectiveness', 'operating_effectiveness', 
            'auditor_notes', 'date_started', 'date_completed'
        ]

class ControlSerializer(serializers.ModelSerializer):
    proofs = serializers.SerializerMethodField()
    remediation_tasks = serializers.SerializerMethodField()
    test_plan = TestPlanSerializer(read_only=True)
    assessments = AssessmentActivitySerializer(many=True, read_only=True)
    
    cross_walked_control_ids = serializers.SlugRelatedField(
        many=True,
        queryset=Control.objects.all(),
        slug_field='control_id',
        source='cross_walked_controls',
        required=False
    )
    
    mitigated_risk_ids = serializers.SlugRelatedField(
        many=True,
        read_only=True,
        slug_field='risk_id',
        source='mitigated_risks'
    )

    class Meta:
        model = Control
        fields = [
            'control_id', 
            'framework',
            'requirement_title', 
            'process_mechanism', 
            'description', 
            'status', 
            'evidence', 
            'proofs',
            'control_effectiveness',
            'implementation_effectiveness',
            'tags',
            'cross_walked_control_ids',
            'mitigated_risk_ids',
            'remediation_tasks',
            'test_plan',
            'assessments',
            'testing_frequency',
            'next_audit_date'
        ]

    def get_proofs(self, obj):
        proofs = {p.id: p for p in obj.proofs.all()}
        
        for sibling in obj.cross_walked_controls.all():
            for p in sibling.proofs.all():
                proofs[p.id] = p
                
        sorted_proofs = sorted(proofs.values(), key=lambda x: x.uploaded_at, reverse=True)
        return ProofSerializer(sorted_proofs, many=True, context=self.context).data

    def get_remediation_tasks(self, obj):
        tasks = {task.id: task for task in obj.remediation_tasks.all()}
        for sibling in obj.cross_walked_controls.all():
            for task in sibling.remediation_tasks.all():
                tasks[task.id] = task
        sorted_tasks = sorted(tasks.values(), key=lambda x: x.created_at, reverse=True)
        return RemediationTaskSerializer(sorted_tasks, many=True).data

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_superuser:
            user_role = 'Admin'
        elif request and hasattr(request, 'user') and hasattr(request.user, 'profile'):
            user_role = getattr(request.user.profile, 'role', 'Contributor')
        else:
            user_role = 'Contributor'

        new_status = validated_data.get('status', instance.status)

        if user_role == 'Contributor':
            if instance.status == 'Passing' or control_is_submitted_for_audit(instance):
                raise serializers.ValidationError({"status": "Contributors cannot modify controls while they are submitted for audit or have a Passing status."})
            if new_status in ['Passing', 'Not Applicable']:
                raise serializers.ValidationError({"status": "Contributors cannot mark controls as Passing or Not Applicable."})
            # Strip privileged fields that Contributors are not permitted to alter
            for restricted_field in [
                'control_effectiveness', 'implementation_effectiveness',
                'description', 'requirement_title', 'process_mechanism',
                'framework', 'testing_frequency', 'next_audit_date', 'cross_walked_controls'
            ]:
                validated_data.pop(restricted_field, None)

        if new_status == 'Not Applicable' and user_role != 'Admin':
            raise serializers.ValidationError({"status": "Only Admins can mark controls as Not Applicable."})

        if user_role in ['Reviewer', 'Auditor']:
            if 'evidence' in validated_data and validated_data['evidence'] != instance.evidence:
                raise serializers.ValidationError({"evidence": "Reviewers and Auditors cannot modify text evidence."})
            for restricted_field in ['description', 'requirement_title', 'process_mechanism', 'framework']:
                validated_data.pop(restricted_field, None)

        return super().update(instance, validated_data)

class RiskSerializer(serializers.ModelSerializer):
    inherent_score = serializers.ReadOnlyField()
    residual_score = serializers.ReadOnlyField()
    mitigating_controls_detail = ControlSerializer(source='mitigating_controls', many=True, read_only=True)
    mitigating_control_ids = serializers.SlugRelatedField(
        many=True,
        queryset=Control.objects.all(),
        slug_field='control_id',
        source='mitigating_controls',
        required=False
    )

    class Meta:
        model = Risk
        fields = [
            'id',
            'risk_id',
            'title',
            'description',
            'inherent_likelihood',
            'inherent_impact',
            'inherent_score',
            'residual_score',
            'mitigating_controls_detail',
            'mitigating_control_ids'
        ]

class LogEntrySerializer(serializers.ModelSerializer):
    actor_name = serializers.CharField(source='actor.username', read_only=True, default='System')
    changed_fields = serializers.SerializerMethodField()

    class Meta:
        model = LogEntry
        fields = ['id', 'timestamp', 'actor_name', 'action', 'object_repr', 'changed_fields']

    def get_changed_fields(self, obj):
        if not obj.changes:
            return ""
        try:
            changes_dict = obj.changes if isinstance(obj.changes, dict) else json.loads(obj.changes)
            
            fields = []
            for field in changes_dict.keys():
                if field == 'control_effectiveness':
                    fields.append('Design Eval')
                elif field == 'implementation_effectiveness':
                    fields.append('Operational Eval')
                elif field == 'status':
                    fields.append('Status')
                elif field == 'evidence':
                    fields.append('Evidence')
            
            return ", ".join(fields)
        except Exception as e:
            print(f"Audit log parse error: {e}")
            return ""
    
class UserSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source='profile.role', required=False)
    avatar = serializers.ImageField(source='profile.avatar', read_only=True)
    must_change_password = serializers.BooleanField(source='profile.must_change_password', required=False)
    
    notify_assessments = serializers.BooleanField(source='profile.notify_assessments', required=False)
    notify_tasks = serializers.BooleanField(source='profile.notify_tasks', required=False)
    notify_schedules = serializers.BooleanField(source='profile.notify_schedules', required=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password', 'first_name', 'last_name', 
            'is_active', 'role', 'avatar', 'must_change_password', 'notify_assessments', 'notify_tasks', 'notify_schedules'
        ]
        extra_kwargs = {'password': {'write_only': True, 'required': False}}

    def create(self, validated_data):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        password = validated_data.get('password')
        if not password:
            raise serializers.ValidationError({"password": ["A password is required when creating a user."]})

        try:
            validate_password(password)
        except DjangoValidationError as e:
            raise serializers.ValidationError({"password": list(e.messages)})

        profile_data = validated_data.pop('profile', {})
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=password,
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        if 'is_active' in validated_data:
            user.is_active = validated_data['is_active']
        
        user.profile.role = profile_data.get('role', 'Contributor')
        user.profile.must_change_password = profile_data.get('must_change_password', False)
        user.profile.notify_assessments = profile_data.get('notify_assessments', True)
        user.profile.notify_tasks = profile_data.get('notify_tasks', True)
        user.profile.notify_schedules = profile_data.get('notify_schedules', False)
        
        user.profile.save()
        user.save()
        return user

    def update(self, instance, validated_data):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError
        from rest_framework.authtoken.models import Token

        request = self.context.get('request')
        is_admin = request and (getattr(getattr(request.user, 'profile', None), 'role', '') == 'Admin' or request.user.is_superuser)

        profile_data = validated_data.pop('profile', {})
        password_changed = False

        if 'password' in validated_data:
            new_pw = validated_data.pop('password')
            if not is_admin:
                current_pw = request.data.get('current_password') if request else None
                if not current_pw or not instance.check_password(current_pw):
                    raise serializers.ValidationError({"password": ["Current password verification is required."]})
            try:
                validate_password(new_pw, user=instance)
            except DjangoValidationError as e:
                raise serializers.ValidationError({"password": list(e.messages)})
            instance.set_password(new_pw)
            instance.profile.must_change_password = profile_data.get('must_change_password', False)
            password_changed = True

        for attr, value in validated_data.items():
            if attr in ('is_active', 'username') and not is_admin:
                continue  # Non-admins cannot deactivate/activate accounts or change usernames
            setattr(instance, attr, value)

        if profile_data:
            if 'role' in profile_data and is_admin:
                instance.profile.role = profile_data['role']  # Only admins can change roles
            if 'must_change_password' in profile_data and is_admin:
                instance.profile.must_change_password = profile_data['must_change_password']
            if 'notify_assessments' in profile_data:
                instance.profile.notify_assessments = profile_data['notify_assessments']
            if 'notify_tasks' in profile_data:
                instance.profile.notify_tasks = profile_data['notify_tasks']
            if 'notify_schedules' in profile_data:
                instance.profile.notify_schedules = profile_data['notify_schedules']

        if request and request.FILES.get('avatar'):
            instance.profile.avatar = request.FILES['avatar']

        try:
            instance.profile.full_clean()
        except Exception as e:
            from rest_framework.exceptions import ValidationError as DRFValidationError
            raise DRFValidationError({"avatar": str(e)})

        instance.profile.save()
        instance.save()

        # Revoke active sessions if the account was deactivated or an admin reset another user's password
        if not instance.is_active or (password_changed and request and instance != request.user):
            Token.objects.filter(user=instance).delete()
            ActiveSession.objects.filter(user=instance).delete()

        return instance
    
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'title', 'description', 'severity', 'read', 'timestamp', 'target_control_id']