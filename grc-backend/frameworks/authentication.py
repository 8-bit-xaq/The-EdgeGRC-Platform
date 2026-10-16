"""
Edge-GRC Hybrid Session & Token Authentication Engine.

Provides enterprise authentication balancing interactive browser UX with programmatic API needs:
1. Primary Transport: Secure HttpOnly session cookies (`grc_token`) preventing XSS token theft.
2. Fallback Transport: Standard `Authorization: Token <key>` headers for automated/API access.
3. CSRF Protection: Automatically enforces Django CSRF verification when cookies are used.
4. Activity Heartbeat: Automatically extends active sessions and terminates inactive sessions
   based on the organization's configurable inactivity timeout (`OrganizationSettings.session_timeout`).
"""

import datetime
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework import exceptions
from django.middleware.csrf import CsrfViewMiddleware
from frameworks.models import ActiveSession, OrganizationSettings


class CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason

class ExpiringTokenAuthentication(TokenAuthentication):
    """
    Custom token authentication that reads from HttpOnly cookies first, 
    falling back to the standard Authorization header, and expires tokens 
    based on the last_active timestamp.
    """
    def authenticate(self, request):
        # 1. Check for the HttpOnly cookie first
        token_key = request.COOKIES.get('grc_token')
        
        # 2. Fallback to standard Authorization header
        if not token_key:
            auth_header = request.META.get('HTTP_AUTHORIZATION', '')
            if auth_header.startswith('Token '):
                token_key = auth_header.split(' ')[1]

        if not token_key:
            return None
            
        user_auth_tuple = self.authenticate_credentials(token_key)
        
        # 3. If authenticated via HttpOnly cookie, enforce CSRF
        if request.COOKIES.get('grc_token'):
            self.enforce_csrf(request)
            
        return user_auth_tuple

    def enforce_csrf(self, request):
        """
        Enforce CSRF validation for session based authentication.
        """
        check = CSRFCheck(get_response=lambda r: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')

    def authenticate_credentials(self, key):
        model = self.get_model()
        try:
            token = model.objects.select_related('user').get(key=key)
        except model.DoesNotExist:
            raise AuthenticationFailed('Invalid token.')

        if not token.user.is_active:
            raise AuthenticationFailed('User inactive or deleted.')

        try:
            session = ActiveSession.objects.get(token_key=token.key)
        except ActiveSession.DoesNotExist:
            raise AuthenticationFailed('Invalid session.')

        now = timezone.now()
        
        try:
            org_settings = OrganizationSettings.objects.get(pk=1)
            timeout_minutes = org_settings.session_timeout
        except OrganizationSettings.DoesNotExist:
            timeout_minutes = 240 # Fallback to 4 hours

        timeout = datetime.timedelta(minutes=timeout_minutes)

        if now > session.last_active + timeout:
            token.delete()
            session.delete()
            raise AuthenticationFailed('Session expired due to inactivity.')

        if now > session.last_active + datetime.timedelta(minutes=1):
            session.last_active = now
            session.save(update_fields=['last_active'])

        return (token.user, token)