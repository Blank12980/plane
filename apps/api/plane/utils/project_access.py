# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import BooleanField, Exists, OuterRef, Q, Subquery, Value
from rest_framework.exceptions import PermissionDenied
from rest_framework.serializers import UUIDField

from plane.db.models import (
    ChatMessenger,
    Cycle,
    Module,
    ProjectPage,
    DeployBoard,
    FileAsset,
    Issue,
    IssueComment,
    Page,
    Project,
    ProjectMember,
    WorkspaceMember,
)
from plane.db.models.project import ROLE, ProjectNetwork
from plane.license.models import InstanceAdmin, INSTANCE_ADMIN_ROLE
from plane.utils.core import set_use_read_replica


def is_instance_admin(user):
    return (
        user.is_authenticated
        and InstanceAdmin.objects.using("default").filter(user=user, role__gte=INSTANCE_ADMIN_ROLE).exists()
    )


def is_workspace_admin(user, slug):
    if not user.is_authenticated:
        return False
    return (
        is_instance_admin(user)
        or WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=user,
            role=ROLE.ADMIN.value,
            is_active=True,
            is_instance_admin_access=False,
        ).exists()
    )


def projects_for_user(user, slug=None, *, include_public=False):
    """Public projects are discoverable; their contents still require membership."""
    projects = Project.objects.filter(workspace__deleted_at__isnull=True)
    if slug is not None:
        projects = projects.filter(workspace__slug=slug)
    if not user.is_authenticated:
        return projects.none()
    if is_instance_admin(user):
        return projects

    workspace_members = WorkspaceMember.objects.filter(
        workspace_id=OuterRef("workspace_id"), member=user, is_active=True, is_instance_admin_access=False
    )
    project_members = ProjectMember.objects.filter(
        project_id=OuterRef("pk"),
        workspace_id=OuterRef("workspace_id"),
        member=user,
        is_active=True,
        is_instance_admin_access=False,
    )
    projects = projects.alias(
        _active_workspace_member=Exists(workspace_members),
        _workspace_admin=Exists(workspace_members.filter(role=ROLE.ADMIN.value)),
        _active_project_member=Exists(project_members),
    )
    access = Q(_workspace_admin=True) | Q(_active_project_member=True)
    if include_public:
        access |= Q(network=ProjectNetwork.PUBLIC.value)
    return projects.filter(access, _active_workspace_member=True)


def require_project_access(user, slug, project_id):
    project_id = UUIDField().run_validation(project_id)
    if not projects_for_user(user, slug).filter(pk=project_id).exists():
        raise PermissionDenied("You must be invited to this project to access it.")


def require_asset_access(user, slug, asset, *, discovery=False):
    project_id = asset.project_id
    if project_id is None and asset.issue_id:
        project_id = asset.issue.project_id
    if project_id is None and asset.comment_id:
        project_id = asset.comment.project_id
    if project_id:
        if discovery and asset.entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            if projects_for_user(user, slug, include_public=True).filter(pk=project_id).exists():
                return
        require_project_access(user, slug, project_id)
    elif (
        asset.page_id
        and not projects_for_user(user, slug)
        .filter(project_pages__page_id=asset.page_id, project_pages__deleted_at__isnull=True)
        .exists()
    ):
        raise PermissionDenied("You do not have access to this page's files.")


def has_project_role(user, slug, project_id, roles):
    if not projects_for_user(user, slug).filter(pk=project_id).exists():
        return False
    if is_workspace_admin(user, slug):
        return True
    return ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        is_active=True,
        role__in=roles,
        is_instance_admin_access=False,
    ).exists()


def annotate_project_membership(projects, user, slug):
    """Report explicit membership separately from administrative access."""
    membership = ProjectMember.objects.filter(
        workspace__slug=slug,
        workspace_id=OuterRef("workspace_id"),
        project_id=OuterRef("pk"),
        member=user,
        is_active=True,
        is_instance_admin_access=False,
    )
    return projects.annotate(
        member_role=Subquery(membership.values("role")[:1]),
        is_member=Exists(membership),
        can_leave=Exists(membership),
        has_admin_access=Value(is_workspace_admin(user, slug), output_field=BooleanField()),
    )


def project_list_data(user, slug, data):
    """Limit non-members to the metadata needed to discover a public project."""
    accessible_ids = {str(pk) for pk in projects_for_user(user, slug).values_list("pk", flat=True)}
    discovery_fields = {
        "id",
        "name",
        "identifier",
        "network",
        "workspace",
        "workspace_detail",
        "logo_props",
        "cover_image_url",
        "archived_at",
        "created_at",
        "updated_at",
        "sort_order",
        "member_role",
        "is_member",
        "can_leave",
        "has_admin_access",
    }
    return [
        project
        if str(project.get("id")) in accessible_ids
        else {key: value for key, value in project.items() if key in discovery_fields}
        for project in data
    ]


class ProjectAccessMixin:
    """Enforce membership even on endpoints that only declare IsAuthenticated.

    Invitation acceptance checks the recipient separately. It is the only
    project endpoint that must be reachable before a membership exists.
    """

    project_invitation_endpoint = False

    def check_permissions(self, request):
        # Membership revocations and privacy changes must take effect immediately,
        # including in workspace lists; a lagging replica cannot authorize access.
        if any(
            key in self.kwargs
            for key in ("slug", "project_id", "project_identifier", "anchor", "asset_id", "workspace_id")
        ):
            set_use_read_replica(False)
        super().check_permissions(request)
        if self.project_invitation_endpoint:
            return
        slug = self.kwargs.get("slug")
        project_id = self.kwargs.get("project_id") or request.query_params.get("project_id")
        match = getattr(request, "resolver_match", None)
        if project_id is None and match and match.url_name == "project":
            project_id = self.kwargs.get("pk")
        if project_id is not None:
            require_project_access(request.user, slug, project_id)
            # A valid project UUID must not authorize entities from another project.
            for key, model in (("issue_id", Issue), ("cycle_id", Cycle), ("module_id", Module)):
                entity_id = self.kwargs.get(key)
                if entity_id and not model.objects.filter(pk=entity_id, project_id=project_id).exists():
                    raise PermissionDenied("This resource does not belong to the project.")
            page_id = self.kwargs.get("page_id")
            if page_id and not ProjectPage.objects.filter(page_id=page_id, project_id=project_id).exists():
                raise PermissionDenied("This page does not belong to the project.")
        identifier = self.kwargs.get("project_identifier")
        if identifier and not projects_for_user(request.user, slug).filter(identifier=identifier).exists():
            raise PermissionDenied("You do not have access to this project.")
        anchor = self.kwargs.get("anchor")
        if anchor:
            board = DeployBoard.objects.filter(anchor=anchor).first()
            if board:
                require_project_access(request.user, slug, board.project_id)
        chat_ids = [self.kwargs.get("chat_id")]
        if match and match.url_name == "messenger-chat-detail":
            chat_ids.append(self.kwargs.get("pk"))
        if request.method not in ("GET", "HEAD", "OPTIONS") and isinstance(request.data, dict):
            chat_ids.extend(request.data.get(key) for key in ("source_chat_id", "target_chat_id", "chat_id"))
        for chat_id in filter(None, chat_ids):
            chat_id = UUIDField().run_validation(chat_id)
            chat_project = ChatMessenger.objects.filter(pk=chat_id).values_list("project_id", flat=True).first()
            if chat_project:
                require_project_access(request.user, slug, chat_project)
        # Workspace file routes and static URLs do not carry a project UUID.
        asset_id = self.kwargs.get("asset_id")
        asset_key = self.kwargs.get("asset_key")
        asset = None
        if asset_id:
            asset = FileAsset.all_objects.filter(pk=asset_id).select_related("issue", "comment").first()
        elif asset_key and self.kwargs.get("workspace_id"):
            key = f"{self.kwargs['workspace_id']}/{asset_key}"
            asset = FileAsset.all_objects.filter(asset=key).select_related("issue", "comment").first()
        if asset:
            require_asset_access(request.user, slug, asset, discovery=request.method in ("GET", "HEAD"))
        if request.method not in ("GET", "HEAD", "OPTIONS") and isinstance(request.data, dict):
            for key in ("project_id", "project", "target_project_id", "destination_project_id"):
                target_project = request.data.get(key)
                if target_project and not isinstance(target_project, (list, dict)):
                    require_project_access(request.user, slug, target_project)
            entity_type = request.data.get("entity_type")
            entity_id = request.data.get("entity_identifier")
            if (
                entity_type
                in (
                    "PROJECT_COVER",
                    "ISSUE_ATTACHMENT",
                    "ISSUE_DESCRIPTION",
                    "COMMENT_ATTACHMENT",
                    "COMMENT_DESCRIPTION",
                    "PAGE_DESCRIPTION",
                )
                and entity_id
            ):
                entity_id = UUIDField().run_validation(entity_id)
                if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
                    require_project_access(request.user, slug, entity_id)
                elif entity_type in (
                    "ISSUE_ATTACHMENT",
                    "ISSUE_DESCRIPTION",
                    "COMMENT_ATTACHMENT",
                    "COMMENT_DESCRIPTION",
                ):
                    model = IssueComment if entity_type.startswith("COMMENT_") else Issue
                    entity_project = model.objects.filter(pk=entity_id).values_list("project_id", flat=True).first()
                    if entity_project:
                        require_project_access(request.user, slug, entity_project)
                elif entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
                    if (
                        Page.objects.filter(pk=entity_id).exists()
                        and not projects_for_user(request.user, slug)
                        .filter(project_pages__page_id=entity_id, project_pages__deleted_at__isnull=True)
                        .exists()
                    ):
                        raise PermissionDenied("You do not have access to this page.")
