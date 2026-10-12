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
PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
if [ -n "$PRIMARY_IP" ]; then
    echo "Detected local LAN IP: ${PRIMARY_IP}"
fi
read -p "Enter the Domain or IP for the appliance [edge-grc.local]: " APP_DOMAIN
APP_DOMAIN=${APP_DOMAIN:-edge-grc.local}

echo "---------------------------"
echo ""

# 1. Update system and install base dependencies
echo "[1/6] Installing system dependencies..."
apt-get update
apt-get install -y python3-pip python3-venv python3-dev nginx curl unzip zip openssl libmagic1 ufw fail2ban unattended-upgrades logrotate

# Ensure adequate swap memory (minimum 2GB) to protect against OOM spikes during Next.js builds and background tasks
SWAP_TOTAL=$(free -m | awk '/^Swap:/ {print $2}')
if [ -z "$SWAP_TOTAL" ] || [ "$SWAP_TOTAL" -lt 1000 ]; then
    echo "Configuring 2GB swap file to prevent out-of-memory errors..."
    if [ ! -f /swapfile ]; then
        fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
        chmod 600 /swapfile
        mkswap /swapfile
        swapon /swapfile
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
fi

# Install Node.js 22.x LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# 2. Build the Next.js Frontend
echo "[2/6] Compiling Next.js Frontend..."
cd $REPO_DIR/grc-frontend
if [ ! -d ".next/standalone" ]; then
    npm ci
    echo "NEXT_PUBLIC_API_URL=/api" > .env.production
    npm run build
else
    echo "Found pre-compiled Next.js standalone build. Using existing distribution."
fi
cd $REPO_DIR

# 3. Set up the installation directory
echo "[3/6] Staging application files..."
INSTALL_DIR="/opt/grc-appliance"
mkdir -p $INSTALL_DIR

# Copy application files (assumes script is run from the extracted release folder)
mkdir -p $INSTALL_DIR/grc-backend
cp -r grc-backend/. $INSTALL_DIR/grc-backend/
mkdir -p $INSTALL_DIR/grc-frontend
cp -r grc-frontend/.next/standalone/. $INSTALL_DIR/grc-frontend/
mkdir -p $INSTALL_DIR/grc-frontend/public
cp -r grc-frontend/public/. $INSTALL_DIR/grc-frontend/public/
mkdir -p $INSTALL_DIR/grc-frontend/.next/static
cp -r grc-frontend/.next/static/. $INSTALL_DIR/grc-frontend/.next/static/
# If Next.js preserved a nested monorepo directory structure, flatten it
if [ -d "$INSTALL_DIR/grc-frontend/grc-frontend" ]; then
    cp -r $INSTALL_DIR/grc-frontend/grc-frontend/. $INSTALL_DIR/grc-frontend/
    rm -rf $INSTALL_DIR/grc-frontend/grc-frontend
fi

# Security: Ensure vendor private signing key is never left on the customer appliance
rm -f "$INSTALL_DIR/grc-backend/configs/vendor_private.pem"

# Initialize SSL and Configuration Directories
SSL_DIR="$INSTALL_DIR/grc-backend/configs/ssl"
mkdir -p $SSL_DIR
echo "${APP_DOMAIN}" > "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"
if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
    echo "${PRIMARY_IP}" >> "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"
fi
mkdir -p "$INSTALL_DIR/grc-backend/logs"

# 4. Configure the Python Backend
echo "[4/6] Configuring Django backend..."
cd $INSTALL_DIR/grc-backend

# Day-0 Security: Generate cryptographically random 16-character administrative password
INITIAL_PW=$(openssl rand -base64 12)
echo "$INITIAL_PW" > "$INSTALL_DIR/INITIAL_ADMIN_PASSWORD"
chmod 600 "$INSTALL_DIR/INITIAL_ADMIN_PASSWORD"

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn
python manage.py migrate
python manage.py collectstatic --noinput

# Verify the vendor public key exists so updates can be cryptographically verified
if [ ! -f "configs/update_pub.pem" ]; then
    echo "❌ ERROR: configs/update_pub.pem missing! Cannot install appliance without vendor public key."
    exit 1
fi

# Create a default Admin user so the end-user can log in immediately
cat <<PYEOF > setup_admin.py
import os
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "grc_api.settings")
django.setup()

from django.contrib.auth import get_user_model
User = get_user_model()

if not User.objects.filter(username='admin').exists():
    pw_file = '/opt/grc-appliance/INITIAL_ADMIN_PASSWORD'
    initial_pw = open(pw_file).read().strip() if os.path.exists(pw_file) else 'ChangeMe123!'
    user = User.objects.create_superuser('admin', 'admin@edge-grc.local', initial_pw)
    if hasattr(user, 'profile'):
        user.profile.role = 'Admin'
        user.profile.must_change_password = True
        user.profile.save()
    print("✅ Created default Admin account with generated password.")
PYEOF
python setup_admin.py
rm setup_admin.py

# Fix permissions so Django (www-data) can overwrite files, lock the DB, and read static assets
chown -R www-data:www-data $INSTALL_DIR

# 5. Install Systemd Services
echo "[5/6] Installing background services..."
cp $REPO_DIR/configs/grc-backend.service /etc/systemd/system/
cp $REPO_DIR/configs/grc-frontend.service /etc/systemd/system/
cp $REPO_DIR/configs/grc-worker.service /etc/systemd/system/

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
systemctl enable --now grc-worker
systemctl enable --now grc-ssl-watcher.path

# Configure Journald Log Rotation
echo "Configuring log rotation limits..."
mkdir -p /etc/systemd/journald.conf.d
cat <<JEOF > /etc/systemd/journald.conf.d/grc-appliance.conf
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=1month
JEOF
systemctl restart systemd-journald

# Configure Application Log Rotation
if [ -f "$REPO_DIR/configs/logrotate-grc" ]; then
    cp "$REPO_DIR/configs/logrotate-grc" /etc/logrotate.d/grc-appliance
    chmod 0644 /etc/logrotate.d/grc-appliance
fi

# Configure Host Firewall (UFW)
echo "Configuring Host Firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH Remote Management'
ufw allow 80/tcp comment 'GRC Appliance HTTP'
ufw allow 443/tcp comment 'GRC Appliance HTTPS'
ufw --force enable

# Configure Fail2ban Login Protection
echo "Configuring Fail2ban login rate-limiting..."
mkdir -p /etc/fail2ban/jail.d /etc/fail2ban/filter.d
cat <<F2BEOF > /etc/fail2ban/jail.d/grc-login.local
[nginx-grc-login]
enabled = true
port = http,https
filter = nginx-grc-login
logpath = /var/log/nginx/access.log
maxretry = 10
findtime = 600
bantime = 3600
F2BEOF

cat <<F2BFILTER > /etc/fail2ban/filter.d/nginx-grc-login.conf
[Definition]
failregex = ^<HOST> -.* "(POST /api/login/|POST /api/users/change-password/).*" (400|401|403)
ignoreregex =
F2BFILTER

systemctl restart fail2ban || true

# Enable Automated OS Security Updates
systemctl enable --now unattended-upgrades || true

# --- ADD THIS NEW SECURITY BLOCK ---
echo "Configuring strict least-privilege update permissions..."
cat <<EOF > /etc/sudoers.d/grc-updater
www-data ALL=(root) NOPASSWD: /bin/systemctl restart grc-backend grc-frontend grc-worker, /bin/systemctl restart grc-backend, /bin/systemctl restart grc-frontend, /bin/systemctl restart grc-worker, /usr/bin/systemctl restart grc-backend grc-frontend grc-worker, /usr/bin/systemctl restart grc-backend, /usr/bin/systemctl restart grc-frontend, /usr/bin/systemctl restart grc-worker
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

    # Security: Hide Nginx version banner
    server_tokens off;

    # Baseline Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # Restrict standard request body size to 25MB
    client_max_body_size 25M;
    
    # Allow large payloads exclusively for system updates and database restores
    location /api/update/ {
        client_max_body_size 500M;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

    location /api/restore/ {
        client_max_body_size 500M;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
    }

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
    
    location /static/ {
        alias /opt/grc-appliance/grc-backend/staticfiles/;
    }

    location /media/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /protected_media/ {
        internal;
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
ln -sf $NGINX_CONF /etc/nginx/sites-enabled/grc-appliance
systemctl restart nginx

chmod 600 $INSTALL_DIR/INITIAL_ADMIN_PASSWORD 2>/dev/null || true

INITIAL_ADMIN_PW=$(cat $INSTALL_DIR/INITIAL_ADMIN_PASSWORD 2>/dev/null || echo "See $INSTALL_DIR/INITIAL_ADMIN_PASSWORD")

echo "========================================"
echo " Installation Complete! "
echo " The appliance is now running."
echo " Access it via: http://${APP_DOMAIN}"
if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
    echo " (Or directly via LAN IP: http://${PRIMARY_IP})"
fi
echo " Default Login: admin / ${INITIAL_ADMIN_PW}"
echo " Note: Mandatory password change required on first login."
echo " Initial password saved to: ${INSTALL_DIR}/INITIAL_ADMIN_PASSWORD"
echo "========================================"