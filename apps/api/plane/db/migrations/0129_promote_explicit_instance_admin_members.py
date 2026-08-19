from django.db import migrations
from django.db.models import Q


def promote_explicit_instance_admin_members(apps, schema_editor):
    Workspace = apps.get_model("db", "Workspace")
    WorkspaceMember = apps.get_model("db", "WorkspaceMember")
    ProjectMember = apps.get_model("db", "ProjectMember")
    Project = apps.get_model("db", "Project")

    owner_ids = set(Workspace.objects.values_list("id", "owner_id"))
    owner_by_workspace = {workspace_id: owner_id for workspace_id, owner_id in owner_ids}

    creator_pairs = set(Project.objects.values_list("workspace_id", "created_by_id"))
    lead_pairs = set(
        Project.objects.exclude(project_lead_id__isnull=True).values_list("workspace_id", "project_lead_id")
    )

    explicit_members = WorkspaceMember.objects.filter(
        is_instance_admin_access=True,
        is_active=True,
        deleted_at__isnull=True,
    ).filter(Q(instance_admin_previous_role__isnull=False) | Q(role__lt=20))

    extra_ids = []
    for member in WorkspaceMember.objects.filter(
        is_instance_admin_access=True,
        is_active=True,
        deleted_at__isnull=True,
        role=20,
        instance_admin_previous_role__isnull=True,
    ).iterator():
        if owner_by_workspace.get(member.workspace_id) == member.member_id:
            extra_ids.append(member.id)
        elif (member.workspace_id, member.member_id) in creator_pairs:
            extra_ids.append(member.id)
        elif (member.workspace_id, member.member_id) in lead_pairs:
            extra_ids.append(member.id)

    explicit_ids = list(explicit_members.values_list("id", flat=True)) + extra_ids
    if not explicit_ids:
        return

    WorkspaceMember.objects.filter(id__in=explicit_ids).update(
        is_instance_admin_access=False,
        instance_admin_previous_role=None,
    )

    promoted = WorkspaceMember.objects.filter(id__in=explicit_ids)
    for workspace_member in promoted.iterator():
        ProjectMember.objects.filter(
            workspace_id=workspace_member.workspace_id,
            member_id=workspace_member.member_id,
            is_instance_admin_access=True,
            deleted_at__isnull=True,
        ).update(
            is_instance_admin_access=False,
            instance_admin_previous_role=None,
            is_active=True,
        )


def noop_reverse(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0128_default_task_states"),
    ]

    operations = [
        migrations.RunPython(promote_explicit_instance_admin_members, noop_reverse),
    ]
