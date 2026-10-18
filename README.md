# 🛡️ Edge-GRC Appliance

Edge-GRC is a high-performance, strictly on-premise Governance, Risk, and Compliance (GRC) platform. Designed for organizations that require complete data sovereignty, Edge-GRC allows you to securely manage compliance frameworks, track evidence, monitor risks, and perform audit assessments entirely behind your own firewall.

---

## ✨ Key Features

*   **100% On-Premise & Offline-Capable:** No telemetry, no forced cloud connections, and no external dependencies after installation. Complete data sovereignty.
*   **Role-Based Access Control (RBAC):** Granular permissions for Admins, Auditors, Reviewers, and Contributors to ensure strict separation of duties.
*   **Cryptographically Signed Updates:** Supply-chain security built-in. The appliance validates RSA-SHA256 signatures on all system updates before extracting or applying them.
*   **Automated Audit Reporting:** Generate and export highly detailed PDF and ZIP compliance reports completely in the background without locking up the UI.
*   **Built-in Backup & Restore:** Administrators can generate full system snapshots (database and media evidence) and restore them seamlessly via the UI.
*   **Self-Managed SSL:** Built-in tools for generating and deploying secure HTTPS certificates directly through the workspace settings.

---

## 🏗️ Architecture & Tech Stack

*   **Frontend:** Next.js (React), Tailwind CSS, React Hook Form + Zod (Strict validation)
*   **Backend:** Django 5.x, Django REST Framework (DRF)
*   **Database:** SQLite3 (Optimized with WAL mode and high-concurrency pragmas)
*   **Task Queue:** Django-Q2 (Handles heavy I/O operations like PDF generation and backups)
*   **Web Server:** Nginx (Serves as a unified reverse proxy and enforces strict file upload limits)
*   **Security:** HttpOnly expiring cookies, strict CSRF validation, and parameterized database queries.

---

## 🚀 Quick Start (Installation)

Edge-GRC is installed on a fresh **Ubuntu 20.04 / 22.04 / 24.04 LTS or Debian 11 / 12** machine.

### Interactive Installation (Recommended)
Run the guided installer with root privileges:
```bash
sudo ./install.sh
```
The installer will interactively prompt for:
1. **Network Address:** Auto-detects your LAN IP or lets you set a custom domain.
2. **Security & SSL:** Generates a 10-year self-signed TLS certificate for HTTPS out-of-the-box.
3. **Administrator Credentials:** Auto-generates a secure 16-character password or accepts a custom password.
4. **Firewall (UFW):** Automatically configures host ports (22 SSH, 80 HTTP, 443 HTTPS).

### Automated / Headless Installation (DevOps & CI/CD)
For automated deployments (cloud-init, Ansible, Terraform, Vagrant):
```bash
# Automated install with LAN IP and HTTPS:
sudo ./install.sh -y --domain 192.168.1.150 --ssl

# Full custom unattended deployment:
sudo ./install.sh -y -d grc.company.local -p "YourSecurePassword123!" --ssl --skip-ufw
```

### Installer Options
| Option | Description | Default |
|---|---|---|
| `-d, --domain <HOST>` | Domain or IP address for the appliance | Auto-detected LAN IP |
| `-p, --admin-password <PASS>` | Set initial admin password | Random 16-char string |
| `-e, --admin-email <EMAIL>` | Set initial admin email | `admin@<domain>` |
| `--ssl` | Enable out-of-the-box self-signed HTTPS | Enabled (interactive default) |
| `--skip-ssl` | Force HTTP-only mode on port 80 | Disabled |
| `--skip-ufw` | Skip host firewall configuration | Disabled (UFW configured) |
| `--skip-swap` | Skip 2GB swap file creation | Disabled (2GB swap enabled) |
| `--db <sqlite\|postgres>` | Database engine ('sqlite' or 'postgres') | `sqlite` |
| `--db-host <HOST>` | PostgreSQL host address | `127.0.0.1` |
| `--db-port <PORT>` | PostgreSQL port | `5432` |
| `--db-name <NAME>` | PostgreSQL database name | `edgegrc` |
| `--db-user <USER>` | PostgreSQL username | `edgegrc_user` |
| `--db-password <PASS>` | PostgreSQL user password | Auto-generated 16-char |
| `-y, --yes, --non-interactive` | Run non-interactively using defaults/flags | Interactive |
| `-h, --help` | Display help documentation | - |

**Initial Login Credentials:**
* **Username:** `admin`
* **Password:** Generated at install and saved to `/opt/grc-appliance/INITIAL_ADMIN_PASSWORD` (or your custom password).
* *Note: A mandatory password change is enforced on first login.*

---

## 🗄️ Pluggable Database Architecture (SQLite & PostgreSQL)

Edge-GRC provides a pluggable database layer supporting two production architectures:

1. **Embedded SQLite3 (Default):** Zero configuration, single-file embedded database tuned with Write-Ahead Logging (`WAL`), `busy_timeout=20000`, and automatic vacuuming. Recommended for standard on-premise appliances and isolated VMs.
2. **PostgreSQL (Enterprise):** High-concurrency client-server relational database with persistent connection pooling (`CONN_MAX_AGE=60`). Supports automated local provisioning on the appliance host or connecting to external managed databases (AWS RDS, Azure Database for PostgreSQL, Google Cloud SQL, or corporate clusters).

### Configuring PostgreSQL
Database credentials can be configured via environment variables or stored securely in `/opt/grc-appliance/grc-backend/configs/db.env` (`chmod 600`, owned by `www-data`):
```ini
DB_ENGINE=postgres
POSTGRES_DB=edgegrc
POSTGRES_USER=edgegrc_user
POSTGRES_PASSWORD=YourSecurePassword123!
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
```
Alternatively, provide a unified connection URL:
```ini
DATABASE_URL=postgresql://edgegrc_user:YourSecurePassword123!@127.0.0.1:5432/edgegrc
```

### Seamless Migration from SQLite to PostgreSQL
If you began on SQLite and wish to upgrade to PostgreSQL without data loss, run the built-in migration command:
```bash
cd /opt/grc-appliance/grc-backend
source venv/bin/activate
python manage.py migrate_to_postgres --host 127.0.0.1 --db edgegrc --user edgegrc_user --password "YourSecurePassword123!"
sudo systemctl restart grc-backend grc-worker
```
The command automatically tests connectivity, dumps all existing frameworks, controls, and evidence records, builds the PostgreSQL schema, imports data, resets sequence counters, and writes `configs/db.env`.


---

## 🔄 Appliance Updates & Supply-Chain Security

Edge-GRC supports cryptographically verified updates directly through the Admin Console.

* **Cryptographic Signature Verification:** The appliance mathematically validates RSA-SHA256 signatures on all update packages against the embedded public key (`configs/update_pub.pem`) before extracting or applying files.
* **Integrity Guarantee:** Any altered, corrupt, or unsigned update package is rejected before execution.
* **Non-Destructive Patching:** System updates preserve existing SQLite databases, uploaded evidence files (`media/`), SSL certificates, and appliance domain configurations.
* **Zero Downtime Database Migrations:** Database migrations and static asset collections run automatically during update application.

---

## 🔒 Security Posture

Edge-GRC enforces strict least-privilege principles:
*   The web applications run entirely under the `www-data` user.
*   System updates and restarts are managed via strictly scoped `/etc/sudoers.d/grc-updater` rules that only permit restarting specific systemd services, preventing full root shell escalation.
*   Protection against Path Traversal and Zip-Slip vulnerabilities during backup restoration and system updates.

---

## 📄 License

Edge-GRC is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0-or-later)**. See the [LICENSE](LICENSE) file for the full license terms.

*Commercial licensing, enterprise support agreements, and custom proprietary terms are available upon request.*

