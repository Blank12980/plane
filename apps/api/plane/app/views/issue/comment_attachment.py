# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import CommentAttachmentSerializer
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.db.models import FileAsset, IssueComment, Workspace
from plane.settings.storage import S3Storage


class CommentAttachmentV2Endpoint(BaseAPIView):
    """Files attached to an issue comment.

    The comment does not exist yet while a new comment is being composed, so the
    asset is created unbound and later linked to the comment through the bulk
    asset endpoint.
    """

    serializer_class = CommentAttachmentSerializer
    model = FileAsset

    @staticmethod
    def is_valid_uuid(value):
        try:
            uuid.UUID(str(value))
        except (ValueError, AttributeError, TypeError):
            return False
        return True

    def get_attachment(self, slug, project_id, pk):
        if not pk:
            return None
        return FileAsset.objects.filter(
            pk=pk,
            workspace__slug=slug,
            project_id=project_id,
            entity_type=FileAsset.EntityTypeContext.COMMENT_ATTACHMENT,
        ).first()

    def get_comment(self, slug, project_id, comment_id):
        return IssueComment.objects.filter(pk=comment_id, workspace__slug=slug, project_id=project_id).first()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, pk=None):
        name = request.data.get("name")
        type = request.data.get("type", False)
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        comment_id = request.data.get("comment_id")

        if not name:
            return Response(
                {"error": "Name is required.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not type or type not in settings.ATTACHMENT_MIME_TYPES:
            return Response(
                {"error": "Invalid file type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # The comment is optional, it is only present when a saved comment is edited
        if comment_id and not (self.is_valid_uuid(comment_id) and self.get_comment(slug, project_id, comment_id)):
            return Response(
                {"error": "Comment not found.", "status": False},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Get the size limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace_id=workspace.id,
            created_by=request.user,
            project_id=project_id,
            comment_id=comment_id if comment_id else None,
            entity_type=FileAsset.EntityTypeContext.COMMENT_ATTACHMENT,
        )

        # Get the presigned URL
        storage = S3Storage(request=request)

        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)

        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "attachment": CommentAttachmentSerializer(asset).data,
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, pk=None):
        asset = self.get_attachment(slug, project_id, pk)

        if not asset:
            return Response(
                {"error": "Comment attachment not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        asset.is_uploaded = True

        # Get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(str(asset.id))

        asset.attributes = request.data.get("attributes", asset.attributes)
        asset.save(update_fields=["is_uploaded", "attributes"])

        return Response(CommentAttachmentSerializer(asset).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN], creator=True, model=FileAsset)
    def delete(self, request, slug, project_id, pk=None):
        asset = self.get_attachment(slug, project_id, pk)

        if not asset:
            return Response(
                {"error": "Comment attachment not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])

        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, pk=None):
        # Download a single attachment
        if pk:
            asset = self.get_attachment(slug, project_id, pk)

            if not asset:
                return Response(
                    {"error": "Comment attachment not found."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            if not asset.is_uploaded:
                return Response(
                    {"error": "The asset is not uploaded.", "status": False},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            storage = S3Storage(request=request)
            presigned_url = storage.generate_presigned_url(
                object_name=asset.asset.name,
                disposition="attachment",
                filename=asset.attributes.get("name"),
            )
            return HttpResponseRedirect(presigned_url)

        # List every attachment of a comment
        comment_id = request.query_params.get("comment_id")
        if not comment_id or not self.is_valid_uuid(comment_id):
            return Response(
                {"error": "A valid comment_id is required.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attachments = FileAsset.objects.filter(
            comment_id=comment_id,
            workspace__slug=slug,
            project_id=project_id,
            entity_type=FileAsset.EntityTypeContext.COMMENT_ATTACHMENT,
            is_uploaded=True,
        ).select_related("workspace")
        return Response(
            CommentAttachmentSerializer(attachments, many=True).data,
            status=status.HTTP_200_OK,
        )
