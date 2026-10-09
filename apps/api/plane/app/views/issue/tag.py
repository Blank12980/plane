# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.db import transaction

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Issue, IssueTag, WorkspaceTag


class IssueTagEndpoint(BaseAPIView):
    """Reads and replaces the set of workspace tags attached to a work item."""

    def get_issue(self, slug, project_id, issue_id):
        return Issue.issue_objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    def get_tag_ids(self, slug, project_id, issue_id):
        return [
            str(tag_id)
            for tag_id in IssueTag.objects.filter(
                issue_id=issue_id,
                project_id=project_id,
                workspace__slug=slug,
                tag__deleted_at__isnull=True,
            ).values_list("tag_id", flat=True)
        ]

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        if self.get_issue(slug, project_id, issue_id) is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"tag_ids": self.get_tag_ids(slug, project_id, issue_id)}, status=status.HTTP_200_OK)

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

        return Response({"tag_ids": self.get_tag_ids(slug, project_id, issue_id)}, status=status.HTTP_200_OK)
