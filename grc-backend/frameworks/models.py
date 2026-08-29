from django.db import models
from django.contrib.auth.models import User
from django.db.models.signals import post_save
from django.dispatch import receiver
from auditlog.registry import auditlog
from django.conf import settings
from django.utils import timezone
from django.core.validators import FileExtensionValidator
from django.core.exceptions import ValidationError

# --- FILE UPLOAD SECURITY ---
ALLOWED_EVIDENCE_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx', 'csv', 'txt']
ALLOWED_EVIDENCE_MIMES = [
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', # DOCX
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       # XLSX
    'text/csv',
    'text/plain'
]

def validate_mime_type(upload):
    """Ensures the browser's stated MIME type matches our allowed list."""
    if hasattr(upload, 'content_type'):
        if upload.content_type not in ALLOWED_EVIDENCE_MIMES:
            raise ValidationError("Unsupported file format. Allowed types: PDF, PNG, JPG, DOCX, XLSX, CSV, TXT.")

# ----------------------------

class ActiveSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='active_sessions')
    token_key = models.CharField(max_length=40, unique=True)
    device_info = models.CharField(max_length=255, default="Unknown Device")
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    location = models.CharField(max_length=100, default="Local Network")
    created_at = models.DateTimeField(auto_now_add=True)
    last_active = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.user.username} - {self.device_info}"

class Control(models.Model):
    control_id = models.CharField(max_length=50, unique=True)
    requirement_title = models.CharField(max_length=255, blank=True, null=True)
    process_mechanism = models.TextField(blank=True, null=True)
    description = models.TextField()
    tags = models.JSONField(default=list, blank=True)

    FREQUENCY_CHOICES = [
        ("None", "None"),
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("Bi-Annual", "Bi-Annual"),
        ("Annual", "Annual")
    ]
    testing_frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default="None")
    next_audit_date = models.DateField(null=True, blank=True)
    
    status = models.CharField(
        max_length=50, 
        default="Not Evaluated",
        choices=[
            ("Passing", "Passing"), 
            ("Failing", "Failing"), 
            ("Not Evaluated", "Not Evaluated"),
            ("Ready for Audit", "Ready for Audit"),
            ("Awaiting Approval", "Awaiting Approval"),
            ("Not Applicable", "Not Applicable")
        ]
    )
    
    EFFECTIVENESS_CHOICES = [
        ("Effective", "Effective"),
        ("Deficient", "Deficient"),
        ("Not Tested", "Not Tested")
    ]
    control_effectiveness = models.CharField(max_length=50, choices=EFFECTIVENESS_CHOICES, default="Not Tested")
    implementation_effectiveness = models.CharField(max_length=50, choices=EFFECTIVENESS_CHOICES, default="Not Tested")
    
    evidence = models.TextField(blank=True, null=True)
    cross_walked_controls = models.ManyToManyField('self', blank=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._original_state = {
            'status': self.status,
            'evidence': self.evidence,
            'control_effectiveness': self.control_effectiveness,
            'implementation_effectiveness': self.implementation_effectiveness,
            'tags': self.tags
        }

    def __str__(self):
        return f"{self.control_id} - {self.status}"


class Proof(models.Model):
    control = models.ForeignKey(Control, related_name='proofs', on_delete=models.CASCADE)
    file = models.FileField(
        upload_to='evidence_proofs/',
        validators=[
            FileExtensionValidator(allowed_extensions=ALLOWED_EVIDENCE_EXTENSIONS),
            validate_mime_type
        ]
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)
    
    def __str__(self):
        return str(self.file.name) if self.file and self.file.name else "Deleted Proof"


class Risk(models.Model):
    risk_id = models.CharField(max_length=50, unique=True)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    inherent_likelihood = models.IntegerField(default=3)
    inherent_impact = models.IntegerField(default=3)
    mitigating_controls = models.ManyToManyField(Control, related_name='mitigated_risks', blank=True)

    @property
    def inherent_score(self):
        return self.inherent_likelihood * self.inherent_impact

    @property
    def residual_score(self):
        effective_count = 0
        
        mitigating_list = self.mitigating_controls.all()
        total_controls = len(mitigating_list)
        
        if total_controls == 0:
            return self.inherent_score

        for control in mitigating_list:
            if control.status == 'Passing' or (
                control.control_effectiveness == 'Effective' and 
                control.implementation_effectiveness == 'Effective'
            ):
                effective_count += 1
            elif control.status == 'Awaiting Approval':
                effective_count += 0.5

        mitigation_percentage = effective_count / total_controls
        reduction = self.inherent_score * (mitigation_percentage * 0.70)
        return max(1, round(self.inherent_score - reduction))


class RemediationTask(models.Model):
    control = models.ForeignKey(Control, related_name='remediation_tasks', on_delete=models.CASCADE)
    title = models.CharField(max_length=255)
    description = models.TextField()
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_tasks')
    requested_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='requested_tasks')
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=50,
        choices=[
            ("Open", "Open"),
            ("In Progress", "In Progress"),
            ("Resolved", "Resolved")
        ],
        default="Open"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Task for {self.control.control_id}: {self.title}"


class TestPlan(models.Model):
    control = models.OneToOneField(Control, on_delete=models.CASCADE, related_name='test_plan')
    test_methodology = models.JSONField(default=list, blank=True)
    test_steps = models.TextField(blank=True, null=True, help_text="Step-by-step instructions for the auditor.")
    expected_evidence = models.TextField(blank=True, null=True, help_text="What artifacts must be provided to pass?")
    
    attachment = models.FileField(
        upload_to='test_plans/', 
        null=True, 
        blank=True,
        validators=[
            FileExtensionValidator(allowed_extensions=ALLOWED_EVIDENCE_EXTENSIONS),
            validate_mime_type
        ]
    )
    
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Test Plan for {self.control.control_id}"


class AssessmentActivity(models.Model):
    control = models.ForeignKey(Control, on_delete=models.CASCADE, related_name='assessments')
    assessor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, related_name='performed_assessments')
    
    status = models.CharField(
        max_length=50,
        choices=[
            ("Planned", "Planned"),
            ("In Progress", "In Progress"),
            ("In QA Review", "In QA Review"),
            ("Completed", "Completed")
        ],
        default="Planned"
    )
    
    design_effectiveness = models.CharField(max_length=50, choices=Control.EFFECTIVENESS_CHOICES, default="Not Tested")
    operating_effectiveness = models.CharField(max_length=50, choices=Control.EFFECTIVENESS_CHOICES, default="Not Tested")
    auditor_notes = models.TextField(blank=True, null=True)
    
    date_started = models.DateTimeField(auto_now_add=True)
    date_completed = models.DateTimeField(null=True, blank=True)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._original_status = self.status

    def __str__(self):
        return f"Assessment of {self.control.control_id} - {self.status}"


class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(
        max_length=20, 
        choices=[
            ("Admin", "Admin"), 
            ("Auditor", "Auditor"), 
            ("Contributor", "Contributor"),
            ("Reviewer", "Reviewer"),
            ("Executive", "Executive")
        ],
        default="Contributor"
    )
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)
    
    # --- NOTIFICATION CHANNELS ---
    notify_assessments = models.BooleanField(default=False)
    notify_tasks = models.BooleanField(default=False)
    notify_schedules = models.BooleanField(default=False)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._original_role = self.role

    def save(self, *args, **kwargs):
        if not self.pk or self.role != getattr(self, '_original_role', None):
            if self.role == 'Admin':
                self.notify_assessments = True
                self.notify_tasks = True
                self.notify_schedules = True
            elif self.role == 'Auditor':
                self.notify_assessments = True
                self.notify_tasks = False
                self.notify_schedules = False
            elif self.role == 'Reviewer':
                self.notify_assessments = True
                self.notify_tasks = True
                self.notify_schedules = False
            elif self.role == 'Contributor':
                self.notify_assessments = False
                self.notify_tasks = True
                self.notify_schedules = True
            elif self.role == 'Executive':
                self.notify_assessments = False
                self.notify_tasks = False
                self.notify_schedules = False
                
        super().save(*args, **kwargs)
        self._original_role = self.role

    def __str__(self):
        return f"{self.user.username} - {self.role}"


class Notification(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, null=True)
    severity = models.CharField(max_length=20, default='info')
    target_control_id = models.CharField(max_length=50, blank=True, null=True) 
    read = models.BooleanField(default=False)
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.username} - {self.title}"


# --- NOTIFICATION SIGNALS ---

@receiver(post_save, sender=Control)
def notify_control_ready_for_audit(sender, instance, created, **kwargs):
    if getattr(instance, '_is_syncing', False) or getattr(instance, '_is_auto_linking', False):
        return

    orig_status = getattr(instance, '_original_state', {}).get('status')
    if instance.status == 'Ready for Audit' and orig_status != 'Ready for Audit':
        auditors = User.objects.filter(profile__role__in=['Auditor', 'Admin'], profile__notify_assessments=True)
        for auditor in auditors:
            Notification.objects.create(
                user=auditor,
                title="Control Ready for Audit",
                description=f"Control {instance.control_id} has been submitted by a contributor and is ready for formal assessment.",
                severity="info", 
                target_control_id=instance.control_id 
            )


@receiver(post_save, sender=AssessmentActivity)
def notify_assessment_updates(sender, instance, created, **kwargs):
    if created and instance.status in ['Planned', 'In Progress']:
        return
        
    orig_status = getattr(instance, '_original_status', None)
        
    if instance.status == 'In QA Review' and orig_status != 'In QA Review':
        reviewers = User.objects.filter(profile__role__in=['Reviewer', 'Admin'], profile__notify_assessments=True)
        for reviewer in reviewers:
            if reviewer != instance.assessor:
                Notification.objects.create(
                    user=reviewer,
                    title="Assessment Ready for QA",
                    description=f"Control {instance.control.control_id} has been submitted for review by {instance.assessor.username if instance.assessor else 'an auditor'}.",
                    severity="warning",
                    target_control_id=instance.control.control_id 
                )

    elif instance.status == 'In Progress' and orig_status == 'In QA Review':
        if instance.assessor and instance.assessor.profile.notify_assessments:
            Notification.objects.create(
                user=instance.assessor,
                title="Audit Rejected",
                description=f"Your assessment for {instance.control.control_id} was rejected by QA and returned for revisions.",
                severity="critical",
                target_control_id=instance.control.control_id
            ) 

    elif instance.status == 'Completed' and orig_status != 'Completed':
        if instance.assessor and instance.assessor.profile.notify_assessments:
            Notification.objects.create(
                user=instance.assessor,
                title="Audit Finalized",
                description=f"Your assessment for {instance.control.control_id} was approved and finalized.",
                severity="success",
                target_control_id=instance.control.control_id 
            )

    instance._original_status = instance.status


@receiver(post_save, sender=RemediationTask)
def notify_task_assignment(sender, instance, created, **kwargs):
    if created and instance.assigned_to and instance.assigned_to.profile.notify_tasks:
        Notification.objects.create(
            user=instance.assigned_to,
            title="New Task Assigned",
            description=f"You have been assigned to remediate control {instance.control.control_id}: {instance.title}.",
            severity="critical" if instance.status == 'Open' else "info",
            target_control_id=instance.control.control_id 
        )
    elif not created and instance.status == 'Resolved':
        admins = User.objects.filter(profile__role__in=['Admin', 'Reviewer'], profile__notify_tasks=True)
        for admin in admins:
            Notification.objects.create(
                user=admin,
                title="Task Resolved",
                description=f"Remediation task '{instance.title}' for {instance.control.control_id} was marked as resolved.",
                severity="success",
                target_control_id=instance.control.control_id 
            )


# --- AUTOMATION ENGINE SIGNALS ---

@receiver(post_save, sender=Control)
def auto_link_controls(sender, instance, created, **kwargs):
    if getattr(instance, '_is_auto_linking', False):
        return
        
    instance._is_auto_linking = True
    matching_controls = []
    
    if instance.tags:
        for other in Control.objects.exclude(id=instance.id):
            if other.tags and set(instance.tags).intersection(set(other.tags)):
                matching_controls.append(other)
                
    instance.cross_walked_controls.set(matching_controls)
    instance._is_auto_linking = False


@receiver(post_save, sender=Control)
def auto_sync_crosswalked_controls(sender, instance, **kwargs):
    if getattr(instance, '_is_syncing', False) or getattr(instance, '_is_auto_linking', False):
        return
        
    siblings = instance.cross_walked_controls.all()
    if not siblings.exists():
        return
        
    instance._is_syncing = True
    orig = getattr(instance, '_original_state', {})
    
    status_changed = instance.status != orig.get('status')
    evidence_changed = instance.evidence != orig.get('evidence')
    effectiveness_changed = (
        instance.control_effectiveness != orig.get('control_effectiveness') or
        instance.implementation_effectiveness != orig.get('implementation_effectiveness')
    )
    
    eval_changed = status_changed or evidence_changed or effectiveness_changed
    
    if not eval_changed:
        cluster = [instance] + list(siblings)
        
        def get_eval_weight(c):
            w = 0
            if c.status in ["Passing", "Failing"]: w += 10
            elif c.status == "Awaiting Approval": w += 5
            elif c.status == "Ready for Audit": w += 3
            if c.evidence: w += 2
            if c.control_effectiveness != "Not Tested": w += 1
            if c.implementation_effectiveness != "Not Tested": w += 1
            return w
            
        source = max(cluster, key=get_eval_weight)
    else:
        source = instance
        
    for c in [instance] + list(siblings):
        if c.id == source.id:
            continue
            
        needs_save = False
        if c.status != source.status: c.status = source.status; needs_save = True
        if c.evidence != source.evidence: c.evidence = source.evidence; needs_save = True
        if c.control_effectiveness != source.control_effectiveness: c.control_effectiveness = source.control_effectiveness; needs_save = True
        if c.implementation_effectiveness != source.implementation_effectiveness: c.implementation_effectiveness = source.implementation_effectiveness; needs_save = True
        
        if needs_save:
            c._is_syncing = True
            c.save()
            c._is_syncing = False
            
    instance._original_state = {
        'status': instance.status,
        'evidence': instance.evidence,
        'control_effectiveness': instance.control_effectiveness,
        'implementation_effectiveness': instance.implementation_effectiveness,
        'tags': instance.tags
    }
    
    instance._is_syncing = False


@receiver(post_save, sender=RemediationTask)
def auto_resolve_control(sender, instance, **kwargs):
    if instance.status == "Resolved":
        control = instance.control
        if control.status == "Failing":
            control.status = "Ready for Audit"
            control.save()


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)

# --- AUDIT LOGGING ---
auditlog.register(Control)
auditlog.register(Proof)
auditlog.register(Risk)
auditlog.register(RemediationTask)
auditlog.register(TestPlan)
auditlog.register(AssessmentActivity)

class OrganizationSettings(models.Model):
    company_name = models.CharField(max_length=255, default="Edge GRC")
    workspace_name = models.CharField(max_length=255, default="Compliance Solutions")
    logo_data_url = models.TextField(blank=True, null=True)

    def save(self, *args, **kwargs):
        # Force the ID to always be 1 so it acts as a global singleton
        self.pk = 1
        super().save(*args, **kwargs)