from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("license", "0008_mcpsettings"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcpsettings",
            name="allow_all_workspaces",
            field=models.BooleanField(default=True),
        ),
    ]
