from rest_framework.exceptions import AuthenticationFailed

class DRFTokenAuthMiddleware:
    """
    Reads the DRF Token from the cookies and assigns the user to the request
    early in the request lifecycle so AuditlogMiddleware can see who it is.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token_key = request.COOKIES.get('grc_token')
        
        if not token_key:
            auth_header = request.META.get('HTTP_AUTHORIZATION', '')
            if auth_header.startswith('Token '):
                token_key = auth_header.split(' ')[1]
        
        if token_key:
            from frameworks.authentication import ExpiringTokenAuthentication
            auth = ExpiringTokenAuthentication()
            try:
                user, token = auth.authenticate_credentials(token_key)
                request.user = user
            except AuthenticationFailed:
                pass
                
        return self.get_response(request)