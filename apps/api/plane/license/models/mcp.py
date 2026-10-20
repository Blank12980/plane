# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from plane.db.models.api import API_TOKEN_SCOPES

# Scopes users may grant to an MCP token unless the instance administrator narrows the list. Deleting work items stays
# off by default: it is only for tokens an administrator creates deliberately.
DEFAULT_MCP_ALLOWED_SCOPES = [scope for scope in API_TOKEN_SCOPES if scope != "issues:delete"]


def default_mcp_allowed_scopes():
    return list(DEFAULT_MCP_ALLOWED_SCOPES)


class McpSettings(models.Model):
    """Instance wide policy of the MCP server (a single row, edited in God Mode)."""

    SINGLETON_PK = 1

    # Master switch: when off the API rejects every request that comes from an MCP token or the MCP server.
    enabled = models.BooleanField(default=True)
    # Whether regular users may create MCP tokens for themselves in their profile settings.
    allow_user_tokens = models.BooleanField(default=True)
    # Whether a user may create one token that works in every workspace they belong to.
    allow_all_workspaces = models.BooleanField(default=True)
    # Whether applications such as ChatGPT may connect through OAuth (the user approves them on a consent screen).
    allow_oauth = models.BooleanField(default=True)
    # Scopes a user may put on a token created in the profile settings.
    allowed_scopes = models.JSONField(default=default_mcp_allowed_scopes)
    # Longest lifetime of a token created in the profile settings, in days (0 = no limit).
    max_token_days = models.PositiveIntegerField(default=365)
    # Rate limit given to tokens created in the profile settings, e.g. 120/min.
    default_rate_limit = models.CharField(max_length=32, default="120/min")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )

    class Meta:
        verbose_name = "MCP settings"
        verbose_name_plural = "MCP settings"
        db_table = "mcp_settings"

    def save(self, *args, **kwargs):
        self.pk = self.SINGLETON_PK
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        instance, _ = cls.objects.get_or_create(pk=cls.SINGLETON_PK)
        return instance
