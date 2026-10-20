# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers, status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.utils.assigned_tasks import (
    MAX_CURRENT_TASKS,
    assigned_issues,
    mark_tasks_seen,
    task_payload,
)


class CurrentTasksEndpoint(BaseAPIView):
    """Work items assigned to the signed-in user (home page "current tasks").

    The list is sorted on the client according to the user's own settings; the work items that are new for the user
    carry ``is_new`` so that they can always be shown first.
    """

    use_read_replica = False

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        include_done = request.query_params.get("include_completed", "").lower() in ("1", "true", "yes")
        issues = assigned_issues(request.user, slug, include_done=include_done).order_by("-updated_at")[
            : MAX_CURRENT_TASKS + 1
        ]
        results = [task_payload(issue) for issue in issues]
        return Response(
            {
                "results": results[:MAX_CURRENT_TASKS],
                "has_more": len(results) > MAX_CURRENT_TASKS,
                "new_count": sum(1 for task in results[:MAX_CURRENT_TASKS] if task["is_new"]),
            },
            status=status.HTTP_200_OK,
        )


class CurrentTasksSeenEndpoint(BaseAPIView):
    """The assignee got acquainted with the work items: they stop being "new"."""

    use_read_replica = False

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug):
        issue_ids = request.data.get("issue_ids")
        if issue_ids is not None:
            issue_ids = serializers.ListField(child=serializers.UUIDField(), max_length=500).run_validation(issue_ids)
        updated = mark_tasks_seen(request.user, slug, issue_ids)
        return Response({"updated": updated}, status=status.HTTP_200_OK)
