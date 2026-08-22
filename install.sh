#!/bin/bash
# GRC Appliance - Automated Ubuntu x86 Installer
# Must be run with sudo

set -e
REPO_DIR=$(pwd)

echo "========================================"
echo " Starting GRC Appliance Installation... "
echo "========================================"
echo ""
echo "--- Quick Configuration ---"

# Prompt for custom options, using defaults if left blank
read -p "Enter the Domain or IP for the appliance [edge-grc.local]: " APP_DOMAIN
APP_DOMAIN=${APP_DOMAIN:-edge-grc.local}

echo "---------------------------"
echo ""

# 1. Update system and install base dependencies
echo "[1/6] Installing system dependencies..."
apt-get update
apt-get install -y python3-pip python3-venv python3-dev nginx curl unzip openssl

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# 2. Build the Next.js Frontend
echo "[2/6] Compiling Next.js Frontend..."
cd $REPO_DIR/grc-frontend
npm install
echo "NEXT_PUBLIC_API_URL=/api" > .env.production
npm run build
cd $REPO_DIR

# 3. Set up the installation directory
echo "[3/6] Staging application files..."
INSTALL_DIR="/opt/grc-appliance"
mkdir -p $INSTALL_DIR

# Copy application files (assumes script is run from the extracted release folder)
cp -r grc-backend $INSTALL_DIR/
cp -r grc-frontend/.next/standalone $INSTALL_DIR/grc-frontend
cp -r grc-frontend/public $INSTALL_DIR/grc-frontend/public
cp -r grc-frontend/.next/static $INSTALL_DIR/grc-frontend/.next/static

# Initialize SSL Directory so it exists when the user enables HTTPS later
SSL_DIR="$INSTALL_DIR/grc-backend/configs/ssl"
mkdir -p $SSL_DIR

# 4. Configure the Python Backend
echo "[4/6] Configuring Django backend..."
cd $INSTALL_DIR/grc-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
python manage.py migrate
python manage.py collectstatic --noinput

# Fix permissions so Django (www-data) can overwrite files, lock the DB, and read static assets
chown -R www-data:www-data $INSTALL_DIR

# 5. Install Systemd Services
echo "[5/6] Installing background services..."
cp $REPO_DIR/configs/grc-backend.service /etc/systemd/system/
cp $REPO_DIR/configs/grc-frontend.service /etc/systemd/system/

# Create the Systemd SSL Watcher
cat <<EOF > /etc/systemd/system/grc-ssl-watcher.path
[Unit]
Description=Watch for GRC SSL Certificate changes

[Path]
PathModified=$SSL_DIR/appliance_cert.pem

[Install]
WantedBy=multi-user.target
EOF

cat <<EOF > /etc/systemd/system/grc-ssl-watcher.service
[Unit]
Description=Reload Nginx after GRC SSL update

[Service]
Type=oneshot
ExecStart=/bin/systemctl reload nginx
EOF

systemctl daemon-reload
systemctl enable --now grc-backend
systemctl enable --now grc-frontend
systemctl enable --now grc-ssl-watcher.path

# --- ADD THIS NEW SECURITY BLOCK ---
echo "Configuring strict least-privilege update permissions..."
cat <<EOF > /etc/sudoers.d/grc-updater
www-data ALL=(root) NOPASSWD: /bin/systemctl restart grc-backend, /bin/systemctl restart grc-frontend
EOF

# Sudoers files will be ignored if permissions are too open
chmod 0440 /etc/sudoers.d/grc-updater
# -----------------------------------

# 6. Configure Nginx Reverse Proxy
echo "[6/6] Configuring Nginx web server..."
rm -f /etc/nginx/sites-enabled/default

NGINX_CONF="$INSTALL_DIR/grc-backend/configs/nginx.conf"

# Generate the initial HTTP-only configuration
cat <<EOF > $NGINX_CONF
server {
    listen 80;
    server_name ${APP_DOMAIN};
    client_max_body_size 500M;
    
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }
    
    location /media/ {
        alias /opt/grc-appliance/grc-backend/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Grant ownership to the web app so it can be rewritten via the UI
chown www-data:www-data $NGINX_CONF

# Symlink to Nginx
ln -s $NGINX_CONF /etc/nginx/sites-enabled/grc-appliance
systemctl restart nginx

echo "========================================"
echo " Installation Complete! "
echo " The appliance is now running."
echo " Access it via http://${APP_DOMAIN}"
echo "========================================"