with open("grc-backend/frameworks/apps.py", "r") as f:
    content = f.read()

new_imports = """
from django.apps import AppConfig
from django.db.models.signals import post_migrate
from django.db.backends.signals import connection_created

def configure_sqlite_wal(sender, connection, **kwargs):
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute('PRAGMA journal_mode=WAL;')
        cursor.execute('PRAGMA synchronous=NORMAL;')
        cursor.execute('PRAGMA busy_timeout=20000;')
        cursor.close()
"""

content = content.replace("from django.apps import AppConfig\nfrom django.db.models.signals import post_migrate", new_imports.strip())

ready_method_old = """
    def ready(self):
        post_migrate.connect(create_factory_default_admin, sender=self)
"""

ready_method_new = """
    def ready(self):
        post_migrate.connect(create_factory_default_admin, sender=self)
        connection_created.connect(configure_sqlite_wal)
"""

content = content.replace(ready_method_old.strip(), ready_method_new.strip())

with open("grc-backend/frameworks/apps.py", "w") as f:
    f.write(content)
