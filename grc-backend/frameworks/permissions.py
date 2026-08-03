from rest_framework.permissions import BasePermission, SAFE_METHODS

def get_user_role(request):
    """Helper to safely extract the user's role string."""
    if request.user.is_superuser:
        return 'Admin'
    if hasattr(request.user, 'profile'):
        return request.user.profile.role
    return 'Contributor' # Default fallback

class IsAdminUserOrReadOnly(BasePermission):
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return get_user_role(request) == 'Admin'

class ControlMatrixPermissions(BasePermission):
    """
    - Admins: Full access.
    - Auditors & Reviewers: Can update status and evaluations, but cannot alter evidence.
    - Contributors: Can update evidence, but cannot set status to Passing/Awaiting.
    """
    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
            
        role = get_user_role(request)
        if role == 'Admin':
            return True
            
        if role in ['Auditor', 'Reviewer']:
            req_evidence = request.data.get('evidence')
            if req_evidence and req_evidence != obj.evidence:
                return False
            return True
            
        if role == 'Contributor':
            req_status = request.data.get('status')
            if req_status in ['Passing', 'Not Applicable']:
                return False
            return True
            
        return False

class AssessmentPermissions(BasePermission):
    """
    - Admins: Full access.
    - Contributors: Read-only.
    - Auditors: Can create, and can only edit/delete if status is "In Progress".
    - Reviewers: Can only edit if status is "In QA Review".
    """
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        role = get_user_role(request)
        return role in ['Admin', 'Auditor', 'Reviewer']

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
            
        role = get_user_role(request)
        if role == 'Admin':
            return True
            
        if role == 'Auditor':
            if request.method == 'DELETE':
                return obj.status == 'In Progress'
            return obj.status == 'In Progress'
            
        if role == 'Reviewer':
            if request.method == 'DELETE':
                return False
            return obj.status == 'In QA Review'
            
        return False

class TestPlanPermissions(BasePermission):
    """Only Admins and Auditors can manage Audit Test Plans."""
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        role = get_user_role(request)
        return role in ['Admin', 'Auditor']

class EvidenceUploadPermissions(BasePermission):
    """Reviewers and Auditors are strictly forbidden from uploading proof files."""
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        role = get_user_role(request)
        return role in ['Admin', 'Contributor']