with open("grc-backend/frameworks/views.py", "r") as f:
    content = f.read()

content = content.replace(
    "subprocess.run(['sudo', 'systemctl', 'restart', 'grc-backend', 'grc-frontend'], check=True)",
    "subprocess.run(['sudo', 'systemctl', 'restart', 'grc-backend', 'grc-frontend', 'grc-worker'], check=True)"
)

with open("grc-backend/frameworks/views.py", "w") as f:
    f.write(content)
