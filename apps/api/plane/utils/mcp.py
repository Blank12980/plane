# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Instance wide policy of the MCP server (managed in God Mode) and the rules for tokens created by users."""

# Python imports
from datetime import timedelta

# Django imports
from django.core.cache import cache
from django.utils import timezone

# Third party imports
from rest_framework import serializers

# Module imports
from plane.api.rate_limit import is_valid_rate
from plane.db.models.api import API_TOKEN_SCOPES

MCP_POLICY_CACHE_KEY = "mcp:policy:v1"
MCP_POLICY_CACHE_SECONDS = 10
MCP_TOOL_HEADER = "X-Mcp-Tool"


def _policy_from_row(row):
    return {
        "enabled": row.enabled,
        "allow_user_tokens": row.allow_user_tokens,
        "allow_all_workspaces": row.allow_all_workspaces,
        "allow_oauth": row.allow_oauth,
        # keep the canonical order and ignore anything that is not a known scope any more
        "allowed_scopes": [scope for scope in API_TOKEN_SCOPES if scope in (row.allowed_scopes or [])],
        "max_token_days": row.max_token_days,
        "default_rate_limit": row.default_rate_limit,
    }


def get_mcp_policy():
    """The current policy as a dict. Cached for a few seconds because every API-key request consults it."""
    from plane.license.models import McpSettings

    try:
        cached = cache.get(MCP_POLICY_CACHE_KEY)
    except Exception:
        cached = None
    if cached is not None:
        return cached
    policy = _policy_from_row(McpSettings.load())
    try:
        cache.set(MCP_POLICY_CACHE_KEY, policy, MCP_POLICY_CACHE_SECONDS)
    except Exception:
        pass
    return policy


def invalidate_mcp_policy():
    try:
        cache.delete(MCP_POLICY_CACHE_KEY)
    except Exception:
        pass


def is_mcp_request(request, api_token=None) -> bool:
    """The request comes from the MCP server (it marks every call with the tool name) or uses an MCP token."""
    return bool(request.headers.get(MCP_TOOL_HEADER)) or getattr(api_token, "source", None) in ("mcp", "oauth")


def token_payload(token):
    """Safe description of an API token (never contains the secret)."""
    now = timezone.now()
    expired = token.expired_at is not None and token.expired_at <= now
    return {
        "id": str(token.id),
        "label": token.label,
        "description": token.description,
        "user": {
            "id": str(token.user_id),
            "display_name": token.user.display_name,
            "email": token.user.email,
            "is_bot": token.user.is_bot,
        },
        "workspace": {"slug": token.workspace.slug, "name": token.workspace.name} if token.workspace_id else None,
        "scopes": token.scopes,
        "allowed_rate_limit": token.allowed_rate_limit,
        "last_used": token.last_used,
        "expired_at": token.expired_at,
        "created_at": token.created_at,
        "revoked": not token.is_active,
        "expired": expired,
        "is_active": token.is_active and not expired,
    }


class McpSettingsSerializer(serializers.Serializer):
    enabled = serializers.BooleanField(required=False)
    allow_user_tokens = serializers.BooleanField(required=False)
    allow_all_workspaces = serializers.BooleanField(required=False)
    allow_oauth = serializers.BooleanField(required=False)
    allowed_scopes = serializers.ListField(child=serializers.ChoiceField(choices=API_TOKEN_SCOPES), required=False)
    max_token_days = serializers.IntegerField(required=False, min_value=0, max_value=3650)
    default_rate_limit = serializers.CharField(required=False, max_length=32)

    def validate_allowed_scopes(self, value):
        scopes = [scope for scope in API_TOKEN_SCOPES if scope in value]
        if "read" not in scopes:
            # Nearly every tool resolves keys and names with read access first.
            raise serializers.ValidationError("The read scope is required.")
        return scopes

    def validate_default_rate_limit(self, value):
        if not is_valid_rate(value):
            raise serializers.ValidationError("Use a format like 60/min, 10/s or 1000/hour.")
        return value


class UserMcpTokenSerializer(serializers.Serializer):
    """A token a user creates for themselves in the profile settings, validated against the instance policy."""

    label = serializers.CharField(max_length=255)
    # Either one workspace, or ``all_workspaces``: one token for every workspace the user belongs to.
    workspace_slug = serializers.SlugField(required=False)
    all_workspaces = serializers.BooleanField(required=False, default=False)
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=API_TOKEN_SCOPES), allow_empty=False)
    expires_in_days = serializers.IntegerField(required=False, min_value=1, max_value=3650, allow_null=True)

    def validate_scopes(self, value):
        policy = self.context["policy"]
        denied = sorted(set(value) - set(policy["allowed_scopes"]))
        if denied:
            raise serializers.ValidationError(f"These scopes are not allowed on this instance: {', '.join(denied)}")
        return [scope for scope in API_TOKEN_SCOPES if scope in value]

    def validate(self, attrs):
        policy = self.context["policy"]
        if attrs.get("all_workspaces"):
            if attrs.get("workspace_slug"):
                raise serializers.ValidationError("Choose one workspace or all of them, not both.")
            if not policy["allow_all_workspaces"]:
                raise serializers.ValidationError(
                    {"all_workspaces": "The instance administrator does not allow tokens for all workspaces."}
                )
        elif not attrs.get("workspace_slug"):
            raise serializers.ValidationError({"workspace_slug": "Choose a workspace or all workspaces."})
        days = attrs.get("expires_in_days")
        max_days = policy["max_token_days"]
        if max_days:
            if days is None:
                days = max_days
            if days > max_days:
                raise serializers.ValidationError(
                    {"expires_in_days": f"The instance limits MCP tokens to {max_days} days."}
                )
        attrs["expired_at"] = timezone.now() + timedelta(days=days) if days else None
        attrs.pop("expires_in_days", None)
        return attrs
