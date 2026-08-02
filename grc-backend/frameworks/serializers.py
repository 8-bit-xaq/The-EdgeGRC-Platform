import os
import json
from rest_framework import serializers
from django.contrib.auth.models import User
from auditlog.models import LogEntry
from .models import Control, Proof, Risk, UserProfile, RemediationTask, TestPlan, AssessmentActivity, Notification

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

# 1. RemediationTaskSerializer MUST be above ControlSerializer
class RemediationTaskSerializer(serializers.ModelSerializer):
    assigned_to_username = serializers.ReadOnlyField(source='assigned_to.username')
    
    # --- NEW: Expose the requester's username ---
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
# --- NEW: Assessment Serializers ---
class TestPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestPlan
        fields = ['id', 'test_methodology', 'test_steps', 'expected_evidence', 'updated_at']

class AssessmentActivitySerializer(serializers.ModelSerializer):
    assessor_username = serializers.ReadOnlyField(source='assessor.username')
    
    class Meta:
        model = AssessmentActivity
        fields = [
            'id', 'assessor', 'assessor_username', 'status', 
            'design_effectiveness', 'operating_effectiveness', 
            'auditor_notes', 'date_started', 'date_completed'
        ]

# 2. ControlSerializer
class ControlSerializer(serializers.ModelSerializer):
    # CHANGED: Use a custom method to fetch shared proofs
    proofs = serializers.SerializerMethodField()
    
    remediation_tasks = serializers.SerializerMethodField()
    
    # NEW: Nested formal assessment data
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

    # Fetch proofs for this control AND its cross-walked siblings
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
        user_role = getattr(request.user.profile, 'role', 'Contributor') if hasattr(request, 'user') and hasattr(request.user, 'profile') else 'Contributor'
        
        new_status = validated_data.get('status', instance.status)
        
        # Block Contributors from setting status to Passing
        if user_role == 'Contributor' and new_status == 'Passing':
            raise serializers.ValidationError({"status": "Contributors cannot mark controls as Passing."})

        # Block Reviewers/Auditors from setting status to Not Applicable
        if new_status == 'Not Applicable' and user_role not in ['Admin', 'Contributor']:
            raise serializers.ValidationError({"status": "Only Admins and Contributors can mark controls as Not Applicable."})
            
        # Block Reviewers from modifying the text evidence
        if user_role == 'Reviewer':
            if 'evidence' in validated_data and validated_data['evidence'] != instance.evidence:
                raise serializers.ValidationError({"evidence": "Reviewers cannot modify text evidence."})
            # Silently discard any description changes they might try to send
            validated_data.pop('description', None)
            
        return super().update(instance, validated_data)

# 3. RiskSerializer MUST be below ControlSerializer
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
    
    notify_assessments = serializers.BooleanField(source='profile.notify_assessments', required=False)
    notify_tasks = serializers.BooleanField(source='profile.notify_tasks', required=False)
    # --- FIX 1: Add the explicit profile mapping here ---
    notify_schedules = serializers.BooleanField(source='profile.notify_schedules', required=False)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'password', 'first_name', 'last_name', 
            'is_active', 'role', 'avatar', 'notify_assessments', 'notify_tasks', 'notify_schedules'
        ]
        extra_kwargs = {'password': {'write_only': True, 'required': False}}

    def create(self, validated_data):
        profile_data = validated_data.pop('profile', {})
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data.get('email', ''),
            password=validated_data.get('password'),
            first_name=validated_data.get('first_name', ''),
            last_name=validated_data.get('last_name', '')
        )
        if 'is_active' in validated_data:
            user.is_active = validated_data['is_active']
        
        user.profile.role = profile_data.get('role', 'Contributor')
        # Apply defaults on creation
        user.profile.notify_assessments = profile_data.get('notify_assessments', True)
        user.profile.notify_tasks = profile_data.get('notify_tasks', True)
        # FIX 2: Apply default for schedules
        user.profile.notify_schedules = profile_data.get('notify_schedules', False)
        
        user.profile.save()
        user.save()
        return user

    def update(self, instance, validated_data):
        profile_data = validated_data.pop('profile', {})
        
        if 'password' in validated_data:
            instance.set_password(validated_data.pop('password'))
            
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
            
        if profile_data:
            if 'role' in profile_data:
                instance.profile.role = profile_data['role']
            if 'notify_assessments' in profile_data:
                instance.profile.notify_assessments = profile_data['notify_assessments']
            if 'notify_tasks' in profile_data:
                instance.profile.notify_tasks = profile_data['notify_tasks']
            # --- FIX 3: Intercept and save the PATCH request here ---
            if 'notify_schedules' in profile_data:
                instance.profile.notify_schedules = profile_data['notify_schedules']
            
        # Manually extract the file directly from the request bypassing JSON validation
        request = self.context.get('request')
        if request and request.FILES.get('avatar'):
            instance.profile.avatar = request.FILES['avatar']
            
        instance.profile.save()
        instance.save()
        return instance
    
class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ['id', 'title', 'description', 'severity', 'read', 'timestamp', 'target_control_id']