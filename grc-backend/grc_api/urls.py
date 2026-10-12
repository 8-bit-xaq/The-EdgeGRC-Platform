from django.contrib import admin
from django.urls import path, re_path, include
from django.conf import settings
from frameworks.views import CustomAuthToken, ProtectedMediaView

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('frameworks.urls')),
    path('api/login/', CustomAuthToken.as_view(), name='api_token_auth'),
    re_path(r'^media/(?P<path>.*)$', ProtectedMediaView.as_view(), name='protected_media'),
]