# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.permissions import SAFE_METHODS, BasePermission

from plane.db.models import WorkspaceMember
from plane.db.models.project import ROLE
from plane.utils.project_access import has_project_role, is_workspace_admin, projects_for_user


class ProjectBasePermission(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if view.project_id:
            roles = [role.value for role in ROLE] if request.method in SAFE_METHODS else [ROLE.ADMIN.value]
            return has_project_role(request.user, view.workspace_slug, view.project_id, roles)
        if is_workspace_admin(request.user, view.workspace_slug):
            return True
        members = WorkspaceMember.objects.filter(
            workspace__slug=view.workspace_slug, member=request.user, is_active=True
        )
        if request.method in SAFE_METHODS:
            return members.exists()
        return request.method == "POST" and members.filter(role=ROLE.MEMBER.value).exists()


class ProjectEntityPermission(BasePermission):
    def has_permission(self, request, view):
        identifier = getattr(view, "project_identifier", None)
        if identifier:
            project_id = (
                projects_for_user(request.user, view.workspace_slug)
                .filter(identifier=identifier)
                .values_list("pk", flat=True)
                .first()
            )
        else:
            project_id = view.project_id
        if not project_id:
            return False
        roles = (
            [role.value for role in ROLE] if request.method in SAFE_METHODS else [ROLE.ADMIN.value, ROLE.MEMBER.value]
        )
        return has_project_role(request.user, view.workspace_slug, project_id, roles)


class ProjectMemberPermission(ProjectEntityPermission):
    pass


class ProjectAdminPermission(BasePermission):
    def has_permission(self, request, view):
        return has_project_role(request.user, view.workspace_slug, view.project_id, [ROLE.ADMIN.value])


class ProjectLitePermission(BasePermission):
    def has_permission(self, request, view):
        return has_project_role(request.user, view.workspace_slug, view.project_id, [role.value for role in ROLE])
