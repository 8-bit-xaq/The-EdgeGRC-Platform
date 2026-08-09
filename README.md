# Edge-GRC-Platform
Markdown
# Compliance Solutions GRC Platform

A comprehensive, self-hosted Governance, Risk, and Compliance (GRC) appliance. This platform centralizes control matrix management, automated audit scheduling, enterprise risk tracking, and compliance reporting into a single, unified dashboard.

## 🌟 Features

* **Control Matrix Management:** Track and maintain compliance controls with detailed narratives, physical evidence uploads, and cross-walked framework mapping.
* **Automated Audit Scheduling:** Configure recurring audit cycles (Monthly, Quarterly, Annual) with automated notifications for evidence gathering and QA review.
* **Enterprise Risk Register:** Calculate inherent and residual risk scores with automated risk mitigation tracking tied directly to your active controls.
* **Plan of Action & Milestones (POA&M):** Assign, track, and resolve remediation tasks for failing or deficient controls.
* **Role-Based Access Control (RBAC):** Strict operational segregation utilizing five core roles: Admin, Auditor, Contributor, Reviewer, and Executive.
* **Forensic Audit Logging:** Immutable tracking of all status changes, evidence modifications, and system events.
* **Automated PDF Reporting:** Generate comprehensive, cryptographically-secure executive audit reports complete with charts and compliance scoring.

## 🏗️ Architecture & Tech Stack

This appliance is built using a modern, decoupled architecture designed for Linux environments.

* **Frontend:** Next.js, React, Tailwind CSS
* **Backend:** Django, Django REST Framework (DRF), Python
* **Database:** SQLite (Appliance-optimized)
* **Web Server / Proxy:** Gunicorn, Nginx, Systemd

## 🚀 Editions

* **Community Edition (CE):** The core open-source appliance featuring the complete control matrix, manual workflow states, and standard reporting.
* **Enterprise Edition (EE):** A commercially licensed tier featuring advanced automation, deep active directory integrations, priority SLA support, and automated framework updates. *(Contact sales for license activation).*

---

## 🛠️ Installation & Appliance Setup

These instructions assume you are deploying the platform on a standard Ubuntu/Debian Linux environment using `systemd`.

### 1. Repository Setup & Permissions
To ensure smooth collaboration between your development user and the background web server (`www-data`), clone the repository and establish a hybrid SGID permission model:

```bash
git clone [https://github.com/your-org/compliance-solutions.git](https://github.com/your-org/compliance-solutions.git) /opt/grc-appliance
cd /opt/grc-appliance

# Assign hybrid ownership (User = Owner, Nginx = Group)
sudo chown -R $USER:www-data /opt/grc-appliance/
sudo chmod -R 775 /opt/grc-appliance/

# Force directory inheritance for newly created cache/database files
sudo find /opt/grc-appliance/ -type d -exec chmod g+s {} +
2. Backend Environment (Django)
Set up the Python virtual environment and initialize the database.

Bash
cd /opt/grc-appliance/grc-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Run migrations and create the factory default Admin account
python manage.py migrate
3. Frontend Environment (Next.js)
Install the Node dependencies and compile the production build.

Bash
cd /opt/grc-appliance/grc-frontend
npm install
npm run build
4. Service Initialization
Ensure your Nginx configuration and systemd service files (located in the /configs/ directory) are linked to their respective system directories.

Restart the daemons to spin up the appliance:

Bash
sudo systemctl daemon-reload
sudo systemctl enable grc-backends grc-frontend
sudo systemctl restart grc-backends grc-frontend nginx
📁 Directory Structure
Plaintext
/opt/grc-appliance/
├── configs/                  # Nginx and Systemd service configurations
├── grc-backend/              # Django REST API
│   ├── frameworks/           # Core compliance logic, models, and views
│   ├── grc_api/              # Main Django routing and settings
│   ├── services/             # Background services (e.g., PDF Generator)
│   └── db.sqlite3            # Application database
└── grc-frontend/             # Next.js React Application
    ├── app/                  # Next.js App Router and global layouts
    ├── components/           # UI components (Tables, Dialogs, Dashboards)
    └── lib/                  # API wrappers and strict type definitions
🔐 Security Notes
Evidence Storage: Physical evidence proofs are stored in /grc-backend/media/evidence_proofs/. Ensure this directory is strictly protected and backed up regularly.

API Authentication: The platform utilizes Token-based authentication. API keys are transmitted via the Authorization: Token <key> header.

Database Locking: If you experience 500 Internal Server Error or OperationalError: attempt to write a readonly database issues during development, ensure your IDE has not locked the SQLite file and that the www-data group retains 775 write access to the /grc-backend/ directory.

🤝 Contributing
Contributions to the Community Edition are welcome! Please review our CONTRIBUTING.md guidelines before submitting pull requests. Ensure all backend code passes Django testing and frontend components adhere to the existing Tailwind UI structures.

📄 License
This project is dual-licensed. The Community Edition is licensed under the MIT License. The Enterprise Edition is proprietary software subject to a commercial End User License Agreement (EULA).