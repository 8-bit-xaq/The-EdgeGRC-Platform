import datetime
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from frameworks.models import ActiveSession

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
            
        return self.authenticate_credentials(token_key)

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
        timeout = datetime.timedelta(hours=4)

        if now > session.last_active + timeout:
            token.delete()
            session.delete()
            raise AuthenticationFailed('Session expired due to inactivity.')

        if now > session.last_active + datetime.timedelta(minutes=1):
            session.last_active = now
            session.save(update_fields=['last_active'])

        return (token.user, token)