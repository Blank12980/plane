from django.db import migrations
from django.db.models import BooleanField, Case, F, PositiveSmallIntegerField, Value, When


def revoke_stale_instance_admin_access(apps, schema_editor):
    alias = schema_editor.connection.alias
    InstanceAdmin = apps.get_model("license", "InstanceAdmin")
    live_admins = (
        InstanceAdmin.objects.using(alias)
        .filter(deleted_at__isnull=True, role__gte=15, user_id__isnull=False)
        .values("user_id")
    )
    for name in ("ProjectMember", "WorkspaceMember"):
        Member = apps.get_model("db", name)
        Member.objects.using(alias).filter(deleted_at__isnull=True, is_instance_admin_access=True).exclude(
            member_id__in=live_admins
        ).update(
            role=Case(
                When(instance_admin_previous_role__isnull=False, then=F("instance_admin_previous_role")),
                default=Value(5),
                output_field=PositiveSmallIntegerField(),
            ),
            is_active=Case(
                When(instance_admin_previous_role__isnull=True, then=Value(False)),
                default=F("is_active"),
                output_field=BooleanField(),
            ),
            is_instance_admin_access=False,
            instance_admin_previous_role=None,
        )


class Migration(migrations.Migration):
    dependencies = [("db", "0132_issue_worklogs_and_workspace_tags"), ("license", "0007_instanceadmin_roles")]
    operations = [migrations.RunPython(revoke_stale_instance_admin_access, migrations.RunPython.noop)]
