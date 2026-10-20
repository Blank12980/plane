# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth 2.1 authorization server data for the MCP server (ChatGPT style connectors).

These are security records, not business data: they are plain models that are really deleted, not soft deleted.
"""

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.db import models
from django.utils import timezone


class OAuthClient(models.Model):
    """An application registered through Dynamic Client Registration (RFC 7591), e.g. a ChatGPT connector."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    client_id = models.CharField(max_length=64, unique=True)
    # SHA-256 of the secret. Empty for public clients (token_endpoint_auth_method == "none") that rely on PKCE.
    client_secret_hash = models.CharField(max_length=64, blank=True, default="")
    client_name = models.CharField(max_length=100)
    client_uri = models.CharField(max_length=500, blank=True, default="")
    redirect_uris = models.JSONField(default=list)
    token_endpoint_auth_method = models.CharField(max_length=32, default="none")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "oauth_clients"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.client_name} ({self.client_id})"


class OAuthAuthorizationRequest(models.Model):
    """A validated authorization request waiting for the signed-in user to approve it on the consent screen.

    Kept on the server so the login redirect only has to carry a short, harmless id.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request_id = models.CharField(max_length=64, unique=True)
    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE, related_name="authorization_requests")
    redirect_uri = models.CharField(max_length=500)
    code_challenge = models.CharField(max_length=128)
    state = models.CharField(max_length=1000, blank=True, default="")
    requested_scopes = models.JSONField(default=list)
    resource = models.CharField(max_length=500, blank=True, default="")
    expires_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "oauth_authorization_requests"


class OAuthAuthorizationCode(models.Model):
    """A one-time authorization code that the client exchanges for tokens. Only its hash is stored."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code_hash = models.CharField(max_length=64, unique=True)
    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE, related_name="authorization_codes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    # None: the connection works in every workspace of the user
    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, null=True, blank=True, related_name="+")
    scopes = models.JSONField(default=list)
    redirect_uri = models.CharField(max_length=500)
    code_challenge = models.CharField(max_length=128)
    resource = models.CharField(max_length=500, blank=True, default="")
    expires_at = models.DateTimeField(db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    # The connection created from this code. If the code is presented again, that connection is revoked.
    connection = models.ForeignKey(
        "db.OAuthConnection", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "oauth_authorization_codes"


class OAuthConnection(models.Model):
    """What a user allowed an application to do. One active connection per user and application.

    The short-lived access token is a regular ``APIToken`` (source ``oauth``), so every API rule (scopes, workspace
    binding, rate limits, the MCP switch in God Mode) applies to it without any special code.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="oauth_connections")
    client = models.ForeignKey(OAuthClient, on_delete=models.CASCADE, related_name="connections")
    workspace = models.ForeignKey(
        "db.Workspace", on_delete=models.CASCADE, null=True, blank=True, related_name="oauth_connections"
    )
    scopes = models.JSONField(default=list)
    resource = models.CharField(max_length=500, blank=True, default="")
    access_token = models.OneToOneField(
        "db.APIToken", on_delete=models.SET_NULL, null=True, blank=True, related_name="oauth_connection"
    )
    refresh_token_hash = models.CharField(max_length=64, unique=True)
    # The refresh token that was used last. Presenting it again later means it leaked: the connection is revoked.
    previous_refresh_token_hash = models.CharField(max_length=64, blank=True, default="", db_index=True)
    rotated_at = models.DateTimeField(null=True, blank=True)
    refresh_expires_at = models.DateTimeField()
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "oauth_connections"
        ordering = ("-created_at",)

    @property
    def is_active(self):
        return self.revoked_at is None and self.refresh_expires_at > timezone.now()
