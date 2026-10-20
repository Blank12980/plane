# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Module imports
from ..base import BaseAPIView
from plane.db.models.workspace import WorkspaceHomePreference
from plane.app.permissions import allow_permission, ROLE
from plane.db.models import Workspace
from plane.app.serializers.workspace import WorkspaceHomePreferenceSerializer

# Third party imports
from rest_framework.response import Response
from rest_framework import status


# Higher comes first. "Current tasks" sits between the quick links and the recents.
DEFAULT_WIDGET_SORT_ORDER = {"quick_links": 999, "current_tasks": 998.5, "recents": 998, "my_stickies": 997}


class WorkspaceHomePreferenceViewSet(BaseAPIView):
    model = WorkspaceHomePreference

    def get_serializer_class(self):
        return WorkspaceHomePreferenceSerializer

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)

        get_preference = WorkspaceHomePreference.objects.filter(user=request.user, workspace_id=workspace.id)

        keys = [
            key
            for key, _ in WorkspaceHomePreference.HomeWidgetKeys.choices
            if key not in ["quick_tutorial", "new_at_plane"]
        ]
        existing = set(get_preference.values_list("key", flat=True))
        # Missing widgets (a new user, or a widget added in a later release) start in their default position.
        WorkspaceHomePreference.objects.bulk_create(
            [
                WorkspaceHomePreference(
                    key=key,
                    user=request.user,
                    workspace=workspace,
                    sort_order=DEFAULT_WIDGET_SORT_ORDER.get(key, 900),
                )
                for key in keys
                if key not in existing
            ],
            batch_size=10,
            ignore_conflicts=True,
        )

        preference = WorkspaceHomePreference.objects.filter(user=request.user, workspace_id=workspace.id)

        return Response(
            preference.values("key", "is_enabled", "config", "sort_order"),
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def patch(self, request, slug, key):
        preference = WorkspaceHomePreference.objects.filter(key=key, workspace__slug=slug, user=request.user).first()

        if preference:
            serializer = WorkspaceHomePreferenceSerializer(preference, data=request.data, partial=True)

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        return Response({"detail": "Preference not found"}, status=status.HTTP_400_BAD_REQUEST)
