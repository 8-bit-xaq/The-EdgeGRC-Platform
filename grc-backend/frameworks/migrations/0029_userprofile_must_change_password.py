from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('frameworks', '0028_control_framework'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='must_change_password',
            field=models.BooleanField(default=False),
        ),
    ]

