# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import (
    WorkspaceTagAPIEndpoint,
    WorkItemTagAPIEndpoint,
    WorkItemWorkLogAPIEndpoint,
    TimeReportAPIEndpoint,
)

urlpatterns = [
    path(
        "workspaces/<str:slug>/tags/",
        WorkspaceTagAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="workspace-tag-list",
    ),
    path(
        "workspaces/<str:slug>/tags/<uuid:pk>/",
        WorkspaceTagAPIEndpoint.as_view(http_method_names=["get", "patch", "delete"]),
        name="workspace-tag-detail",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/tags/",
        WorkItemTagAPIEndpoint.as_view(http_method_names=["get", "put"]),
        name="work-item-tags",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/worklogs/",
        WorkItemWorkLogAPIEndpoint.as_view(http_method_names=["get", "post"]),
        name="work-item-worklog-list",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/work-items/<uuid:issue_id>/worklogs/<uuid:pk>/",
        WorkItemWorkLogAPIEndpoint.as_view(http_method_names=["patch", "delete"]),
        name="work-item-worklog-detail",
    ),
    path(
        "workspaces/<str:slug>/time-report/",
        TimeReportAPIEndpoint.as_view(http_method_names=["get"]),
        name="time-report",
    ),
]
