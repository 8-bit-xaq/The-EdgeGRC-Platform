#!/bin/bash
# GRC Appliance - Automated Ubuntu x86 Installer
# Must be run with sudo

set -e

echo "========================================"
echo " Starting GRC Appliance Installation... "
echo "========================================"

# 1. Update system and install base dependencies
echo "[1/5] Installing system dependencies..."
apt-get update
apt-get install -y python3-pip python3-venv python3-dev nginx curl unzip

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. Set up the installation directory
echo "[2/5] Staging application files..."
INSTALL_DIR="/opt/grc-appliance"
mkdir -p $INSTALL_DIR

# Copy application files (assumes script is run from the extracted release folder)
cp -r grc-backend $INSTALL_DIR/
cp -r grc-frontend/.next/standalone $INSTALL_DIR/grc-frontend
cp -r grc-frontend/public $INSTALL_DIR/grc-frontend/public
cp -r grc-frontend/.next/static $INSTALL_DIR/grc-frontend/.next/static

# Fix permissions
chown -R www-data:www-data $INSTALL_DIR

# 3. Configure the Python Backend
echo "[3/5] Configuring Django backend..."
cd $INSTALL_DIR/grc-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
python manage.py migrate
python manage.py collectstatic --noinput
chown -R www-data:www-data db.sqlite3 media/ # Ensure web server can write to DB and media

# 4. Install Systemd Services
echo "[4/5] Installing background services..."
cp ../../configs/grc-backend.service /etc/systemd/system/
cp ../../configs/grc-frontend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now grc-backend
systemctl enable --now grc-frontend

# 5. Configure Nginx Reverse Proxy
echo "[5/5] Configuring Nginx web server..."
rm -f /etc/nginx/sites-enabled/default
cp ../../configs/nginx.conf /etc/nginx/sites-available/grc-appliance
ln -s /etc/nginx/sites-available/grc-appliance /etc/nginx/sites-enabled/
systemctl restart nginx

echo "========================================"
echo " Installation Complete! "
echo " The appliance is now running on port 80."
echo " Access it via your server's IP address."
echo "========================================"