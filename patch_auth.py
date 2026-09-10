import re

with open("grc-backend/frameworks/authentication.py", "r") as f:
    content = f.read()

new_logic = """import datetime
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework import exceptions
from django.middleware.csrf import CsrfViewMiddleware
from frameworks.models import ActiveSession, OrganizationSettings

class CSRFCheck(CsrfViewMiddleware):
    def _reject(self, request, reason):
        return reason

class ExpiringTokenAuthentication(TokenAuthentication):
    \"\"\"
    Custom token authentication that reads from HttpOnly cookies first, 
    falling back to the standard Authorization header, and expires tokens 
    based on the last_active timestamp.
    \"\"\"
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
        \"\"\"
        Enforce CSRF validation for session based authentication.
        \"\"\"
        check = CSRFCheck(get_response=lambda r: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')
"""

# Replace the entire file, but keep authenticate_credentials unchanged
# Actually, I need to keep authenticate_credentials as it is!
# Let me just replace from top to authenticate()
# Oh, it's easier to just append enforce_csrf and modify authenticate.

with open("grc-backend/frameworks/authentication.py", "r") as f:
    original = f.read()

# 1. Add imports
original = original.replace("from rest_framework.exceptions import AuthenticationFailed", "from rest_framework.exceptions import AuthenticationFailed\nfrom rest_framework import exceptions\nfrom django.middleware.csrf import CsrfViewMiddleware")

# 2. Add CSRFCheck class
csrf_check_cls = "\nclass CSRFCheck(CsrfViewMiddleware):\n    def _reject(self, request, reason):\n        return reason\n\n"
original = original.replace("class ExpiringTokenAuthentication", csrf_check_cls + "class ExpiringTokenAuthentication")

# 3. Replace authenticate method
old_auth = """    def authenticate(self, request):
        # 1. Check for the HttpOnly cookie first
        token_key = request.COOKIES.get('grc_token')
        
        # 2. Fallback to standard Authorization header
        if not token_key:
            auth_header = request.META.get('HTTP_AUTHORIZATION', '')
            if auth_header.startswith('Token '):
                token_key = auth_header.split(' ')[1]

        if not token_key:
            return None
            
        return self.authenticate_credentials(token_key)"""

new_auth = """    def authenticate(self, request):
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
        \"\"\"
        Enforce CSRF validation for session based authentication.
        \"\"\"
        check = CSRFCheck(get_response=lambda r: None)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise exceptions.PermissionDenied(f'CSRF Failed: {reason}')"""

original = original.replace(old_auth, new_auth)

with open("grc-backend/frameworks/authentication.py", "w") as f:
    f.write(original)
