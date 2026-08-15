from django.urls import path
from .views import (
    ControlListCreateView, 
    ControlDetailView, 
    ProofUploadView, 
    ProofDeleteView, 
    AuditLogListView, 
    UserCreateView, 
    UserDetailView,
    ActiveSessionsView,
    ExportAuditPackageView,
    RiskListCreateView,
    RiskDetailView,
    RemediationTaskListCreateView,
    RemediationTaskDetailView,
    TestPlanRetrieveUpdateView,
    AssessmentActivityListCreateView,
    AssessmentActivityDetailView,
    SystemBackupView,
    SystemRestoreView,
    NotificationListView,
    NotificationUpdateView,
    SystemUpdateView,
    HTTPSConfigurationView
)

urlpatterns = [
    path('controls/', ControlListCreateView.as_view()),
    path('controls/<str:control_id>/', ControlDetailView.as_view()),
    
    # Assessment & Test Plan endpoints
    path('controls/<str:control_id>/test-plan/', TestPlanRetrieveUpdateView.as_view()),
    path('controls/<str:control_id>/assessments/', AssessmentActivityListCreateView.as_view()),
    path('assessments/<int:pk>/', AssessmentActivityDetailView.as_view()),
    
    path('controls/<str:control_id>/proofs/', ProofUploadView.as_view()),
    path('proofs/<int:pk>/', ProofDeleteView.as_view()), 
    path('risks/', RiskListCreateView.as_view()),
    path('risks/<int:pk>/', RiskDetailView.as_view()),
    path('auditlogs/', AuditLogListView.as_view()),
    path('users/', UserCreateView.as_view()),
    path('users/<int:pk>/', UserDetailView.as_view()),
    path('sessions/', ActiveSessionsView.as_view()),
    path('export/', ExportAuditPackageView.as_view()),
    path('tasks/', RemediationTaskListCreateView.as_view(), name='task-list-create'),
    path('tasks/<int:pk>/', RemediationTaskDetailView.as_view(), name='task-detail'),
    path('backup/', SystemBackupView.as_view()),
    path('restore/', SystemRestoreView.as_view()),
    path('notifications/', NotificationListView.as_view()),
    path('notifications/read/', NotificationUpdateView.as_view()), 
    path('notifications/<int:pk>/', NotificationUpdateView.as_view()),
    path('update/', SystemUpdateView.as_view()),
    path('system/https-config/', HTTPSConfigurationView.as_view(), name='https-config'),
]