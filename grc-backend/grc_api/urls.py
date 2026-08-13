from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from frameworks.views import CustomAuthToken
from frameworks.views import SessionListView, CustomLoginView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('frameworks.urls')),
    path('api/login/', CustomAuthToken.as_view()),
    path('api/sessions/', SessionListView.as_view(), name='session-list'),
    path('api/login/', CustomLoginView.as_view(), name='api_token_auth'),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)   