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
| `-y, --yes, --non-interactive` | Run non-interactively using defaults/flags | Interactive |
| `-h, --help` | Display help documentation | - |

**Initial Login Credentials:**
* **Username:** `admin`
* **Password:** Generated at install and saved to `/opt/grc-appliance/INITIAL_ADMIN_PASSWORD` (or your custom password).
* *Note: A mandatory password change is enforced on first login.*

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
