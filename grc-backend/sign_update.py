import sys
import zipfile
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import load_pem_private_key

if len(sys.argv) != 2:
    print("Usage: python sign_update.py <path_to_update_payload.zip>")
    sys.exit(1)

payload_path = sys.argv[1]
with open('configs/vendor_private.pem', 'rb') as f:
    private_key = load_pem_private_key(f.read(), password=None)

with open(payload_path, 'rb') as f:
    payload_data = f.read()

signature = private_key.sign(
    payload_data,
    padding.PKCS1v15(),
    hashes.SHA256()
)

with open('signature.sig', 'wb') as f:
    f.write(signature)

package_name = 'signed_update.zip'
with zipfile.ZipFile(package_name, 'w') as zipf:
    zipf.write(payload_path, arcname='payload.zip')
    zipf.write('signature.sig')

print(f"Successfully generated signed update package: {package_name}")
