from rest_framework.authtoken.models import Token

class DRFTokenAuthMiddleware:
    """
    Reads the DRF Token from the headers and assigns the user to the request
    early in the request lifecycle so AuditlogMiddleware can see who it is.
    """
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        
        if auth_header.startswith('Token '):
            token_key = auth_header.split(' ')[1]
            try:
                token = Token.objects.get(key=token_key)
                request.user = token.user
            except Token.DoesNotExist:
                pass
                
        return self.get_response(request)