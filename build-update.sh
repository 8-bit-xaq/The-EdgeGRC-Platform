#!/bin/bash
set -e

REPO_DIR=$(pwd)

echo "=========================================="
echo "   🚀 Edge-GRC Update Packaging Tool"
echo "=========================================="

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
NEXT_MINOR="${MAJOR}.$((MINOR 3+ 1)).0"
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

echo ""
echo "📝 Setting platform version to v${NEW_VERSION}..."

# 4. Update public/version.json
if [ -n "$VERSION_FILE" ]; then
    echo "{\"version\": \"${NEW_VERSION}\"}" > "$VERSION_FILE"
fi

# 5. Optionally update package.json if it exists
if [ -f "package.json" ]; then
    sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/" package.json && rm -f package.json.bak
elif [ -f "grc-frontend/package.json" ]; then
    sed -i.bak -E "s/\"version\": \"[^\"]+\"/\"version\": \"${NEW_VERSION}\"/" grc-frontend/package.json && rm -f grc-frontend/package.json.bak
fi

# 6. Build frontend standalone bundle if npm is available
if command -v npm >/dev/null 2>&1 && [ -d "grc-frontend" ]; then
    echo "🔨 Compiling Next.js production standalone distribution..."
    (
        cd grc-frontend
        echo "NEXT_PUBLIC_API_URL=/api" > .env.production
        npm run build
    )
elif [ -d "grc-frontend/.next/standalone" ]; then
    echo "ℹ️  Found existing pre-compiled Next.js standalone distribution. Re-using build."
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
if [ -d "grc-frontend/.next/standalone" ]; then
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
    cp grc-frontend/package.json "$STAGE_DIR/grc-frontend/package.json" 2>/dev/null || true
else
    echo "⚠️  .next/standalone not found. Staging raw frontend tree..."
    cp -r grc-frontend/. "$STAGE_DIR/grc-frontend/"
    rm -rf "$STAGE_DIR/grc-frontend/node_modules" \
           "$STAGE_DIR/grc-frontend/.next" \
           "$STAGE_DIR/grc-frontend/.env"*
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
rm -f "$PAYLOAD_ZIP" "$OUTPUT_ZIP"

echo "🗜️  Creating payload.zip from verified stage..."

PYTHON_EXEC="python3"
if [ -f "grc-backend/venv/bin/python" ]; then
    PYTHON_EXEC="grc-backend/venv/bin/python"
fi

if command -v zip >/dev/null 2>&1; then
    (cd "$STAGE_DIR" && zip -r "$REPO_DIR/$PAYLOAD_ZIP" .)
else
    $PYTHON_EXEC -c "
import zipfile, os

stage_dir = r'$STAGE_DIR'
output_zip = r'$PAYLOAD_ZIP'

with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(stage_dir):
        for file in files:
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, stage_dir)
            z.write(full_path, rel_path)
"
fi

echo ""

# 9. Cryptographically Sign the Update Payload
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
        echo "=========================================="
        echo "✅ Signed Update package ready: ${OUTPUT_ZIP} (v${NEW_VERSION})"
        if command -v du >/dev/null 2>&1; then
            echo "   Size: $(du -h "$OUTPUT_ZIP" | cut -f1)"
        fi
        echo "=========================================="
    else
        echo "❌ Signing failed! Leaving payload as ${PAYLOAD_ZIP}"
    fi
else
    echo "⚠️  WARNING: grc-backend/configs/vendor_private.pem not found!"
    echo "The update will be packaged without a signature and will be rejected by the appliance."
    mv "$PAYLOAD_ZIP" "$OUTPUT_ZIP"
    echo "=========================================="
    echo "⚠️ Unsigned Update package ready: ${OUTPUT_ZIP} (v${NEW_VERSION})"
    echo "=========================================="
fi
