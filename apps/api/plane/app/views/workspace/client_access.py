# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.http import HttpResponseRedirect
from rest_framework import serializers, status
from rest_framework.response import Response

from plane.app.permissions import ROLE, WorkspaceUserPermission, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import ClientAccessGrant, FileAsset, Issue, IssueComment, Page, ProjectPage, WorkspaceMember
from plane.utils.client_access import client_grants
from plane.utils.project_access import projects_for_user
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


class ClientAccessEndpoint(BaseAPIView):
    permission_classes = [WorkspaceUserPermission]

    def target_client(self, slug, client_id, *, lock=False):
        members = WorkspaceMember.objects.select_for_update() if lock else WorkspaceMember.objects.all()
        return get_object_or_404(
            members, workspace__slug=slug, member_id=client_id, role=3, is_active=True, is_instance_admin_access=False
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def get(self, request, slug, client_id):
        self.target_client(slug, client_id)
        project_id = request.query_params.get("project_id")
        kind = serializers.ChoiceField(choices=["issue", "page"]).run_validation(
            request.query_params.get("type", "issue")
        )
        query = request.query_params.get("search", "").strip()[:200]
        page = serializers.IntegerField(min_value=1).run_validation(request.query_params.get("page", 1))
        projects = projects_for_user(request.user, slug).filter(archived_at__isnull=True)
        available_projects = list(projects.values("id", "name", "identifier").order_by("name"))
        if project_id:
            project_id = serializers.UUIDField().run_validation(project_id)
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
        return Response(
            {
                "grants": [grant_data(grant) for grant in grants],
                "resources": candidates,
                "projects": available_projects,
                "has_more": len(resources) > 50,
            }
        )

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    @transaction.atomic
    def post(self, request, slug, client_id):
        membership = self.target_client(slug, client_id, lock=True)
        project_id = serializers.UUIDField().run_validation(request.data.get("project_id"))
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
        return Response(grant_data(grant), status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, client_id, grant_id):
        self.target_client(slug, client_id)
        grant = get_object_or_404(ClientAccessGrant, id=grant_id, workspace__slug=slug, client_id=client_id)
        grant.delete()
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
