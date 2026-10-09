# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from ..base import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import WorkspaceTagSerializer
from plane.db.models import IssueTag, Workspace, WorkspaceTag


class WorkspaceTagEndpoint(BaseAPIView):
    """Tags are managed by workspace admins and can be used by every work item of the workspace."""

    def get_queryset(self, slug):
        return WorkspaceTag.objects.filter(workspace__slug=slug).select_related("image_asset").order_by("name")

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        serializer = WorkspaceTagSerializer(self.get_queryset(slug), many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        serializer = WorkspaceTagSerializer(data=request.data, context={"slug": slug})
        if serializer.is_valid():
            serializer.save(workspace=workspace)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, pk):
        tag = self.get_queryset(slug).filter(pk=pk).first()
        if tag is None:
            return Response({"error": "Tag not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = WorkspaceTagSerializer(tag, data=request.data, partial=True, context={"slug": slug})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, pk):
        tag = self.get_queryset(slug).filter(pk=pk).first()
        if tag is None:
            return Response({"error": "Tag not found."}, status=status.HTTP_404_NOT_FOUND)
        # Detach the tag from work items right away instead of waiting for the background cascade.
        IssueTag.objects.filter(tag=tag).delete()
        if tag.image_asset is not None:
            tag.image_asset.is_deleted = True
            tag.image_asset.deleted_at = timezone.now()
            tag.image_asset.save(update_fields=["is_deleted", "deleted_at"])
        tag.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
