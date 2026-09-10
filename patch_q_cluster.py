with open("grc-backend/grc_api/settings.py", "r") as f:
    content = f.read()

content = content.replace("'timeout': 3600,  # 1 hour max", "'timeout': 3600,  # 1 hour max\n    'retry': 3700,")

with open("grc-backend/grc_api/settings.py", "w") as f:
    f.write(content)
