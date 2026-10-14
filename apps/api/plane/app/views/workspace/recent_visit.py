# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

from django.db.models import Q
from plane.db.models import UserRecentVisit, Issue, ProjectPage
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
        allowed_ids = projects_for_user(request.user, slug).values("pk")
        user_recent_visits = UserRecentVisit.objects.filter(workspace__slug=slug, user=request.user).filter(
            Q(entity_name__iexact="project", entity_identifier__in=allowed_ids)
            | Q(
                entity_name__iexact="issue",
                entity_identifier__in=Issue.objects.filter(project_id__in=allowed_ids).values("pk"),
            )
            | Q(
                entity_name__iexact="page",
                entity_identifier__in=ProjectPage.objects.filter(project_id__in=allowed_ids).values("page_id"),
            )
        )

        entity_name = request.query_params.get("entity_name")

        if entity_name:
            user_recent_visits = user_recent_visits.filter(entity_name=entity_name)

        user_recent_visits = user_recent_visits.filter(entity_name__in=["issue", "page", "project"])

        serializer = WorkspaceRecentVisitSerializer(user_recent_visits[:20], many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)
