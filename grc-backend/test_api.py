import os
import sys
import django
from io import BytesIO

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "grc_api.settings")
django.setup()

from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

User = get_user_model()
user = User.objects.first()

client = APIClient()
client.force_authenticate(user=user)

with open('test_upload.txt', 'wb') as f:
    f.write(b'Some random text')

with open('test_upload.txt', 'rb') as f:
    res = client.post('/api/controls/PCI-1.1.1/proofs/', {'file': f}, format='multipart')

print("Status:", res.status_code)
print("Content length:", len(res.content))
print("Content:", res.content.decode())
