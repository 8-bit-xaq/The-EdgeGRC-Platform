#!/bin/bash
# ==============================================================================
# Edge-GRC Appliance - Enterprise Automated Installer
# Platform: Ubuntu 20.04 / 22.04 / 24.04 LTS & Debian 11 / 12 (x86_64 / arm64)
# ==============================================================================

set -e
REPO_DIR=$(pwd)
INSTALL_DIR="/opt/grc-appliance"

# --- ANSI Color Palette ---
BOLD=$(printf '\033[1m')
DIM=$(printf '\033[2m')
RESET=$(printf '\033[0m')
GREEN=$(printf '\033[0;32m')
RED=$(printf '\033[0;31m')
YELLOW=$(printf '\033[0;33m')
BLUE=$(printf '\033[0;34m')
CYAN=$(printf '\033[0;36m')
MAGENTA=$(printf '\033[0;35m')

# --- Logging Helpers ---
log_step()    { echo -e "\n${CYAN}${BOLD}[$1]${RESET} ${BOLD}$2${RESET}"; }
log_success() { echo -e "  ${GREEN}✔${RESET} $1"; }
log_warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
log_error()   { echo -e "  ${RED}✖${RESET} $1"; }
log_info()    { echo -e "  ${BLUE}ℹ${RESET} $1"; }

load_postgres_config() {
    local config_file="$1"
    local key value

    while IFS='=' read -r key value || [ -n "$key" ]; do
        key="${key%$'\r'}"
        value="${value%$'\r'}"
        value="${value#\"}"
        value="${value%\"}"
        value="${value#\'}"
        value="${value%\'}"

        case "$key" in
            DB_ENGINE) DB_ENGINE="$value" ;;
            POSTGRES_DB) POSTGRES_DB="$value" ;;
            POSTGRES_USER) POSTGRES_USER="$value" ;;
            POSTGRES_PASSWORD) POSTGRES_PASSWORD="$value" ;;
            POSTGRES_HOST) POSTGRES_HOST="$value" ;;
            POSTGRES_PORT) POSTGRES_PORT="$value" ;;
        esac
    done < "$config_file"
}

# --- Default Configuration Variables ---
APP_DOMAIN=""
ADMIN_PASSWORD=""
ADMIN_EMAIL=""
CUSTOM_PASSWORD_PROVIDED=false
ENABLE_SSL=true
SSL_FLAG_SET=false
ENABLE_UFW=true
ENABLE_SWAP=true
NON_INTERACTIVE=false
UPGRADE_MODE=false
DB_ENGINE="sqlite"
POSTGRES_HOST="127.0.0.1"
POSTGRES_PORT="5432"
POSTGRES_DB="edgegrc"
POSTGRES_USER="edgegrc_user"
POSTGRES_PASSWORD=""
POSTGRES_LOCAL=true
DB_FLAG_SET=false

# --- Help / Usage Menu ---
show_help() {
    cat <<EOF
${BOLD}Edge-GRC Appliance - Automated Installer${RESET}

${BOLD}Usage:${RESET}
  sudo ./install.sh [OPTIONS]

${BOLD}Options:${RESET}
  -d, --domain <DOMAIN/IP>     Appliance domain or IP (default: detected LAN IP or edge-grc.local)
  -p, --admin-password <PASS>  Set initial admin password (default: cryptographically random 16-char)
  -e, --admin-email <EMAIL>    Set initial admin email (default: admin@<domain>)
      --ssl                    Enable out-of-the-box self-signed HTTPS certificate (port 443) [Default]
      --skip-ssl, --no-ssl     Disable SSL and install in HTTP-only mode (port 80)
      --skip-ufw, --no-ufw     Skip UFW host firewall configuration
      --skip-swap, --no-swap   Skip 2GB swap file creation
      --db <sqlite|postgres>   Database engine: 'sqlite' or 'postgres' (default: sqlite)
      --db-host <HOST>         PostgreSQL host (default: 127.0.0.1)
      --db-port <PORT>         PostgreSQL port (default: 5432)
      --db-name <NAME>         PostgreSQL database name (default: edgegrc)
      --db-user <USER>         PostgreSQL user (default: edgegrc_user)
      --db-password <PASS>     PostgreSQL user password
  -y, --yes, --non-interactive Run in automated unattended mode using defaults or provided flags
  -h, --help                   Display this help documentation and exit

${BOLD}Examples:${RESET}
  # Interactive installation with guided menus:
  sudo ./install.sh

  # Automated headless deployment with PostgreSQL:
  sudo ./install.sh -y --domain 192.168.1.150 --ssl --db postgres

  # Custom unattended deployment with external PostgreSQL:
  sudo ./install.sh -y -d grc.corp.local --db postgres --db-host db.corp.local --db-password "P@ss123" --ssl
EOF
    exit 0
}

# Allow viewing help documentation without root privileges
for arg in "$@"; do
    if [ "$arg" = "-h" ] || [ "$arg" = "--help" ]; then
        show_help
    fi
done

# --- Pre-Flight Root Verification ---
if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}${BOLD}Error:${RESET} This installer must be run with administrative privileges."
    echo -e "Please re-run using: ${CYAN}${BOLD}sudo ./install.sh${RESET}\n"
    exit 1
fi

# --- Command-Line Argument Parsing ---
while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--domain)
            APP_DOMAIN="$2"
            shift 2
            ;;
        -p|--admin-password)
            ADMIN_PASSWORD="$2"
            CUSTOM_PASSWORD_PROVIDED=true
            shift 2
            ;;
        -e|--admin-email)
            ADMIN_EMAIL="$2"
            shift 2
            ;;
        --ssl)
            ENABLE_SSL=true
            SSL_FLAG_SET=true
            shift
            ;;
        --skip-ssl|--no-ssl)
            ENABLE_SSL=false
            SSL_FLAG_SET=true
            shift
            ;;
        --skip-ufw|--no-ufw)
            ENABLE_UFW=false
            shift
            ;;
        --skip-swap|--no-swap)
            ENABLE_SWAP=false
            shift
            ;;
        --db)
            DB_ENGINE="$2"
            DB_FLAG_SET=true
            shift 2
            ;;
        --db-host)
            POSTGRES_HOST="$2"
            POSTGRES_LOCAL=false
            shift 2
            ;;
        --db-port)
            POSTGRES_PORT="$2"
            shift 2
            ;;
        --db-name)
            POSTGRES_DB="$2"
            shift 2
            ;;
        --db-user)
            POSTGRES_USER="$2"
            shift 2
            ;;
        --db-password)
            POSTGRES_PASSWORD="$2"
            shift 2
            ;;
        -y|--yes|--non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${RED}Unknown option: $1${RESET}"
            echo "Run 'sudo ./install.sh --help' for available options."
            exit 1
            ;;
    esac
done

# --- Network & System Detection ---
PRIMARY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
FREE_DISK_GB=$(df -BG /opt 2>/dev/null | awk 'NR==2 {gsub("G","",$4); print $4}')

clear 2>/dev/null || true
echo -e "${MAGENTA}${BOLD}======================================================${RESET}"
echo -e "${MAGENTA}${BOLD}          🚀 Edge-GRC Appliance Installer            ${RESET}"
echo -e "${MAGENTA}${BOLD}======================================================${RESET}"
echo -e " Detected Host: ${CYAN}$(hostname)${RESET} | Architecture: ${CYAN}$(uname -m)${RESET}"
if [ -n "$PRIMARY_IP" ]; then
    echo -e " Detected LAN IP: ${CYAN}${PRIMARY_IP}${RESET}"
fi
echo -e " Total RAM: ${CYAN}${TOTAL_RAM_MB:-Unknown} MB${RESET} | Free Disk in /opt: ${CYAN}${FREE_DISK_GB:-Unknown} GB${RESET}"
echo -e "${MAGENTA}${BOLD}------------------------------------------------------${RESET}"

# --- Pre-Flight Checks ---
log_info "Running pre-flight system checks..."

# Check existing installation
if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/grc-backend/manage.py" ]; then
    log_warn "Existing Edge-GRC installation detected at ${INSTALL_DIR}."
    if [ "$NON_INTERACTIVE" = true ]; then
        log_info "Running in non-interactive mode: Performing safe upgrade (preserving database & certificates)."
        UPGRADE_MODE=true
    else
        echo ""
        echo -e "  ${BOLD}Select installation action:${RESET}"
        echo -e "    1) ${GREEN}${BOLD}Upgrade / Repair${RESET} (preserves database, certificates, and media)"
        echo -e "    2) ${RED}${BOLD}Clean Reinstall${RESET} (resets configuration; backs up previous database)"
        read -rp "  Enter choice [1-2] (default: 1): " INSTALL_ACTION
        if [ "$INSTALL_ACTION" = "2" ]; then
            UPGRADE_MODE=false
            log_warn "Clean reinstall selected. Creating automatic backup of previous data..."
            BACKUP_STAMP=$(date +%Y%m%d_%H%M%S)
            mkdir -p "/opt/grc-backups/pre-clean-${BACKUP_STAMP}"
            cp -a "$INSTALL_DIR/grc-backend/db.sqlite3"* "/opt/grc-backups/pre-clean-${BACKUP_STAMP}/" 2>/dev/null || true
            cp -a "$INSTALL_DIR/grc-backend/configs" "/opt/grc-backups/pre-clean-${BACKUP_STAMP}/" 2>/dev/null || true
            cp -a "$INSTALL_DIR/grc-backend/media" "/opt/grc-backups/pre-clean-${BACKUP_STAMP}/" 2>/dev/null || true
            log_success "Backup preserved in /opt/grc-backups/pre-clean-${BACKUP_STAMP}/"
        else
            UPGRADE_MODE=true
            log_info "Upgrade mode active. Existing database and keys will be preserved."
        fi
    fi
fi

if [ "$UPGRADE_MODE" = true ] && [ -f "$INSTALL_DIR/grc-backend/configs/db.env" ]; then
    load_postgres_config "$INSTALL_DIR/grc-backend/configs/db.env"
    DB_ENGINE="${DB_ENGINE,,}"
    if [ "$DB_ENGINE" != "postgres" ] && [ "$DB_ENGINE" != "postgresql" ]; then
        log_error "Existing database configuration does not specify PostgreSQL."
        exit 1
    fi
    if [ -z "$POSTGRES_PASSWORD" ]; then
        log_error "Existing PostgreSQL configuration has no password. Restore POSTGRES_PASSWORD in $INSTALL_DIR/grc-backend/configs/db.env before upgrading."
        exit 1
    fi
    if [ "$POSTGRES_HOST" = "127.0.0.1" ] || [ "$POSTGRES_HOST" = "localhost" ] || [ "$POSTGRES_HOST" = "::1" ]; then
        POSTGRES_LOCAL=true
    else
        POSTGRES_LOCAL=false
    fi
fi

# Check for port conflicts (Ports 80 and 443)
if command -v ss >/dev/null 2>&1; then
    PORT_80_PROC=$(ss -tlpn 2>/dev/null | grep ':80 ' | awk '{print $NF}' | head -n1)
    if [ -n "$PORT_80_PROC" ] && ! echo "$PORT_80_PROC" | grep -qi "nginx"; then
        log_warn "Port 80 is occupied by non-Nginx process: ${PORT_80_PROC}. Nginx may conflict."
    fi
    PORT_443_PROC=$(ss -tlpn 2>/dev/null | grep ':443 ' | awk '{print $NF}' | head -n1)
    if [ -n "$PORT_443_PROC" ] && ! echo "$PORT_443_PROC" | grep -qi "nginx"; then
        log_warn "Port 443 is occupied by non-Nginx process: ${PORT_443_PROC}."
    fi
fi

# --- Interactive Configuration Menu ---
if [ "$NON_INTERACTIVE" = false ]; then
    echo ""
    echo -e "${BOLD}${BLUE}--- [Step 1/5] Network & Domain Configuration ---${RESET}"
    if [ -z "$APP_DOMAIN" ]; then
        echo -e "Choose how clients will access this appliance:"
        if [ -n "$PRIMARY_IP" ]; then
            echo -e "  1) Detected Local IP (${GREEN}${PRIMARY_IP}${RESET}) [Recommended for internal networks]"
            echo -e "  2) Default Hostname (${CYAN}edge-grc.local${RESET})"
            echo -e "  3) Custom Domain or FQDN (e.g. grc.mycorp.internal)"
            read -rp "Select option [1-3] (default: 1): " DOMAIN_CHOICE
            case "$DOMAIN_CHOICE" in
                2)
                    APP_DOMAIN="edge-grc.local"
                    ;;
                3)
                    read -rp "Enter your custom domain / FQDN: " CUSTOM_INPUT
                    APP_DOMAIN=${CUSTOM_INPUT:-edge-grc.local}
                    ;;
                *)
                    APP_DOMAIN="$PRIMARY_IP"
                    ;;
            esac
        else
            read -rp "Enter Domain or IP for appliance [edge-grc.local]: " CUSTOM_INPUT
            APP_DOMAIN=${CUSTOM_INPUT:-edge-grc.local}
        fi
    else
        log_info "Using pre-configured domain: ${APP_DOMAIN}"
    fi

    echo ""
    echo -e "${BOLD}${BLUE}--- [Step 2/5] Security & SSL / HTTPS ---${RESET}"
    if [ "$SSL_FLAG_SET" = false ]; then
        echo -e "Enable Self-Signed HTTPS out of the box? (Port 443 with modern TLS)"
        read -rp "Enable HTTPS now? [Y/n] (default: Y): " SSL_INPUT
        if [[ "$SSL_INPUT" =~ ^[Nn] ]]; then
            ENABLE_SSL=false
            log_info "Selected: HTTP-only mode (Port 80). HTTPS can be configured later in Admin settings."
        else
            ENABLE_SSL=true
            log_info "Selected: HTTPS mode (Self-signed certificate generated automatically)."
        fi
    else
        log_info "SSL configuration pre-set to: ${ENABLE_SSL}"
    fi

    echo ""
    echo -e "${BOLD}${BLUE}--- [Step 3/5] Pluggable Database Architecture ---${RESET}"
    if [ "$DB_FLAG_SET" = false ] && [ "$UPGRADE_MODE" = false ]; then
        echo -e "Choose the database architecture for this appliance:"
        echo -e "  1) Embedded SQLite3 (Zero configuration, high-concurrency WAL mode) [Recommended]"
        echo -e "  2) PostgreSQL (Enterprise, high-concurrency local server or remote cluster)"
        read -rp "Select database engine [1-2] (default: 1): " DB_CHOICE
        if [ "$DB_CHOICE" = "2" ]; then
            DB_ENGINE="postgres"
            echo -e "Configure PostgreSQL deployment:"
            echo -e "  1) Automated Local PostgreSQL (installs & manages PostgreSQL on this host)"
            echo -e "  2) External / Remote PostgreSQL (AWS RDS, Azure, or remote server)"
            read -rp "Select option [1-2] (default: 1): " PG_CHOICE
            if [ "$PG_CHOICE" = "2" ]; then
                POSTGRES_LOCAL=false
                read -rp "Enter PostgreSQL Host [127.0.0.1]: " PG_H
                POSTGRES_HOST=${PG_H:-127.0.0.1}
                read -rp "Enter PostgreSQL Port [5432]: " PG_P
                POSTGRES_PORT=${PG_P:-5432}
                read -rp "Enter Database Name [edgegrc]: " PG_D
                POSTGRES_DB=${PG_D:-edgegrc}
                read -rp "Enter Database User [edgegrc_user]: " PG_U
                POSTGRES_USER=${PG_U:-edgegrc_user}
                read -rsp "Enter Database Password: " PG_PW
                echo ""
                POSTGRES_PASSWORD="$PG_PW"
            else
                POSTGRES_LOCAL=true
                POSTGRES_HOST="127.0.0.1"
                POSTGRES_PORT="5432"
                POSTGRES_DB="edgegrc"
                POSTGRES_USER="edgegrc_user"
                POSTGRES_PASSWORD=$(openssl rand -base64 16)
            fi
            log_info "Selected: PostgreSQL (${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB})"
        else
            DB_ENGINE="sqlite"
            log_info "Selected: Embedded SQLite3 (WAL mode)"
        fi
    elif [ "$UPGRADE_MODE" = true ]; then
        if [ -f "$INSTALL_DIR/grc-backend/configs/db.env" ]; then
            log_info "Upgrade mode: Preserving existing PostgreSQL configuration."
        else
            DB_ENGINE="sqlite"
            log_info "Upgrade mode: Preserving existing SQLite database."
        fi
    fi

    echo ""
    echo -e "${BOLD}${BLUE}--- [Step 4/5] Administrator Account ---${RESET}"
    if [ "$CUSTOM_PASSWORD_PROVIDED" = false ] && [ "$UPGRADE_MODE" = false ]; then
        echo -e "Select initial Administrator credentials:"
        echo -e "  1) Auto-generate a secure 16-character password [Recommended]"
        echo -e "  2) Enter a custom administrator password now"
        read -rp "Select option [1-2] (default: 1): " PW_CHOICE
        if [ "$PW_CHOICE" = "2" ]; then
            while true; do
                read -rsp "Enter Admin password (minimum 8 characters): " P1
                echo ""
                read -rsp "Confirm Admin password: " P2
                echo ""
                if [ "$P1" = "$P2" ] && [ ${#P1} -ge 8 ]; then
                    ADMIN_PASSWORD="$P1"
                    CUSTOM_PASSWORD_PROVIDED=true
                    break
                else
                    echo -e "${RED}Passwords did not match or were shorter than 8 characters. Please try again.${RESET}"
                fi
            done
        else
            log_info "Random cryptographically secure password will be generated."
        fi
    elif [ "$UPGRADE_MODE" = true ]; then
        log_info "Upgrade mode: Existing administrator accounts and passwords will be preserved."
    fi

    if [ -z "$ADMIN_EMAIL" ]; then
        ADMIN_EMAIL="admin@${APP_DOMAIN}"
    fi

    echo ""
    echo -e "${BOLD}${BLUE}--- [Step 5/5] Host Firewall (UFW) ---${RESET}"
    read -rp "Configure host firewall (UFW) to allow SSH(22), HTTP(80), and HTTPS(443)? [Y/n] (default: Y): " UFW_INPUT
    if [[ "$UFW_INPUT" =~ ^[Nn] ]]; then
        ENABLE_UFW=false
        log_info "Skipping UFW firewall setup."
    else
        ENABLE_UFW=true
        log_info "UFW will be configured."
    fi

    # Review Configuration Summary
    echo ""
    echo -e "${MAGENTA}${BOLD}======================================================${RESET}"
    echo -e "${MAGENTA}${BOLD}             Installation Plan Summary                ${RESET}"
    echo -e "${MAGENTA}${BOLD}======================================================${RESET}"
    echo -e "  Appliance Host:     ${GREEN}${APP_DOMAIN}${RESET}"
    if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
        echo -e "  Alternate LAN IP:   ${CYAN}${PRIMARY_IP}${RESET}"
    fi
    echo -e "  HTTPS / SSL:        $([ "$ENABLE_SSL" = true ] && echo -e "${GREEN}Enabled (Port 443)${RESET}" || echo -e "${YELLOW}Disabled (Port 80 HTTP)${RESET}")"
    echo -e "  Database Engine:    $([ "$DB_ENGINE" = "postgres" ] || [ "$DB_ENGINE" = "postgresql" ] && echo -e "${GREEN}PostgreSQL (${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB})${RESET}" || echo -e "${CYAN}Embedded SQLite3 (WAL mode)${RESET}")"
    echo -e "  Admin Account:      admin (${ADMIN_EMAIL})"
    echo -e "  Admin Password:     $([ "$CUSTOM_PASSWORD_PROVIDED" = true ] && echo -e "${GREEN}Custom specified${RESET}" || echo -e "${CYAN}Auto-generated (saved to file)${RESET}")"
    echo -e "  UFW Firewall:       $([ "$ENABLE_UFW" = true ] && echo -e "${GREEN}Enabled (22, 80, 443)${RESET}" || echo -e "${YELLOW}Skipped${RESET}")"
    echo -e "  Target Directory:   ${INSTALL_DIR}"
    echo -e "${MAGENTA}${BOLD}======================================================${RESET}"
    read -rp "Proceed with installation? [Y/n] (default: Y): " CONFIRM
    if [[ "$CONFIRM" =~ ^[Nn] ]]; then
        echo -e "${YELLOW}Installation aborted by user.${RESET}"
        exit 0
    fi
else
    # Non-interactive fallback defaults
    APP_DOMAIN=${APP_DOMAIN:-${PRIMARY_IP:-edge-grc.local}}
    ADMIN_EMAIL=${ADMIN_EMAIL:-admin@${APP_DOMAIN}}
    if [ "$DB_ENGINE" = "postgres" ] && [ -z "$POSTGRES_PASSWORD" ]; then
        POSTGRES_PASSWORD=$(openssl rand -base64 16)
    fi
fi

# ==============================================================================
# Phase 1: System Dependencies & Base Setup
# ==============================================================================
log_step "1/6" "Installing operating system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
PKGS="python3-pip python3-venv python3-dev nginx curl unzip zip openssl libmagic1 ufw fail2ban unattended-upgrades logrotate"
if [ "$DB_ENGINE" = "postgres" ] || [ "$DB_ENGINE" = "postgresql" ]; then
    PKGS="$PKGS postgresql postgresql-contrib libpq-dev"
fi
apt-get install -y -qq $PKGS >/dev/null
log_success "Base Linux packages installed."
log_success "Base Linux packages installed."

# Configure Swap if enabled and system swap < 1GB
if [ "$ENABLE_SWAP" = true ]; then
    SWAP_TOTAL=$(free -m | awk '/^Swap:/ {print $2}')
    if [ -z "$SWAP_TOTAL" ] || [ "$SWAP_TOTAL" -lt 1000 ]; then
        log_info "Configuring 2GB swap file to prevent OOM errors during Next.js builds..."
        if [ ! -f /swapfile ]; then
            fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
            chmod 600 /swapfile
            mkswap /swapfile >/dev/null 2>&1
            swapon /swapfile
            if ! grep -q '/swapfile' /etc/fstab; then
                echo '/swapfile none swap sw 0 0' >> /etc/fstab
            fi
            log_success "2GB swap file active and persisted in /etc/fstab."
        fi
    fi
fi

# Install Node.js 22.x LTS if not present or outdated
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
    log_info "Installing Node.js 22.x LTS..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null
    log_success "Node.js $(node -v) installed."
fi

# ==============================================================================
# Phase 2: Build / Compile Next.js Frontend
# ==============================================================================
log_step "2/6" "Preparing Next.js frontend distribution..."
cd "$REPO_DIR/grc-frontend"
if [ ! -d ".next/standalone" ]; then
    log_info "Compiling Next.js standalone production build (this may take a couple minutes)..."
    npm ci --silent
    echo "NEXT_PUBLIC_API_URL=/api" > .env.production
    NODE_OPTIONS="--max-old-space-size=1536" npm run build
    log_success "Next.js standalone build compiled successfully."
else
    log_success "Pre-compiled Next.js standalone distribution found. Re-using build."
fi
cd "$REPO_DIR"

# ==============================================================================
# Phase 3: Stage Application to /opt/grc-appliance
# ==============================================================================
log_step "3/6" "Staging application files to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"

# Stage Backend
mkdir -p "$INSTALL_DIR/grc-backend"
if [ "$UPGRADE_MODE" = true ]; then
    # In upgrade mode, preserve database, media, and SSL configs
    rsync -a --exclude 'db.sqlite3*' --exclude 'media' --exclude 'configs/ssl' --exclude 'configs/django_secret.txt' --exclude 'configs/appliance_domain.txt' grc-backend/ "$INSTALL_DIR/grc-backend/" 2>/dev/null || cp -r grc-backend/. "$INSTALL_DIR/grc-backend/"
else
    cp -r grc-backend/. "$INSTALL_DIR/grc-backend/"
fi

# Stage Frontend Standalone Distribution
mkdir -p "$INSTALL_DIR/grc-frontend"
cp -r grc-frontend/.next/standalone/. "$INSTALL_DIR/grc-frontend/"
mkdir -p "$INSTALL_DIR/grc-frontend/public"
cp -r grc-frontend/public/. "$INSTALL_DIR/grc-frontend/public/"
mkdir -p "$INSTALL_DIR/grc-frontend/.next/static"
cp -r grc-frontend/.next/static/. "$INSTALL_DIR/grc-frontend/.next/static/"

# Flatten nested monorepo structure if Next.js bundled it
if [ -d "$INSTALL_DIR/grc-frontend/grc-frontend" ]; then
    cp -r "$INSTALL_DIR/grc-frontend/grc-frontend/." "$INSTALL_DIR/grc-frontend/"
    rm -rf "$INSTALL_DIR/grc-frontend/grc-frontend"
fi

# Critical Appliance Security: Never leave vendor private update key on customer appliance
rm -f "$INSTALL_DIR/grc-backend/configs/vendor_private.pem"

# Configuration Directories
SSL_DIR="$INSTALL_DIR/grc-backend/configs/ssl"
mkdir -p "$SSL_DIR"
mkdir -p "$INSTALL_DIR/grc-backend/logs"
mkdir -p "$INSTALL_DIR/grc-backend/media"

# Record appliance domains for CORS/CSRF binding
echo "${APP_DOMAIN}" > "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"
if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
    echo "${PRIMARY_IP}" >> "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"
fi
echo "127.0.0.1" >> "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"
echo "localhost" >> "$INSTALL_DIR/grc-backend/configs/appliance_domain.txt"

# Verify update public key exists for cryptographic signature validation
if [ ! -f "$INSTALL_DIR/grc-backend/configs/update_pub.pem" ]; then
    log_error "Critical file missing: configs/update_pub.pem. Updates cannot be verified."
    exit 1
fi

log_success "Application files staged cleanly."

# ==============================================================================
# Phase 4: Configure Python Backend & Database
# ==============================================================================
log_step "4/6" "Configuring Python virtual environment & database..."
cd "$INSTALL_DIR/grc-backend"

# Admin Password Generation
if [ "$UPGRADE_MODE" = false ]; then
    if [ "$CUSTOM_PASSWORD_PROVIDED" = true ]; then
        INITIAL_PW="$ADMIN_PASSWORD"
    else
        INITIAL_PW=$(openssl rand -base64 12)
    fi
    echo "$INITIAL_PW" > "$INSTALL_DIR/INITIAL_ADMIN_PASSWORD"
    chmod 600 "$INSTALL_DIR/INITIAL_ADMIN_PASSWORD"
fi

# Python Virtual Environment
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
pip install -q gunicorn

# Configure Pluggable Database (PostgreSQL / SQLite)
if [ "$DB_ENGINE" = "postgres" ] || [ "$DB_ENGINE" = "postgresql" ]; then
    # Strictly validate PostgreSQL identifiers to prevent SQL/command injection
    if [[ ! "$POSTGRES_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        log_error "Invalid POSTGRES_USER identifier '${POSTGRES_USER}'. Only alphanumeric characters and underscores are permitted."
        exit 1
    fi
    if [[ ! "$POSTGRES_DB" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        log_error "Invalid POSTGRES_DB identifier '${POSTGRES_DB}'. Only alphanumeric characters and underscores are permitted."
        exit 1
    fi

    if [ "$POSTGRES_LOCAL" = true ]; then
        log_info "Configuring local PostgreSQL service..."
        systemctl enable --now postgresql >/dev/null 2>&1 || true
        SAFE_PG_PASS="${POSTGRES_PASSWORD//\'/\'\'}"
        if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" 2>/dev/null | grep -q 1; then
            sudo -u postgres psql -c "ALTER USER \"${POSTGRES_USER}\" WITH PASSWORD '${SAFE_PG_PASS}';" >/dev/null 2>&1
        else
            sudo -u postgres psql -c "CREATE USER \"${POSTGRES_USER}\" WITH PASSWORD '${SAFE_PG_PASS}';" >/dev/null 2>&1
        fi
        if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" 2>/dev/null | grep -q 1; then
            sudo -u postgres psql -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";" >/dev/null 2>&1
        fi
        sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \"${POSTGRES_DB}\" TO \"${POSTGRES_USER}\";" >/dev/null 2>&1
        sudo -u postgres psql -d "${POSTGRES_DB}" -c "GRANT ALL ON SCHEMA public TO \"${POSTGRES_USER}\";" >/dev/null 2>&1 || true
        log_success "Local PostgreSQL service active and database '${POSTGRES_DB}' provisioned."
    fi

    DB_ENV_FILE="$INSTALL_DIR/grc-backend/configs/db.env"
    cat <<DBEOF > "$DB_ENV_FILE"
# Edge-GRC Pluggable Database Configuration
DB_ENGINE=postgres
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
DBEOF
    chmod 600 "$DB_ENV_FILE"
    chown www-data:www-data "$DB_ENV_FILE"
    log_success "Database environment credentials saved to ${DB_ENV_FILE}."
fi

# Run Migrations & Collect Static Assets
python manage.py migrate --noinput
python manage.py collectstatic --noinput >/dev/null

# Setup Initial Administrator Account
MUST_CHANGE_PW=$([ "$CUSTOM_PASSWORD_PROVIDED" = true ] && echo "False" || echo "True")
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
    user = User.objects.create_superuser('admin', '${ADMIN_EMAIL}', initial_pw)
    if hasattr(user, 'profile'):
        user.profile.role = 'Admin'
        user.profile.must_change_password = ${MUST_CHANGE_PW}
        user.profile.save()
    print("CREATE_OK")
else:
    print("EXISTING_OK")
PYEOF

ADMIN_RES=$(python setup_admin.py)
rm -f setup_admin.py

if [ "$ADMIN_RES" = "CREATE_OK" ]; then
    log_success "Initialized superuser 'admin' account."
else
    log_info "Preserved existing administrator account."
fi

# Permissions hardening: www-data owns app files, database, and media
chown -R www-data:www-data "$INSTALL_DIR"
chmod 750 "$INSTALL_DIR"
log_success "Django backend and SQLite database configured."

# ==============================================================================
# Phase 5: Install System Services & Security Rules
# ==============================================================================
log_step "5/6" "Registering systemd background services & security rules..."
cp "$REPO_DIR/configs/grc-backend.service" /etc/systemd/system/
cp "$REPO_DIR/configs/grc-frontend.service" /etc/systemd/system/
cp "$REPO_DIR/configs/grc-worker.service" /etc/systemd/system/

# Create SSL Watcher to reload Nginx automatically when certs are renewed or uploaded via UI
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
systemctl enable --now grc-backend >/dev/null 2>&1
systemctl enable --now grc-frontend >/dev/null 2>&1
systemctl enable --now grc-worker >/dev/null 2>&1
systemctl enable --now grc-ssl-watcher.path >/dev/null 2>&1
log_success "Systemd services active: grc-backend, grc-frontend, grc-worker, grc-ssl-watcher."

# Strict Least-Privilege Sudoers Rule for Appliance Auto-Updates
cat <<EOF > /etc/sudoers.d/grc-updater
www-data ALL=(root) NOPASSWD: /bin/systemctl restart grc-backend grc-frontend grc-worker, /bin/systemctl restart grc-backend, /bin/systemctl restart grc-frontend, /bin/systemctl restart grc-worker, /usr/bin/systemctl restart grc-backend grc-frontend grc-worker, /usr/bin/systemctl restart grc-backend, /usr/bin/systemctl restart grc-frontend, /usr/bin/systemctl restart grc-worker
EOF
chmod 0440 /etc/sudoers.d/grc-updater
log_success "Least-privilege updater permissions configured."

# System Log Rotation & Retention Limits
mkdir -p /etc/systemd/journald.conf.d
cat <<JEOF > /etc/systemd/journald.conf.d/grc-appliance.conf
[Journal]
SystemMaxUse=500M
SystemMaxFileSize=50M
MaxRetentionSec=1month
JEOF
systemctl restart systemd-journald

if [ -f "$REPO_DIR/configs/logrotate-grc" ]; then
    cp "$REPO_DIR/configs/logrotate-grc" /etc/logrotate.d/grc-appliance
    chmod 0644 /etc/logrotate.d/grc-appliance
fi

# Host Firewall (UFW) Configuration
if [ "$ENABLE_UFW" = true ]; then
    ufw default deny incoming >/dev/null 2>&1 || true
    ufw default allow outgoing >/dev/null 2>&1 || true
    ufw allow 22/tcp comment 'SSH Remote Management' >/dev/null 2>&1 || true
    ufw allow 80/tcp comment 'GRC Appliance HTTP' >/dev/null 2>&1 || true
    ufw allow 443/tcp comment 'GRC Appliance HTTPS' >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true
    log_success "UFW firewall active: ports 22 (SSH), 80 (HTTP), 443 (HTTPS) allowed."
fi

# Fail2ban Login Protection
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

systemctl restart fail2ban >/dev/null 2>&1 || true
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true
log_success "Fail2ban brute-force protection and automated security updates active."

# ==============================================================================
# Phase 6: Configure Nginx & SSL
# ==============================================================================
log_step "6/6" "Configuring Nginx reverse proxy & SSL..."
rm -f /etc/nginx/sites-enabled/default

NGINX_CONF="$INSTALL_DIR/grc-backend/configs/nginx.conf"

# Generate Self-Signed SSL Certificate if HTTPS is selected
if [ "$ENABLE_SSL" = true ]; then
    CERT_FILE="$SSL_DIR/appliance_cert.pem"
    KEY_FILE="$SSL_DIR/appliance_key.pem"

    if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
        log_info "Generating 10-year self-signed X.509 certificate with Subject Alternative Names..."
        OPENSSL_SAN_CNF="$SSL_DIR/openssl-san.cnf"
        cat <<EOF > "$OPENSSL_SAN_CNF"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = US
ST = State
L = City
O = Edge-GRC Appliance
CN = ${APP_DOMAIN}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${APP_DOMAIN}
DNS.2 = edge-grc.local
IP.1 = 127.0.0.1
EOF
        if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
            echo "IP.2 = ${PRIMARY_IP}" >> "$OPENSSL_SAN_CNF"
        fi

        openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
            -keyout "$KEY_FILE" \
            -out "$CERT_FILE" \
            -config "$OPENSSL_SAN_CNF" >/dev/null 2>&1
        rm -f "$OPENSSL_SAN_CNF"
        chmod 600 "$KEY_FILE"
        chmod 644 "$CERT_FILE"
        log_success "Generated self-signed certificate in ${SSL_DIR}."
    else
        log_info "Preserved existing SSL certificate in ${SSL_DIR}."
    fi

    # Write HTTPS Nginx Configuration with automatic HTTP->HTTPS redirection
    cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    server_name _;
    server_tokens off;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    server_tokens off;

    # Baseline Security Headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    client_max_body_size 25M;

    ssl_certificate /opt/grc-appliance/grc-backend/configs/ssl/appliance_cert.pem;
    ssl_certificate_key /opt/grc-appliance/grc-backend/configs/ssl/appliance_key.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Large payloads for signed appliance updates and database restores
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

else
    # Write HTTP-only Nginx Configuration
    cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    server_name _;

    server_tokens off;

    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    client_max_body_size 25M;

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
fi

chown www-data:www-data "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/grc-appliance
nginx -t >/dev/null 2>&1
systemctl restart nginx
log_success "Nginx reverse proxy active and linked."

# ==============================================================================
# Post-Flight Service Verification & Health Check
# ==============================================================================
echo ""
echo -e "${BOLD}${BLUE}Verifying appliance runtime health...${RESET}"
sleep 2

CHECK_BACKEND=$(systemctl is-active grc-backend 2>/dev/null || echo "failed")
CHECK_FRONTEND=$(systemctl is-active grc-frontend 2>/dev/null || echo "failed")
CHECK_WORKER=$(systemctl is-active grc-worker 2>/dev/null || echo "failed")
CHECK_NGINX=$(systemctl is-active nginx 2>/dev/null || echo "failed")

ALL_SERVICES_OK=true
if [ "$CHECK_BACKEND" = "active" ]; then
    log_success "grc-backend is active (Django REST API)"
else
    log_error "grc-backend service status: ${CHECK_BACKEND}"
    ALL_SERVICES_OK=false
fi

if [ "$CHECK_FRONTEND" = "active" ]; then
    log_success "grc-frontend is active (Next.js Standalone)"
else
    log_error "grc-frontend service status: ${CHECK_FRONTEND}"
    ALL_SERVICES_OK=false
fi

if [ "$CHECK_WORKER" = "active" ]; then
    log_success "grc-worker is active (Audit Scheduler)"
else
    log_error "grc-worker service status: ${CHECK_WORKER}"
    ALL_SERVICES_OK=false
fi

if [ "$CHECK_NGINX" = "active" ]; then
    log_success "nginx is active (Reverse Proxy)"
else
    log_error "nginx service status: ${CHECK_NGINX}"
    ALL_SERVICES_OK=false
fi

if [ "$DB_ENGINE" = "postgres" ] || [ "$DB_ENGINE" = "postgresql" ]; then
    if [ "$POSTGRES_LOCAL" = true ]; then
        CHECK_PG=$(systemctl is-active postgresql 2>/dev/null || echo "failed")
        if [ "$CHECK_PG" = "active" ]; then
            log_success "postgresql is active (Database Service)"
        else
            log_error "postgresql service status: ${CHECK_PG}"
            ALL_SERVICES_OK=false
        fi
    fi
fi

# Determine Access Protocol
PROTO="http"
[ "$ENABLE_SSL" = true ] && PROTO="https"

INITIAL_ADMIN_PW=$(cat "$INSTALL_DIR/INITIAL_ADMIN_PASSWORD" 2>/dev/null || echo "Custom / Existing")

# ==============================================================================
# Final Installation Summary Card
# ==============================================================================
echo ""
echo -e "${GREEN}${BOLD}==============================================================================${RESET}"
echo -e "${GREEN}${BOLD}                 🎉 Edge-GRC Appliance Installed Successfully!               ${RESET}"
echo -e "${GREEN}${BOLD}==============================================================================${RESET}"
echo -e "  ${BOLD}Primary Access URL:${RESET}      ${CYAN}${PROTO}://${APP_DOMAIN}${RESET}"
if [ -n "$PRIMARY_IP" ] && [ "$PRIMARY_IP" != "$APP_DOMAIN" ]; then
    echo -e "  ${BOLD}Direct LAN URL:${RESET}          ${CYAN}${PROTO}://${PRIMARY_IP}${RESET}"
fi
echo -e "  ${BOLD}Default Login:${RESET}           Username: ${BOLD}admin${RESET}"
if [ "$CUSTOM_PASSWORD_PROVIDED" = true ]; then
    echo -e "                           Password: ${GREEN}[Custom Password Configured]${RESET}"
elif [ "$UPGRADE_MODE" = true ]; then
    echo -e "                           Password: ${CYAN}[Existing Password Preserved]${RESET}"
else
    echo -e "                           Password: ${YELLOW}${INITIAL_ADMIN_PW}${RESET}"
    echo -e "                           ${DIM}(Mandatory password reset prompted on first login)${RESET}"
    echo -e "                           ${DIM}(Password saved securely in: ${INSTALL_DIR}/INITIAL_ADMIN_PASSWORD)${RESET}"
fi

echo -e "\n  ${BOLD}Appliance Status:${RESET}        $([ "$ALL_SERVICES_OK" = true ] && echo -e "${GREEN}All Core Services Healthy [✔]${RESET}" || echo -e "${YELLOW}Review Service Status Above [⚠]${RESET}")"
echo -e "  ${BOLD}Database Engine:${RESET}         $([ "$DB_ENGINE" = "postgres" ] || [ "$DB_ENGINE" = "postgresql" ] && echo -e "${GREEN}PostgreSQL (${POSTGRES_DB})${RESET}" || echo -e "${CYAN}Embedded SQLite3 (WAL mode)${RESET}")"
echo -e "  ${BOLD}SSL Certificate:${RESET}         $([ "$ENABLE_SSL" = true ] && echo -e "Self-Signed TLS (manageable in Admin Console)" || echo -e "Disabled (HTTP)")"

echo -e "\n  ${BOLD}Useful Administrative Commands:${RESET}"
echo -e "    Check Status:          ${CYAN}sudo systemctl status grc-backend grc-frontend${RESET}"
echo -e "    View Realtime Logs:    ${CYAN}sudo journalctl -u grc-backend -f${RESET}"
echo -e "    Nginx Error Logs:      ${CYAN}sudo tail -f /var/log/nginx/error.log${RESET}"
echo -e "    Restart Appliance:     ${CYAN}sudo systemctl restart grc-backend grc-frontend grc-worker nginx${RESET}"
echo -e "${GREEN}${BOLD}==============================================================================${RESET}\n"