from django.db import migrations, models


def mark_existing_inactive_users_as_banned(apps, schema_editor):
    User = apps.get_model("db", "User")
    User.objects.filter(is_active=False, is_bot=False).update(is_banned=True)


def clear_migrated_ban_flags(apps, schema_editor):
    User = apps.get_model("db", "User")
    User.objects.filter(is_banned=True).update(is_banned=False)


class Migration(migrations.Migration):

    dependencies = [
        ("db", "0126_instance_admin_access"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_banned",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="user",
            name="banned_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="user",
            name="banned_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.RunPython(
            mark_existing_inactive_users_as_banned,
            clear_migrated_ban_flags,
        ),
    ]
