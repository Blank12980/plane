# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party modules
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.serializers import LabelSerializer
from plane.app.views.base import BaseAPIView
from plane.db.models import Label
from plane.app.permissions import WorkspaceViewerPermission


from plane.utils.project_access import projects_for_user


class WorkspaceLabelsEndpoint(BaseAPIView):
    permission_classes = [WorkspaceViewerPermission]
    use_read_replica = True

    def get(self, request, slug):
        labels = Label.objects.filter(
            workspace__slug=slug,
            project_id__in=projects_for_user(request.user, self.kwargs.get("slug")).values("pk"),
            project__archived_at__isnull=True,
        )
        serializer = LabelSerializer(labels, many=True).data
        return Response(serializer, status=status.HTTP_200_OK)
