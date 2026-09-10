with open("install.sh", "r") as f:
    content = f.read()

# 1. Copy grc-worker.service
if "configs/grc-worker.service" not in content:
    content = content.replace(
        "cp $REPO_DIR/configs/grc-frontend.service /etc/systemd/system/",
        "cp $REPO_DIR/configs/grc-frontend.service /etc/systemd/system/\ncp $REPO_DIR/configs/grc-worker.service /etc/systemd/system/"
    )

# 2. Enable and start grc-worker
if "systemctl enable --now grc-worker" not in content:
    content = content.replace(
        "systemctl enable --now grc-frontend",
        "systemctl enable --now grc-frontend\nsystemctl enable --now grc-worker"
    )

# 3. Add to sudoers
if "restart grc-worker" not in content:
    content = content.replace(
        "/bin/systemctl restart grc-frontend",
        "/bin/systemctl restart grc-frontend, /bin/systemctl restart grc-worker"
    )

with open("install.sh", "w") as f:
    f.write(content)
