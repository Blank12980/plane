# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""URLs of the OAuth authorization server of the MCP server.

``urlpatterns`` live under ``/auth/oauth/``; ``well_known_urlpatterns`` are the discovery documents that MCP clients
such as ChatGPT fetch from the root of the host (RFC 8414 and RFC 9728).
"""

from django.urls import path, re_path

from plane.authentication.oauth_server import (
    AuthorizeView,
    RegisterView,
    RevokeView,
    TokenView,
    authorization_server_metadata,
    protected_resource_metadata,
)

urlpatterns = [
    path("authorize/", AuthorizeView.as_view(), name="oauth-authorize"),
    path("token/", TokenView.as_view(), name="oauth-token"),
    path("register/", RegisterView.as_view(), name="oauth-register"),
    path("revoke/", RevokeView.as_view(), name="oauth-revoke"),
]

well_known_urlpatterns = [
    # Clients may append the path of the resource or of the issuer, so both documents answer for any suffix.
    re_path(
        r"^\.well-known/oauth-authorization-server(?:/(?P<suffix>.*))?$",
        authorization_server_metadata,
        name="oauth-authorization-server-metadata",
    ),
    re_path(
        r"^\.well-known/oauth-protected-resource(?:/(?P<suffix>.*))?$",
        protected_resource_metadata,
        name="oauth-protected-resource-metadata",
    ),
]
