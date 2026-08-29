#!/bin/bash
set -e

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

# 6. Package the zip archive with safe exclusions
OUTPUT_ZIP="update-EdgeGRC.zip"
rm -f "$OUTPUT_ZIP"

echo "📦 Packaging Edge-GRC v${NEW_VERSION} into ${OUTPUT_ZIP}..."

zip -r "$OUTPUT_ZIP" . \
  -x "*/node_modules/*" \
     "*/.next/*" \
     "*/venv/*" \
     "*/.venv/*" \
     "*/db.sqlite3*" \
     "*/__pycache__/*" \
     "*.pyc" \
     "*/media/*" \
     "*/staticfiles/*" \
     "*/.git/*" \
     "*/.github/*" \
     "*/.vscode/*" \
     "*/.idea/*" \
     "*.zip" \
     "*/updates/*" \
     "*/configs/django_secret.txt" \
     "*/configs/ssl/appliance_key.pem" \
     "*/configs/ssl/appliance_cert.pem" \
     "*/.env*" \
     "*/.DS_Store" \
     "Thumbs.db"

echo ""
echo "=========================================="
echo "✅ Update package ready: ${OUTPUT_ZIP} (v${NEW_VERSION})"
echo "   Size: $(du -h "$OUTPUT_ZIP" | cut -f1)"
echo "=========================================="