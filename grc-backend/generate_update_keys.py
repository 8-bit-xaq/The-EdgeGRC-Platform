import os
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

configs_dir = os.path.join(os.path.dirname(__file__), 'configs')
os.makedirs(configs_dir, exist_ok=True)
pub_key_path = os.path.join(configs_dir, 'update_pub.pem')
priv_key_path = os.path.join(configs_dir, 'vendor_private.pem')

if not os.path.exists(pub_key_path):
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    
    with open(priv_key_path, 'wb') as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption()
        ))
        
    public_key = private_key.public_key()
    with open(pub_key_path, 'wb') as f:
        f.write(public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo
        ))
    print(f"Generated new keys:\nPublic: {pub_key_path}\nPrivate (Keep secret!): {priv_key_path}")
else:
    print("Keys already exist.")
