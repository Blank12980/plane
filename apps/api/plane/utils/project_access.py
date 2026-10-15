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
    Workspace,
)
from plane.db.models.project import ROLE, ProjectNetwork
from plane.license.models import InstanceAdmin, INSTANCE_ADMIN_ROLE
from plane.utils.core import set_use_read_replica
from plane.utils.client_access import client_grants


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
        _workspace_client=Exists(workspace_members.filter(role=ROLE.CLIENT.value)),
        _active_project_member=Exists(project_members),
    )
    access = Q(_workspace_admin=True) | Q(_active_project_member=True, _workspace_client=False)
    if include_public:
        access |= Q(network=ProjectNetwork.PUBLIC.value, _workspace_client=False)
    return projects.filter(access, _active_workspace_member=True)


def require_project_access(user, slug, project_id):
    project_id = UUIDField().run_validation(project_id)
    if not projects_for_user(user, slug).filter(pk=project_id).exists():
        raise PermissionDenied("You must be invited to this project to access it.")


def require_asset_access(user, slug, asset, *, discovery=False):
    asset_slug = slug or (asset.workspace.slug if getattr(asset, "workspace_id", None) else None)
    if is_workspace_client(user, asset_slug):
        grants = client_grants(user, asset_slug)
        allowed = False
        if getattr(asset, "comment_id", None):
            allowed = (
                asset.comment.deleted_at is None
                and asset.comment.access == "EXTERNAL"
                and grants.filter(issue_id=asset.comment.issue_id).exists()
            )
        elif getattr(asset, "issue_id", None):
            allowed = grants.filter(issue_id=asset.issue_id).exists()
        elif getattr(asset, "page_id", None):
            allowed = grants.filter(page_id=asset.page_id).exists()
        elif asset.entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            allowed = asset.workspace.slug == asset_slug
        if not allowed:
            raise PermissionDenied("This file has not been shared with you.")
        return
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
    if is_workspace_client(user, slug):
        return ROLE.CLIENT.value in roles
    return ProjectMember.objects.filter(
        workspace__slug=slug,
        project_id=project_id,
        member=user,
        is_active=True,
        role__in=roles,
        is_instance_admin_access=False,
    ).exists()


def is_workspace_client(user, slug):
    return (
        bool(slug)
        and user.is_authenticated
        and not is_workspace_admin(user, slug)
        and WorkspaceMember.objects.filter(
            workspace__slug=slug,
            member=user,
            role=ROLE.CLIENT.value,
            is_active=True,
            is_instance_admin_access=False,
        ).exists()
    )


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
    # Workspace endpoints must explicitly opt in after their querysets have
    # been restricted to the client's projects (or the client's own settings).
    client_workspace_read = False
    client_self_service_methods = ()

    def check_client_permissions(self, request, slug, project_id, asset):
        if not is_workspace_client(request.user, slug):
            return
        member_id = self.kwargs.get("member_id")
        if member_id and str(member_id) != str(request.user.id):
            raise PermissionDenied("Clients can only access their own preferences.")
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            leaving = getattr(self, "action", None) == "leave"
            if not leaving and request.method not in self.client_self_service_methods:
                raise PermissionDenied("Clients have read-only access.")
        # Client content is served through the explicitly filtered resource
        # endpoints. Project membership never opens the ordinary project APIs.
        scoped = False
        if asset:
            grants = client_grants(request.user, slug)
            if asset.issue_id:
                scoped = grants.filter(issue_id=asset.issue_id).exists()
            elif asset.page_id:
                scoped = grants.filter(page_id=asset.page_id).exists()
            elif asset.comment_id:
                scoped = asset.comment.access == "EXTERNAL" and grants.filter(issue_id=asset.comment.issue_id).exists()
            if asset.entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
                scoped = asset.workspace.slug == slug
        if not scoped and not self.client_workspace_read:
            raise PermissionDenied("Use the client portal to access shared work items and pages.")

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
            if is_workspace_client(request.user, self.kwargs.get("slug")):
                raise PermissionDenied("Clients receive individual resources through the client portal.")
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
                if not slug:
                    slug = Project.objects.filter(pk=chat_project).values_list("workspace__slug", flat=True).first()
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
            if not slug and asset.workspace_id:
                slug = asset.workspace.slug
        if not slug and self.kwargs.get("workspace_id"):
            slug = Workspace.objects.filter(pk=self.kwargs["workspace_id"]).values_list("slug", flat=True).first()
        self.check_client_permissions(request, slug, project_id, asset)
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
