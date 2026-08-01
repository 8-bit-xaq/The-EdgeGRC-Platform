from django.apps import AppConfig
from django.db.models.signals import post_migrate

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