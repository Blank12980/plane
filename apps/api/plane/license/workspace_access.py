# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction

from plane.db.models import Project, ProjectMember, Workspace, WorkspaceMember
from plane.license.models import InstanceAdmin, INSTANCE_ADMIN_ROLE


def _grant_member_access(model, lookup, create_values=None):
    create_values = create_values or {}
    member = model.objects.filter(**lookup, deleted_at__isnull=True).first()

    if member is None:
        member = model(
            **lookup,
            **create_values,
            role=20,
            is_active=True,
            is_instance_admin_access=True,
        )
        if model is ProjectMember:
            # ProjectMember.save() creates personal sorting metadata. A global
            # access projection does not need that user preference row.
            model.objects.bulk_create([member])
        else:
            member.save()
        return

    # An explicit workspace/project membership (invite, official add, self-join)
    # must stay visible and assignable. Only create a hidden projection when
    # the person is not already a real member.
    if member.is_active and not member.is_instance_admin_access:
        return

    if not member.is_instance_admin_access:
        member.instance_admin_previous_role = member.role if member.is_active else None
    member.role = 20
    member.is_active = True
    member.is_instance_admin_access = True
    member.save(
        update_fields=[
            "role",
            "is_active",
            "is_instance_admin_access",
            "instance_admin_previous_role",
            "updated_at",
        ]
    )


@transaction.atomic
def grant_instance_admin_access(user, workspace=None, project=None):
    """Project an instance admin's global access into Plane memberships."""

    if workspace is not None:
        workspaces = [workspace]
    elif project is not None:
        workspaces = [project.workspace]
    else:
        workspaces = Workspace.objects.all()

    for current_workspace in workspaces:
        _grant_member_access(
            WorkspaceMember,
            {"workspace": current_workspace, "member": user},
        )

    if project is not None:
        projects = [project]
    elif workspace is not None:
        projects = Project.objects.filter(workspace=workspace)
    else:
        projects = Project.objects.all()

    for current_project in projects:
        _grant_member_access(
            ProjectMember,
            {"project": current_project, "member": user},
            {"workspace": current_project.workspace},
        )


@transaction.atomic
def grant_all_instance_admins_access(workspace=None, project=None, exclude_users=None):
    admins = InstanceAdmin.objects.filter(
        role__gte=INSTANCE_ADMIN_ROLE,
        user__isnull=False,
    ).select_related("user")
    excluded_user_ids = [user.id for user in (exclude_users or []) if user is not None]
    if excluded_user_ids:
        admins = admins.exclude(user_id__in=excluded_user_ids)
    for admin in admins:
        grant_instance_admin_access(admin.user, workspace=workspace, project=project)


def _promote_member_record(member, role=None):
    if member is None:
        return
    if role is not None:
        member.role = role
    member.is_active = True
    member.is_instance_admin_access = False
    member.instance_admin_previous_role = None
    member.save(
        update_fields=[
            "role",
            "is_active",
            "is_instance_admin_access",
            "instance_admin_previous_role",
            "updated_at",
        ]
    )


@transaction.atomic
def promote_explicit_workspace_membership(user, workspace, role=None, include_projects=True):
    """Turn a hidden instance-admin projection into a visible workspace membership.

    Used when an instance admin is invited, officially added, or joins on their
    own. After this they appear in member pickers and can be assigned.
    """

    workspace_member = WorkspaceMember.objects.filter(
        workspace=workspace,
        member=user,
        deleted_at__isnull=True,
    ).first()
    if workspace_member is None:
        workspace_member = WorkspaceMember.objects.create(
            workspace=workspace,
            member=user,
            role=20 if role is None else role,
            is_active=True,
            is_instance_admin_access=False,
        )
    else:
        _promote_member_record(workspace_member, role=role)

    if not include_projects:
        return workspace_member

    project_members = ProjectMember.objects.filter(
        workspace=workspace,
        member=user,
        deleted_at__isnull=True,
    )
    target_role = workspace_member.role
    for project_member in project_members:
        _promote_member_record(project_member, role=target_role)
    return workspace_member


@transaction.atomic
def promote_explicit_project_membership(user, project, role=None):
    """Make a hidden project projection visible when the user is added to it."""

    workspace_member = WorkspaceMember.objects.filter(
        workspace=project.workspace,
        member=user,
        deleted_at__isnull=True,
        is_active=True,
    ).first()
    if workspace_member is not None and workspace_member.is_instance_admin_access:
        promote_explicit_workspace_membership(user, project.workspace, role=role, include_projects=False)

    project_member = ProjectMember.objects.filter(
        project=project,
        member=user,
        deleted_at__isnull=True,
    ).first()
    if project_member is None:
        return ProjectMember.objects.create(
            project=project,
            workspace=project.workspace,
            member=user,
            role=20 if role is None else role,
            is_active=True,
            is_instance_admin_access=False,
        )
    _promote_member_record(project_member, role=role)
    return project_member


@transaction.atomic
def revoke_instance_admin_access(user):
    """Remove projected access and restore any pre-existing local roles."""

    for model in (ProjectMember, WorkspaceMember):
        members = model.objects.filter(member=user, is_instance_admin_access=True)
        for member in members:
            if member.instance_admin_previous_role is None:
                member.is_active = False
            else:
                member.role = member.instance_admin_previous_role
            member.is_instance_admin_access = False
            member.instance_admin_previous_role = None
            member.save(
                update_fields=[
                    "role",
                    "is_active",
                    "is_instance_admin_access",
                    "instance_admin_previous_role",
                    "updated_at",
                ]
            )
