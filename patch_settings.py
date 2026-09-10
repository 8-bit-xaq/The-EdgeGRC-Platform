with open("grc-backend/grc_api/settings.py", "r") as f:
    content = f.read()

# Add django_q
if "'django_q'," not in content:
    content = content.replace("'frameworks',", "'frameworks',\n    'django_q',")

# Add Q_CLUSTER config
if "Q_CLUSTER" not in content:
    q_config = """
Q_CLUSTER = {
    'name': 'grc_tasks',
    'workers': 4,
    'recycle': 500,
    'timeout': 3600,  # 1 hour max
    'compress': True,
    'save_limit': 250,
    'queue_limit': 500,
    'cpu_affinity': 1,
    'label': 'Django Q',
    'orm': 'default'
}
"""
    content += q_config

with open("grc-backend/grc_api/settings.py", "w") as f:
    f.write(content)
