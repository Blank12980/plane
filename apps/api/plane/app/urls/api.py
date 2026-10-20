# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path
from plane.app.views import ApiTokenEndpoint
from plane.app.views.user.mcp import UserMcpEndpoint, UserMcpTokenEndpoint

urlpatterns = [
    # API Tokens
    path(
        "users/api-tokens/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens",
    ),
    path(
        "users/api-tokens/<uuid:pk>/",
        ApiTokenEndpoint.as_view(),
        name="api-tokens-details",
    ),
    ## End API Tokens
    # MCP: connect an AI agent on behalf of the signed-in user
    path("users/me/mcp/", UserMcpEndpoint.as_view(), name="user-mcp"),
    path("users/me/mcp/tokens/", UserMcpTokenEndpoint.as_view(), name="user-mcp-tokens"),
    path("users/me/mcp/tokens/<uuid:pk>/", UserMcpTokenEndpoint.as_view(), name="user-mcp-token-detail"),
]
