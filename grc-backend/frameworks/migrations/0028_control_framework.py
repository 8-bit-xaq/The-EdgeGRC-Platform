from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('frameworks', '0027_organizationsettings_session_timeout_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='control',
            name='framework',
            field=models.CharField(db_index=True, default='General', max_length=100),
        ),
    ]

