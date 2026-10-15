from django.db import migrations, models


ROLES = [(20, "Admin"), (15, "Member"), (5, "Guest"), (3, "Client")]


class Migration(migrations.Migration):
    dependencies = [("db", "0133_revoke_stale_instance_admin_access")]
    operations = [
        migrations.AlterField(
            model_name=name, name="role", field=models.PositiveSmallIntegerField(choices=ROLES, default=5)
        )
        for name in ("workspacemember", "workspacememberinvite", "projectmember", "projectmemberinvite")
    ] + [
        migrations.AlterField(
            model_name=name,
            name="instance_admin_previous_role",
            field=models.PositiveSmallIntegerField(choices=ROLES, null=True, blank=True),
        )
        for name in ("workspacemember", "projectmember")
    ]
