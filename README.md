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

## 🚀 Quick Start (End-User Installation)

Edge-GRC is designed to be installed on a fresh **Ubuntu Linux (x86)** machine with a single command. 

1. Clone or extract the release archive to your target machine.
2. Run the automated installer with root privileges:
   ```bash
   sudo ./install.sh
   ```
3. The script will automatically install dependencies, compile the frontend, configure Nginx, generate initial security keys, and spin up the background workers.
4. **Access the Appliance:** Navigate to `http://<your-ip-or-domain>`
5. **Default Login:** 
   * **Username:** `admin`
   * **Password:** `ChangeMe123!`

*(Make sure to change the default password and configure HTTPS via the Workspace Settings immediately after your first login!)*

---

## 🛠️ Vendor & Developer Guide

If you are maintaining the codebase or packaging updates for end-users, use the provided toolchain to ensure updates are cryptographically signed.

### Generating Vendor Keys
Before packaging your first update, you must generate a private/public keypair. The public key is bundled with the appliance, and the private key stays with you (the vendor).
```bash
cd grc-backend/
python generate_update_keys.py
```
*This generates `configs/update_pub.pem` and `configs/vendor_private.pem`. **Never distribute the private key!***

### Building an Update
To package a new release for your on-prem clients, use the interactive build script:
```bash
./build-update.sh
```
1. The script will prompt you for the new Semantic Version (e.g., `1.1.0`).
2. It will package the necessary application files into an intermediate `payload.zip`.
3. It will automatically use your `vendor_private.pem` to generate an RSA signature (`signature.sig`).
4. It will bundle both into `update-EdgeGRC.zip`.

End-users can upload this final zip directly into their appliance UI. The appliance will mathematically verify the signature against its local public key before applying the patch.

---

## 🔒 Security Posture

Edge-GRC enforces strict least-privilege principles:
*   The web applications run entirely under the `www-data` user.
*   System updates and restarts are managed via strictly scoped `/etc/sudoers.d/grc-updater` rules that only permit restarting specific systemd services, preventing full root shell escalation.
*   Protection against Path Traversal and Zip-Slip vulnerabilities during backup restoration and system updates.
