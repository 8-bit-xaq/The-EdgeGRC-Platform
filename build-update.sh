#!/bin/bash
set -Eeuo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "=========================================="
echo "   🚀 Edge-GRC Update Packaging Tool"
echo "=========================================="

PRIVATE_KEY="grc-backend/configs/vendor_private.pem"
PUBLIC_KEY="grc-backend/configs/update_pub.pem"
if [ ! -f "$PRIVATE_KEY" ]; then
    echo "❌ Signing key not found at ${PRIVATE_KEY}; refusing to create an unsigned update."
    exit 1
fi
if [ ! -f "$PUBLIC_KEY" ]; then
    echo "❌ Appliance update public key not found at ${PUBLIC_KEY}."
    exit 1
fi
if [ ! -x "grc-frontend/node_modules/.bin/next" ]; then
    echo "❌ Frontend dependencies are missing. Run 'npm ci' in grc-frontend first."
    exit 1
fi

PYTHON_EXEC="python3"
if [ -x "grc-backend/.venv/bin/python" ]; then
    PYTHON_EXEC="grc-backend/.venv/bin/python"
elif [ -x "grc-backend/venv/bin/python" ]; then
    PYTHON_EXEC="grc-backend/venv/bin/python"
fi
if ! "$PYTHON_EXEC" -c 'import cryptography' >/dev/null 2>&1; then
    echo "❌ Python package 'cryptography' is required to sign updates."
    exit 1
fi
if ! "$PYTHON_EXEC" - "$PRIVATE_KEY" "$PUBLIC_KEY" <<'PY'
import os
import sys
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

private_path, public_path = sys.argv[1:]
if os.stat(private_path).st_mode & 0o077:
    raise SystemExit("Signing key permissions are too open; restrict access to its owner.")
with open(private_path, "rb") as private_file:
    private_key = load_pem_private_key(private_file.read(), password=None)
with open(public_path, "rb") as public_file:
    public_key = load_pem_public_key(public_file.read())
if private_key.public_key().public_numbers() != public_key.public_numbers():
    raise SystemExit("Signing key does not match the appliance update public key.")
PY
then
    echo "❌ Update signing key validation failed."
    exit 1
fi

# 1. Locate the version.json file (check root or frontend directory)
VERSION_FILE=""
if [ -f "public/version.json" ]; then
    VERSION_FILE="public/version.json"
elif [ -f "grc-frontend/public/version.json" ]; then
    VERSION_FILE="grc-frontend/public/version.json"
fi

CURRENT_VERSION="1.0.0"

# 2. Extract current version if file exists
if [ -n "$VERSION_FILE" ] && [ -f "$VERSION_FILE" ]; then
    CURRENT_VERSION=$(grep -o '"version"[^,]*' "$VERSION_FILE" | cut -d'"' -f4)
fi

echo "Current Platform Version: v${CURRENT_VERSION}"

# 3. Calculate SemVer suggestions
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEXT_PATCH="${MAJOR}.${MINOR}.$((PATCH + 1))"
NEXT_MINOR="${MAJOR}.$((MINOR + 1)).0"
NEXT_MAJOR="$((MAJOR + 1)).0.0"

echo ""
echo "Select new version or enter a custom one:"
echo "  1) Patch release: v${NEXT_PATCH}"
echo "  2) Minor release: v${NEXT_MINOR}"
echo "  3) Major release: v${NEXT_MAJOR}"
echo "  4) Custom version string"
echo "  5) Keep current (v${CURRENT_VERSION})"
echo ""
read -rp "Enter choice [1-5] (default: 1): " CHOICE

case "$CHOICE" in
    2)
        NEW_VERSION="$NEXT_MINOR"
        ;;
    3)
        NEW_VERSION="$NEXT_MAJOR"
        ;;
    4)
        read -rp "Enter custom version (e.g. 1.2.0-rc1): " NEW_VERSION
        ;;
    5)
        NEW_VERSION="$CURRENT_VERSION"
        ;;
    *)
        NEW_VERSION="$NEXT_PATCH"
        ;;
esac

# Clean leading 'v' if user typed it
NEW_VERSION="${NEW_VERSION#v}"
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "❌ Version must be a valid semantic version (for example 1.2.3 or 1.2.3-rc1)."
    exit 1
fi

echo ""
echo "📝 Setting platform version to v${NEW_VERSION}..."

# 4. Update public/version.json
if [ -n "$VERSION_FILE" ]; then
    if [ -n "${UPDATE_COMMIT:-}" ]; then
        if ! [[ "$UPDATE_COMMIT" =~ ^[0-9a-fA-F]{40,64}$ ]]; then
            echo "❌ UPDATE_COMMIT must be a full Git commit SHA."
            exit 1
        fi
        echo "{\"version\": \"${NEW_VERSION}\", \"commit\": \"${UPDATE_COMMIT}\"}" > "$VERSION_FILE"
    else
        echo "{\"version\": \"${NEW_VERSION}\"}" > "$VERSION_FILE"
    fi
fi

# 5. Optionally update package.json if it exists
if [ -f "package.json" ]; then
    sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/" package.json && rm -f package.json.bak
elif [ -f "grc-frontend/package.json" ]; then
    sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/" grc-frontend/package.json && rm -f grc-frontend/package.json.bak
fi

# 6. Build frontend standalone bundle
if ! command -v npm >/dev/null 2>&1; then
    echo "❌ npm is required to build the frontend update."
    exit 1
fi
echo "🔨 Compiling Next.js production standalone distribution..."
(
    cd grc-frontend
    NEXT_PUBLIC_API_URL=/api npm run build
)
if [ ! -f "grc-frontend/.next/standalone/server.js" ]; then
    echo "❌ Frontend build did not produce the required standalone server."
    exit 1
fi

# 7. Create staging directory for clean packaging
STAGE_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'grc-stage')
cleanup() {
    rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

echo "📦 Staging verified release files..."

# Stage Backend
mkdir -p "$STAGE_DIR/grc-backend"
cp -r grc-backend/. "$STAGE_DIR/grc-backend/"
# Remove host-specific and sensitive backend files
rm -rf "$STAGE_DIR/grc-backend/venv" \
       "$STAGE_DIR/grc-backend/.venv" \
       "$STAGE_DIR/grc-backend/db.sqlite3"* \
       "$STAGE_DIR/grc-backend/media" \
       "$STAGE_DIR/grc-backend/staticfiles" \
       "$STAGE_DIR/grc-backend/logs" \
       "$STAGE_DIR/grc-backend/updates" \
       "$STAGE_DIR/grc-backend/backups" \
       "$STAGE_DIR/grc-backend/task_results" \
       "$STAGE_DIR/grc-backend/configs/django_secret.txt" \
       "$STAGE_DIR/grc-backend/configs/appliance_domain.txt" \
       "$STAGE_DIR/grc-backend/configs/vendor_private.pem" \
       "$STAGE_DIR/grc-backend/configs/ssl/appliance_key.pem" \
       "$STAGE_DIR/grc-backend/configs/ssl/appliance_cert.pem" \
       "$STAGE_DIR/grc-backend/.env"*

find "$STAGE_DIR/grc-backend" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$STAGE_DIR/grc-backend" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Stage Frontend
mkdir -p "$STAGE_DIR/grc-frontend"
echo "📋 Staging compiled Next.js standalone runtime..."
cp -r grc-frontend/.next/standalone/. "$STAGE_DIR/grc-frontend/"
if [ -d "$STAGE_DIR/grc-frontend/grc-frontend" ]; then
    cp -r "$STAGE_DIR/grc-frontend/grc-frontend/." "$STAGE_DIR/grc-frontend/"
    rm -rf "$STAGE_DIR/grc-frontend/grc-frontend"
fi
mkdir -p "$STAGE_DIR/grc-frontend/public"
cp -r grc-frontend/public/. "$STAGE_DIR/grc-frontend/public/"
mkdir -p "$STAGE_DIR/grc-frontend/.next/static"
cp -r grc-frontend/.next/static/. "$STAGE_DIR/grc-frontend/.next/static/"
cp grc-frontend/package.json "$STAGE_DIR/grc-frontend/package.json"

# Stage bundled framework library
if [ -d "Frameworks" ]; then
    mkdir -p "$STAGE_DIR/Frameworks"
    cp -r Frameworks/. "$STAGE_DIR/Frameworks/"
fi

# Stage Configuration Files
if [ -d "configs" ]; then
    mkdir -p "$STAGE_DIR/configs"
    cp -r configs/. "$STAGE_DIR/configs/"
    rm -f "$STAGE_DIR/configs/django_secret.txt" \
          "$STAGE_DIR/configs/appliance_domain.txt" \
          "$STAGE_DIR/configs/ssl/appliance_key.pem" \
          "$STAGE_DIR/configs/ssl/appliance_cert.pem"
fi

# 8. Create payload.zip archive
PAYLOAD_ZIP="payload.zip"
OUTPUT_ZIP="update-EdgeGRC.zip"
rm -f "$PAYLOAD_ZIP" "$OUTPUT_ZIP" signature.sig

echo "🗜️  Creating payload.zip from verified stage..."

"$PYTHON_EXEC" - "$STAGE_DIR" "$PAYLOAD_ZIP" <<'PY'
import os
import sys
import zipfile

stage_dir, output_zip = sys.argv[1:]
with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as archive:
    for root, _, files in os.walk(stage_dir):
        for filename in files:
            file_path = os.path.join(root, filename)
            archive.write(file_path, os.path.relpath(file_path, stage_dir))
PY

echo ""

# 9. Cryptographically Sign the Update Payload
if [ ! -f "$PRIVATE_KEY" ]; then
    echo "❌ Signing key disappeared before signing; refusing to create an unsigned update."
    exit 1
fi
if [ -f "grc-backend/configs/vendor_private.pem" ]; then
    echo "🔒 Cryptographically signing payload with vendor_private.pem..."
    $PYTHON_EXEC -c "
import zipfile, sys
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import load_pem_private_key

try:
    with open('grc-backend/configs/vendor_private.pem', 'rb') as f:
        private_key = load_pem_private_key(f.read(), password=None)

    with open('$PAYLOAD_ZIP', 'rb') as f:
        payload_data = f.read()

    signature = private_key.sign(payload_data, padding.PKCS1v15(), hashes.SHA256())

    with open('signature.sig', 'wb') as f:
        f.write(signature)

    with zipfile.ZipFile('$OUTPUT_ZIP', 'w') as zipf:
        zipf.write('$PAYLOAD_ZIP', arcname='payload.zip')
        zipf.write('signature.sig')
except Exception as e:
    print(f'Error during signing: {e}')
    sys.exit(1)
"
    
    if [ $? -eq 0 ]; then
        rm -f "$PAYLOAD_ZIP" signature.sig
        echo "✅ Signature created; validating package structure..."
    else
        echo "❌ Signing failed! Leaving payload as ${PAYLOAD_ZIP}"
    fi
fi

"$PYTHON_EXEC" - "$PUBLIC_KEY" "$OUTPUT_ZIP" <<'PY'
import io
import os
import stat
import sys
import zipfile
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.serialization import load_pem_public_key

public_path, package_path = sys.argv[1:]
if os.path.getsize(package_path) > 500 * 1024 * 1024:
    raise SystemExit("Generated update package exceeds the appliance's 500 MB upload limit.")
with open(public_path, "rb") as key_file:
    public_key = load_pem_public_key(key_file.read())

with zipfile.ZipFile(package_path) as package:
    wrapper_names = package.namelist()
    if len(wrapper_names) != len(set(wrapper_names)) or set(wrapper_names) != {"payload.zip", "signature.sig"}:
        raise SystemExit("Generated update package has an invalid wrapper structure.")
    if package.testzip():
        raise SystemExit("Generated update package failed its ZIP integrity check.")
    payload_data = package.read("payload.zip")
    signature = package.read("signature.sig")

public_key.verify(signature, payload_data, padding.PKCS1v15(), hashes.SHA256())
with zipfile.ZipFile(io.BytesIO(payload_data)) as payload:
    payload_members = payload.infolist()
    payload_names = [member.filename for member in payload_members]
    if len(payload_names) != len(set(payload_names)):
        raise SystemExit("Payload contains duplicate archive paths.")
    expanded_size = 0
    for member in payload_members:
        name = member.filename
        normalized_name = os.path.normpath(name)
        if (
            not name
            or "\\" in name
            or any(part in {".", ".."} for part in name.split("/"))
            or os.path.isabs(name)
            or normalized_name == ".."
            or normalized_name.startswith(".." + os.path.sep)
            or (len(name) > 1 and name[1] == ":")
        ):
            raise SystemExit("Payload contains an unsafe archive path.")
        if stat.S_ISLNK(member.external_attr >> 16):
            raise SystemExit("Payload must not contain symbolic links.")
        if not member.is_dir():
            expanded_size += member.file_size
            if expanded_size > 2 * 1024 * 1024 * 1024:
                raise SystemExit("Expanded payload exceeds the appliance's 2 GB limit.")
    required = {
        "grc-backend/manage.py",
        "grc-frontend/server.js",
        "grc-frontend/public/version.json",
    }
    if not required.issubset(payload_names):
        raise SystemExit("Payload is missing required backend or frontend runtime files.")
    if not any(name.startswith("grc-frontend/.next/static/") for name in payload_names):
        raise SystemExit("Payload is missing the built frontend static assets.")
    if "grc-backend/configs/vendor_private.pem" in payload_names:
        raise SystemExit("Payload must not contain the update signing private key.")
    if payload.testzip():
        raise SystemExit("Payload failed its ZIP integrity check.")
    if payload.testzip():
        raise SystemExit("Payload failed its ZIP integrity check.")
PY

echo "=========================================="
echo "✅ Signed Update package ready: ${OUTPUT_ZIP} (v${NEW_VERSION})"
if command -v du >/dev/null 2>&1; then
    echo "   Size: $(du -h "$OUTPUT_ZIP" | cut -f1)"
fi
echo "=========================================="
