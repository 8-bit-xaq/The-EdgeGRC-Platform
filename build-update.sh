#!/bin/bash
echo "📦 Packaging Edge-GRC Update..."

# Remove old zip if it exists
rm -f update-EdgeGRC.zip

# Run the strict exclusion zip command
zip -r update-EdgeGRC.zip . -x "*/node_modules/*" "*/.next/*" "*/venv/*" "*/db.sqlite3" "*/__pycache__/*" "*/media/*" "*/.git/*"

echo "✅ Update package ready: update-EdgeGRC.zip"
