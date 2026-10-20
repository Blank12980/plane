# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.http import HttpResponseRedirect
from rest_framework import serializers, status
from rest_framework.response import Response

from rest_framework.exceptions import PermissionDenied

from plane.app.permissions import ROLE, WorkspaceUserPermission, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import (
    ClientAccessGrant,
    FileAsset,
    Issue,
    IssueComment,
    Page,
    ProjectClient,
    ProjectPage,
    WorkspaceMember,
)
from plane.utils.client_access import client_grants, make_workspace_client
from plane.utils.project_access import has_project_role, is_workspace_admin, projects_for_user
from plane.settings.storage import S3Storage


def grant_data(grant):
    resource = grant.issue if grant.issue_id else grant.page
    return {
        "id": str(grant.id),
        "resource_type": "issue" if grant.issue_id else "page",
        "resource_id": str(resource.id),
        "name": resource.name,
        "project_id": str(grant.project_id),
        "project_name": grant.project.name,
        "identifier": f"{grant.project.identifier}-{resource.sequence_id}" if grant.issue_id else None,
    }


def active_grants():
    return (
        ClientAccessGrant.objects.select_related("issue", "page", "project")
        .filter(
            project__deleted_at__isnull=True,
        )
        .filter(
            Q(issue__isnull=False, issue__deleted_at__isnull=True)
            | Q(page__isnull=False, page__deleted_at__isnull=True)
        )
    )


def require_client_management(user, slug, project_id=None):
    """Who may configure what a client sees.

    * the whole workspace (no project given): workspace admins and instance admins;
    * one project: the admin of that project, and every workspace/instance admin (they administer all projects).
    A project admin therefore only ever reaches the clients' access inside the project they administer.
    """
    allowed = (
        is_workspace_admin(user, slug)
        if project_id is None
        else has_project_role(user, slug, project_id, [ROLE.ADMIN.value])
    )
    if not allowed:
        raise PermissionDenied("You are not allowed to manage client access here.")


def optional_project_id(value):
    return serializers.UUIDField().run_validation(value) if value else None


def project_client_ids(project):
    """Clients that belong to a project: added to it explicitly or already holding shared items inside it."""
    added = ProjectClient.objects.filter(project=project).values("client_id")
    sharing = active_grants().filter(project=project).values("client_id")
    return set(added.values_list("client_id", flat=True)) | set(sharing.values_list("client_id", flat=True))


class ClientListEndpoint(BaseAPIView):
    """Clients of the workspace with a summary of what they can see (optionally inside one project)."""

    permission_classes = [WorkspaceUserPermission]

    def get(self, request, slug):
        project_id = optional_project_id(request.query_params.get("project_id"))
        require_client_management(request.user, slug, project_id)
        project = None
        if project_id:
            project = get_object_or_404(
                projects_for_user(request.user, slug).filter(archived_at__isnull=True), id=project_id
            )
        members = WorkspaceMember.objects.filter(
            workspace__slug=slug, role=3, is_active=True, is_instance_admin_access=False, member__is_bot=False
        ).select_related("member")
        if project:
            # In a project only the clients that belong to it are listed.
            members = members.filter(member_id__in=project_client_ids(project))
        grants = active_grants().filter(workspace__slug=slug)
        if project:
            grants = grants.filter(project=project)
        counts = {}
        for client_id, issue_id, page_id in grants.values_list("client_id", "issue_id", "page_id"):
            entry = counts.setdefault(client_id, {"issues": 0, "pages": 0})
            entry["issues" if issue_id else "pages"] += 1
        return Response(
            {
                "project": {"id": str(project.id), "name": project.name, "identifier": project.identifier}
                if project
                else None,
                # Making a workspace member a client changes their workspace role: administrators only.
                "can_promote": is_workspace_admin(request.user, slug),
                "clients": [
                    {
                        "id": str(member.member_id),
                        "display_name": member.member.display_name,
                        "email": member.member.email,
                        "avatar_url": member.member.avatar_url,
                        "issue_count": counts.get(member.member_id, {}).get("issues", 0),
                        "page_count": counts.get(member.member_id, {}).get("pages", 0),
                    }
                    for member in members.order_by("member__display_name", "member__email")
                ],
            }
        )


class ClientAccessEndpoint(BaseAPIView):
    permission_classes = [WorkspaceUserPermission]

    def target_client(self, slug, client_id, *, lock=False):
        members = WorkspaceMember.objects.select_for_update() if lock else WorkspaceMember.objects.all()
        return get_object_or_404(
            members, workspace__slug=slug, member_id=client_id, role=3, is_active=True, is_instance_admin_access=False
        )

    def get(self, request, slug, client_id):
        project_id = optional_project_id(request.query_params.get("project_id"))
        require_client_management(request.user, slug, project_id)
        self.target_client(slug, client_id)
        kind = serializers.ChoiceField(choices=["issue", "page"]).run_validation(
            request.query_params.get("type", "issue")
        )
        query = request.query_params.get("search", "").strip()[:200]
        page = serializers.IntegerField(min_value=1).run_validation(request.query_params.get("page", 1))
        projects = projects_for_user(request.user, slug).filter(archived_at__isnull=True)
        available_projects = list(projects.values("id", "name", "identifier").order_by("name"))
        if project_id:
            projects = projects.filter(id=project_id)
        if kind == "issue":
            resources = Issue.issue_objects.filter(project__in=projects, is_draft=False).select_related("project")
        else:
            resources = ProjectPage.objects.filter(
                project__in=projects,
                page__deleted_at__isnull=True,
            ).select_related("project", "page")
        resources = resources.filter(**{"name__icontains" if kind == "issue" else "page__name__icontains": query})
        resources = list(resources.order_by("id")[(page - 1) * 50 : page * 50 + 1])
        candidates = []
        for row in resources[:50]:
            resource = row if kind == "issue" else row.page
            candidates.append(
                {
                    "resource_type": kind,
                    "resource_id": str(resource.id),
                    "name": resource.name,
                    "project_id": str(row.project_id),
                    "project_name": row.project.name,
                }
            )
        grants = active_grants().filter(workspace__slug=slug, client_id=client_id)
        if project_id:
            grants = grants.filter(project_id=project_id)
        return Response(
            {
                "grants": [grant_data(grant) for grant in grants],
                "resources": candidates,
                "projects": available_projects,
                "has_more": len(resources) > 50,
            }
        )

    @transaction.atomic
    def post(self, request, slug, client_id):
        try:
            project_id = serializers.UUIDField().run_validation(request.data.get("project_id"))
        except serializers.ValidationError:
            # Malformed requests from someone who may not manage clients at all are rejected as forbidden first.
            require_client_management(request.user, slug)
            raise
        require_client_management(request.user, slug, project_id)
        membership = self.target_client(slug, client_id, lock=True)
        project = get_object_or_404(projects_for_user(request.user, slug), id=project_id, archived_at__isnull=True)
        kind = serializers.ChoiceField(choices=["issue", "page"]).run_validation(request.data.get("resource_type"))
        resource_id = serializers.UUIDField().run_validation(request.data.get("resource_id"))
        if kind == "issue":
            resource = get_object_or_404(Issue.issue_objects, id=resource_id, project=project, is_draft=False)
        else:
            resource = get_object_or_404(
                Page,
                id=resource_id,
                workspace_id=project.workspace_id,
                project_pages__project=project,
                project_pages__deleted_at__isnull=True,
            )
        grant, created = ClientAccessGrant.objects.get_or_create(
            client_id=client_id,
            workspace=membership.workspace,
            project=project,
            **{kind: resource},
            defaults={"created_by": request.user},
        )
        if created:
            ClientAccessGrant.objects.filter(pk=grant.pk).update(created_by_id=request.user.id)
        # sharing something with a client makes them a client of that project
        ProjectClient.objects.get_or_create(
            client_id=client_id,
            project=project,
            workspace=membership.workspace,
            defaults={"created_by": request.user},
        )
        return Response(grant_data(grant), status=status.HTTP_201_CREATED)

    def delete(self, request, slug, client_id, grant_id):
        grant = get_object_or_404(ClientAccessGrant, id=grant_id, workspace__slug=slug, client_id=client_id)
        require_client_management(request.user, slug, grant.project_id)
        self.target_client(slug, client_id)
        grant.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientCandidatesEndpoint(BaseAPIView):
    """Who can be added to a project as a client."""

    permission_classes = [WorkspaceUserPermission]

    def get(self, request, slug):
        project_id = serializers.UUIDField().run_validation(request.query_params.get("project_id"))
        require_client_management(request.user, slug, project_id)
        project = get_object_or_404(
            projects_for_user(request.user, slug).filter(archived_at__isnull=True), id=project_id
        )
        query = request.query_params.get("search", "").strip()[:100]

        def people(role_filter, exclude=None):
            members = WorkspaceMember.objects.filter(
                workspace__slug=slug,
                is_active=True,
                is_instance_admin_access=False,
                member__is_bot=False,
                member__is_active=True,
                **role_filter,
            ).select_related("member")
            if exclude is not None:
                members = members.exclude(member_id__in=exclude)
            if query:
                members = members.filter(Q(member__display_name__icontains=query) | Q(member__email__icontains=query))
            return members.order_by("member__display_name", "member__email")[:50]

        def payload(member):
            return {
                "id": str(member.member_id),
                "display_name": member.member.display_name,
                "email": member.member.email,
                "avatar_url": member.member.avatar_url,
                "role": member.role,
            }

        already_added = project_client_ids(project)
        can_promote = is_workspace_admin(request.user, slug)
        return Response(
            {
                "project": {"id": str(project.id), "name": project.name, "identifier": project.identifier},
                # clients of the workspace that are not in this project yet
                "clients": [payload(member) for member in people({"role": 3}, exclude=already_added)],
                # members who could become clients (administrators of the workspace only)
                "members": (
                    [payload(member) for member in people({"role__in": [5, 15]}, exclude=[request.user.id])]
                    if can_promote
                    else []
                ),
                "can_promote": can_promote,
            }
        )


class ClientProjectLinkEndpoint(BaseAPIView):
    """Add clients to a project and remove them from it."""

    permission_classes = [WorkspaceUserPermission]

    @transaction.atomic
    def post(self, request, slug):
        try:
            project_id = serializers.UUIDField().run_validation(request.data.get("project_id"))
        except serializers.ValidationError:
            require_client_management(request.user, slug)
            raise
        require_client_management(request.user, slug, project_id)
        project = get_object_or_404(
            projects_for_user(request.user, slug).filter(archived_at__isnull=True), id=project_id
        )
        id_list = serializers.ListField(child=serializers.UUIDField(), max_length=100, required=False)
        client_ids = set(id_list.run_validation(request.data.get("client_ids", [])))
        promote_ids = set(id_list.run_validation(request.data.get("promote_member_ids", [])))
        if not client_ids and not promote_ids:
            return Response({"error": "Choose at least one client."}, status=status.HTTP_400_BAD_REQUEST)

        if promote_ids:
            if not is_workspace_admin(request.user, slug):
                raise PermissionDenied("Only workspace administrators can make a member a client.")
            members = list(
                WorkspaceMember.objects.select_for_update().filter(
                    workspace__slug=slug,
                    member_id__in=promote_ids,
                    role__in=[5, 15],
                    is_active=True,
                    is_instance_admin_access=False,
                    member__is_bot=False,
                )
            )
            if len(members) != len(promote_ids) or request.user.id in promote_ids:
                return Response(
                    {"error": "Only active guests and members can become clients."}, status=status.HTTP_400_BAD_REQUEST
                )
            for member in members:
                make_workspace_client(member)
            client_ids |= promote_ids

        clients = WorkspaceMember.objects.filter(
            workspace__slug=slug, member_id__in=client_ids, role=3, is_active=True, is_instance_admin_access=False
        )
        if clients.count() != len(client_ids):
            return Response(
                {"error": "Some of the users are not clients of this workspace."}, status=status.HTTP_400_BAD_REQUEST
            )
        linked = 0
        for membership in clients:
            _, created = ProjectClient.objects.get_or_create(
                client_id=membership.member_id,
                project=project,
                workspace=membership.workspace,
                defaults={"created_by": request.user},
            )
            linked += int(created)
        return Response({"linked": linked, "promoted": len(promote_ids)}, status=status.HTTP_201_CREATED)

    def delete(self, request, slug, client_id):
        project_id = serializers.UUIDField().run_validation(request.query_params.get("project_id"))
        require_client_management(request.user, slug, project_id)
        get_object_or_404(projects_for_user(request.user, slug), id=project_id)
        with transaction.atomic():
            # leaving the project closes what was shared inside it; other projects are untouched
            ClientAccessGrant.objects.filter(workspace__slug=slug, project_id=project_id, client_id=client_id).delete()
            ProjectClient.objects.filter(workspace__slug=slug, project_id=project_id, client_id=client_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ClientResourcesEndpoint(BaseAPIView):
    permission_classes = [WorkspaceUserPermission]
    client_workspace_read = True

    @allow_permission([ROLE.CLIENT, ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, grant_id=None):
        grants = client_grants(request.user, slug).select_related("issue", "issue__state", "page", "project")
        if grant_id is None:
            return Response([grant_data(grant) for grant in grants.order_by("project__name", "created_at")])
        grant = get_object_or_404(grants, id=grant_id)
        resource = grant.issue if grant.issue_id else grant.page
        result = {**grant_data(grant), "description_html": resource.description_html or "", "attachments": []}
        assets = FileAsset.objects.filter(is_uploaded=True, is_deleted=False, workspace_id=grant.workspace_id)
        if grant.issue_id:
            result.update(
                status=resource.state.name if resource.state else None,
                priority=resource.priority,
                target_date=resource.target_date,
                deadline_at=resource.deadline_at,
            )
            assets = assets.filter(issue_id=grant.issue_id, entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT)
            comments = IssueComment.objects.filter(issue_id=grant.issue_id, access="EXTERNAL").select_related("actor")
            result["comments"] = [
                {
                    "id": str(comment.id),
                    "html": comment.comment_html,
                    "author": comment.actor.display_name if comment.actor else "",
                    "created_at": comment.created_at,
                }
                for comment in comments.order_by("created_at")
            ]
        else:
            assets = assets.none()
        result["attachments"] = [
            {
                "id": str(asset.id),
                "name": asset.attributes.get("name", "Файл"),
                "url": f"/api/workspaces/{slug}/client-resources/{grant.id}/files/{asset.id}/",
            }
            for asset in assets
        ]
        return Response(result)


class ClientResourceAssetEndpoint(BaseAPIView):
    permission_classes = [WorkspaceUserPermission]
    client_workspace_read = True

    @allow_permission([ROLE.CLIENT, ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, grant_id, asset_id):
        grant = get_object_or_404(client_grants(request.user, slug), id=grant_id)
        assets = FileAsset.objects.filter(workspace_id=grant.workspace_id, is_uploaded=True, is_deleted=False)
        if grant.issue_id:
            assets = assets.filter(
                Q(issue_id=grant.issue_id)
                | Q(comment__issue_id=grant.issue_id, comment__access="EXTERNAL", comment__deleted_at__isnull=True)
            )
        else:
            assets = assets.filter(page_id=grant.page_id)
        asset = get_object_or_404(assets, id=asset_id)
        url = S3Storage(request=request).generate_presigned_url(object_name=asset.asset.name)
        return HttpResponseRedirect(url)
