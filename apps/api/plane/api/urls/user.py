# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views import UserEndpoint, UserTokenEndpoint, UserWorkspacesEndpoint

urlpatterns = [
    path(
        "users/me/",
        UserEndpoint.as_view(http_method_names=["get"]),
        name="users",
    ),
    path(
        "users/me/workspaces/",
        UserWorkspacesEndpoint.as_view(http_method_names=["get"]),
        name="user-workspaces",
    ),
    path(
        "users/me/token/",
        UserTokenEndpoint.as_view(http_method_names=["get"]),
        name="user-token",
    ),
]
