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

def create_factory_default_admin(sender, **kwargs):
    from django.contrib.auth.models import User
    
    if not User.objects.exists():
        user = User.objects.create_superuser(
            username='admin',
            email='admin@localhost',
            password='ChangeMe123!'
        )
        
        # The post_save signal in models.py automatically creates the UserProfile.
        # We just need to escalate its role to Admin.
        profile = user.profile
        profile.role = 'Admin'
        profile.save()
        print("\n*** FACTORY DEFAULT APPLIANCE ACCOUNT CREATED ***")
        print("Username: admin")
        print("Password: ChangeMe123!\n")

class FrameworksConfig(AppConfig):
    name = 'frameworks'

    def ready(self):
        post_migrate.connect(create_factory_default_admin, sender=self)
        connection_created.connect(configure_sqlite_wal)