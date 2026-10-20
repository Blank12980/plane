# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from django.db.models import Exists, OuterRef, Q
from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueComment,
    IssueSubscriber,
    ProjectMember,
    ProjectPage,
    UserRecentVisit,
)
from plane.app.serializers import WorkspaceRecentVisitSerializer

# Modules imports
from ..base import BaseViewSet
from plane.app.permissions import allow_permission, ROLE


from plane.utils.project_access import projects_for_user


class UserRecentVisitViewSet(BaseViewSet):
    model = UserRecentVisit
    use_read_replica = True

    def get_serializer_class(self):
        return WorkspaceRecentVisitSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def list(self, request, slug):
        user = request.user
        allowed_ids = projects_for_user(user, slug).values("pk")
        # "Recent" shows only what the user takes part in, not everything they happened to open:
        # projects they are a member of, work items they created, are assigned to, follow or commented on,
        # and pages they own or created.
        member_project_ids = ProjectMember.objects.filter(
            workspace__slug=slug, member=user, is_active=True, is_instance_admin_access=False
        ).values("project_id")
        participating_issue_ids = (
            Issue.objects.filter(project_id__in=allowed_ids)
            .filter(
                Q(created_by=user)
                | Exists(IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee=user))
                | Exists(IssueSubscriber.objects.filter(issue_id=OuterRef("pk"), subscriber=user))
                | Exists(IssueComment.objects.filter(issue_id=OuterRef("pk"), actor=user))
            )
            .values("pk")
        )
        participating_page_ids = (
            ProjectPage.objects.filter(project_id__in=allowed_ids)
            .filter(Q(page__owned_by=user) | Q(page__created_by=user))
            .values("page_id")
        )
        user_recent_visits = (
            UserRecentVisit.objects.filter(workspace__slug=slug, user=user)
            .filter(
                Q(entity_name__iexact="project", entity_identifier__in=member_project_ids)
                | Q(entity_name__iexact="issue", entity_identifier__in=participating_issue_ids)
                | Q(entity_name__iexact="page", entity_identifier__in=participating_page_ids)
            )
            .order_by("-visited_at")
        )

        entity_name = request.query_params.get("entity_name")

        if entity_name:
            user_recent_visits = user_recent_visits.filter(entity_name=entity_name)

        user_recent_visits = user_recent_visits.filter(entity_name__in=["issue", "page", "project"])

        serializer = WorkspaceRecentVisitSerializer(user_recent_visits[:20], many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
