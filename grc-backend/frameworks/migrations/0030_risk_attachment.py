import frameworks.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('frameworks', '0029_userprofile_must_change_password'),
    ]

    operations = [
        migrations.AddField(
            model_name='risk',
            name='attachment',
            field=models.FileField(
                blank=True,
                null=True,
                upload_to='risk_attachments/',
                validators=[frameworks.models.validate_secure_upload],
            ),
        ),
    ]
