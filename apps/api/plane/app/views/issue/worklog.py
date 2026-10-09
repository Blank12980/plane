# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .. import BaseAPIView
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import IssueWorkLogSerializer
from plane.db.models import Issue, IssueWorkLog, ProjectMember, WorkspaceMember


class IssueWorkLogEndpoint(BaseAPIView):
    """Time spent on a work item. Members log their own time, admins can correct anyone's."""

    def get_queryset(self, slug, project_id, issue_id):
        return IssueWorkLog.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            issue_id=issue_id,
        ).select_related("logged_by")

    def get_issue(self, slug, project_id, issue_id):
        return Issue.issue_objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    def can_manage(self, request, slug, project_id, worklog):
        if worklog.logged_by_id == request.user.id:
            return True
        is_project_admin = ProjectMember.objects.filter(
            member=request.user,
            project_id=project_id,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        is_workspace_admin = WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        return is_project_admin or is_workspace_admin

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, issue_id):
        worklogs = self.get_queryset(slug, project_id, issue_id)
        return Response(IssueWorkLogSerializer(worklogs, many=True).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        issue = self.get_issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = IssueWorkLogSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(issue=issue, project_id=project_id, logged_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id, pk):
        worklog = self.get_queryset(slug, project_id, issue_id).filter(pk=pk).first()
        if worklog is None:
            return Response({"error": "Work log not found."}, status=status.HTTP_404_NOT_FOUND)
        if not self.can_manage(request, slug, project_id, worklog):
            return Response(
                {"error": "You can only change your own work logs."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = IssueWorkLogSerializer(worklog, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, issue_id, pk):
        worklog = self.get_queryset(slug, project_id, issue_id).filter(pk=pk).first()
        if worklog is None:
            return Response({"error": "Work log not found."}, status=status.HTTP_404_NOT_FOUND)
        if not self.can_manage(request, slug, project_id, worklog):
            return Response(
                {"error": "You can only delete your own work logs."},
                status=status.HTTP_403_FORBIDDEN,
            )
        worklog.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
