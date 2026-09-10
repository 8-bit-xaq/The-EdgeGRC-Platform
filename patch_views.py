import re

with open("grc-backend/frameworks/views.py", "r") as f:
    content = f.read()

# Add get_token import
if "from django.middleware.csrf import get_token" not in content:
    content = content.replace("from django.middleware.csrf import CsrfViewMiddleware", "from django.middleware.csrf import CsrfViewMiddleware, get_token")
    if "from django.middleware.csrf import get_token" not in content:
        content = "from django.middleware.csrf import get_token\n" + content

# Modify CustomAuthToken
def patch_custom_auth(match):
    body = match.group(0)
    if "get_token(request)" not in body:
        body = body.replace("response = Response({", "get_token(request)\n        response = Response({")
    return body

content = re.sub(r'class CustomAuthToken\(ObtainAuthToken\):.*?return response', patch_custom_auth, content, flags=re.DOTALL)

# Modify VerifySessionView
def patch_verify(match):
    body = match.group(0)
    if "get_token(request)" not in body:
        body = body.replace("return Response({", "get_token(request)\n        return Response({")
    return body

content = re.sub(r'class VerifySessionView\(APIView\):.*?return Response\(\{', patch_verify, content, flags=re.DOTALL)

with open("grc-backend/frameworks/views.py", "w") as f:
    f.write(content)
