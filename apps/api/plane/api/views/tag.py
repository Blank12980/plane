# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.db import transaction
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import WorkspaceTagSerializer
from plane.db.models import Issue, IssueTag, Workspace, WorkspaceTag
from .base import BaseAPIView


class WorkspaceTagAPIEndpoint(BaseAPIView):
    """Workspace tags (shared by work items of every project). Writes are for workspace admins."""

    token_scope_resource = "tags"

    def get_queryset(self):
        return (
            WorkspaceTag.objects.filter(workspace__slug=self.kwargs.get("slug"))
            .select_related("image_asset")
            .order_by("name")
        )

    @extend_schema(operation_id="list_workspace_tags", summary="List workspace tags", tags=["Tags"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, pk=None):
        if pk is not None:
            tag = self.get_queryset().filter(pk=pk).first()
            if tag is None:
                return Response({"error": "Tag not found."}, status=status.HTTP_404_NOT_FOUND)
            return Response(WorkspaceTagSerializer(tag).data, status=status.HTTP_200_OK)
        return Response(WorkspaceTagSerializer(self.get_queryset(), many=True).data, status=status.HTTP_200_OK)

    @extend_schema(operation_id="create_workspace_tag", summary="Create workspace tag", tags=["Tags"])
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkspaceTagSerializer(data=request.data, context={"slug": slug})
        if serializer.is_valid():
            serializer.save(workspace=workspace)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(operation_id="update_workspace_tag", summary="Update workspace tag", tags=["Tags"])
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk):
        tag = self.get_queryset().filter(pk=pk).first()
        if tag is None:
            return Response({"error": "Tag not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = WorkspaceTagSerializer(tag, data=request.data, partial=True, context={"slug": slug})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(operation_id="delete_workspace_tag", summary="Delete workspace tag", tags=["Tags"])
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk):
        tag = self.get_queryset().filter(pk=pk).first()
        if tag is None:
            return Response({"error": "Tag not found."}, status=status.HTTP_404_NOT_FOUND)
        IssueTag.objects.filter(tag=tag).delete()
        if tag.image_asset is not None:
            tag.image_asset.is_deleted = True
            tag.image_asset.deleted_at = timezone.now()
            tag.image_asset.save(update_fields=["is_deleted", "deleted_at"])
        tag.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemTagAPIEndpoint(BaseAPIView):
    """Reads and replaces the set of workspace tags attached to a work item."""

    token_scope_resource = "tags"

    def get_issue(self, slug, project_id, issue_id):
        return Issue.issue_objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    def serialize_tags(self, slug, project_id, issue_id):
        tags = WorkspaceTag.objects.filter(
            tag_issues__issue_id=issue_id,
            tag_issues__project_id=project_id,
            tag_issues__deleted_at__isnull=True,
            workspace__slug=slug,
        ).order_by("name")
        data = WorkspaceTagSerializer(tags, many=True).data
        return {"tag_ids": [str(tag["id"]) for tag in data], "tags": data}

    @extend_schema(operation_id="list_work_item_tags", summary="List tags of a work item", tags=["Tags"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        if self.get_issue(slug, project_id, issue_id) is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(self.serialize_tags(slug, project_id, issue_id), status=status.HTTP_200_OK)

    @extend_schema(operation_id="set_work_item_tags", summary="Replace tags of a work item", tags=["Tags"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def put(self, request, slug, project_id, issue_id):
        issue = self.get_issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)

        raw_ids = request.data.get("tag_ids")
        if not isinstance(raw_ids, list):
            return Response({"error": "tag_ids must be a list."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            tag_ids = {uuid.UUID(str(tag_id)) for tag_id in raw_ids}
        except ValueError:
            return Response({"error": "tag_ids must contain valid ids."}, status=status.HTTP_400_BAD_REQUEST)

        # Only tags of this workspace can be attached
        valid_ids = set(WorkspaceTag.objects.filter(workspace__slug=slug, pk__in=tag_ids).values_list("pk", flat=True))
        if valid_ids != tag_ids:
            return Response({"error": "Some tags do not exist."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            current = IssueTag.objects.filter(issue_id=issue.id)
            current.exclude(tag_id__in=tag_ids).delete()
            existing = set(current.values_list("tag_id", flat=True))
            IssueTag.objects.bulk_create(
                [
                    IssueTag(
                        issue_id=issue.id,
                        tag_id=tag_id,
                        project_id=project_id,
                        workspace_id=issue.workspace_id,
                        created_by_id=request.user.id,
                        updated_by_id=request.user.id,
                    )
                    for tag_id in tag_ids - existing
                ],
                batch_size=10,
                ignore_conflicts=True,
            )

        return Response(self.serialize_tags(slug, project_id, issue_id), status=status.HTTP_200_OK)
