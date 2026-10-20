# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
import re
from collections import Counter
from datetime import timedelta
from urllib.parse import urljoin

# Django imports
from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

# Third party imports
import requests
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.db.models import APIActivityLog, APIToken
from plane.db.models.api import API_TOKEN_SCOPES
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.models import McpSettings
from plane.utils.mcp import (
    McpSettingsSerializer,
    get_mcp_policy,
    invalidate_mcp_policy,
    token_payload,
)

TOOL_PATTERN = re.compile(r"'X-Mcp-Tool':\s*'([^']{1,100})'", re.IGNORECASE)


def public_endpoint():
    base = (settings.APP_BASE_URL or os.environ.get("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/mcp" if base else "/mcp"


def mcp_health():
    """Ask the MCP container (reachable on the internal network) for its health."""
    url = urljoin(os.environ.get("MCP_INTERNAL_URL", "http://mcp:3000").rstrip("/") + "/", "mcp/health")
    try:
        response = requests.get(url, timeout=2)
        response.raise_for_status()
        data = response.json()
        return {"status": "ok", "version": data.get("version"), "name": data.get("name")}
    except Exception:
        return {"status": "unavailable", "version": None, "name": None}


def mcp_calls(since, limit=200):
    """Recent MCP calls from the API request log (only available when the log lives in PostgreSQL)."""
    logs = APIActivityLog.objects.filter(created_at__gte=since, headers__icontains="x-mcp-tool").order_by("-created_at")
    rows = []
    for log in logs[:limit]:
        match = TOOL_PATTERN.search(log.headers or "")
        rows.append(
            {
                "id": str(log.id),
                "tool": match.group(1) if match else None,
                "method": log.method,
                "path": log.path,
                "status": log.response_code,
                "created_at": log.created_at,
            }
        )
    return rows


class McpSettingsEndpoint(BaseAPIView):
    """Instance wide MCP policy, health and usage numbers for God Mode."""

    permission_classes = [InstanceAdminPermission]

    def payload(self):
        now = timezone.now()
        tokens = APIToken.objects.filter(source="mcp")
        not_expired = Q(expired_at__isnull=True) | Q(expired_at__gt=now)
        day_ago = now - timedelta(hours=24)
        recent = mcp_calls(day_ago)
        top_tools = Counter(row["tool"] for row in recent if row["tool"]).most_common(5)
        return {
            "settings": get_mcp_policy(),
            "available_scopes": list(API_TOKEN_SCOPES),
            "endpoint": public_endpoint(),
            "health": mcp_health(),
            "stats": {
                "tokens_total": tokens.count(),
                "tokens_active": tokens.filter(not_expired, is_active=True).count(),
                "tokens_used_24h": tokens.filter(last_used__gte=day_ago).count(),
                "calls_24h": len(recent),
                "calls_24h_truncated": len(recent) >= 200,
                "errors_24h": sum(1 for row in recent if row["status"] >= 400),
                "top_tools": [{"tool": tool, "calls": calls} for tool, calls in top_tools],
            },
        }

    def get(self, request):
        return Response(self.payload(), status=status.HTTP_200_OK)

    def patch(self, request):
        serializer = McpSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        row = McpSettings.load()
        for field, value in serializer.validated_data.items():
            setattr(row, field, value)
        row.updated_by = request.user
        row.save()
        invalidate_mcp_policy()
        return Response(self.payload(), status=status.HTTP_200_OK)


class McpTokensEndpoint(BaseAPIView):
    """Every MCP token of the instance. Administrators can revoke, restore and delete them."""

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        tokens = APIToken.objects.filter(source="mcp").select_related("user", "workspace").order_by("-created_at")[:500]
        return Response([token_payload(token) for token in tokens], status=status.HTTP_200_OK)

    def patch(self, request, pk):
        token = get_object_or_404(APIToken.objects.select_related("user", "workspace"), pk=pk, source="mcp")
        if "is_active" not in request.data or not isinstance(request.data["is_active"], bool):
            return Response({"error": "is_active (true/false) is required"}, status=status.HTTP_400_BAD_REQUEST)
        token.is_active = request.data["is_active"]
        token.save(update_fields=["is_active", "updated_at"])
        return Response(token_payload(token), status=status.HTTP_200_OK)

    def delete(self, request, pk):
        token = get_object_or_404(APIToken, pk=pk, source="mcp")
        token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class McpActivityEndpoint(BaseAPIView):
    """Recent MCP tool calls. Never exposes tokens: only the tool name, status and time."""

    permission_classes = [InstanceAdminPermission]

    def get(self, request):
        try:
            limit = max(1, min(int(request.query_params.get("limit", 50)), 200))
        except (TypeError, ValueError):
            limit = 50
        since = timezone.now() - timedelta(days=7)
        return Response(mcp_calls(since, limit), status=status.HTTP_200_OK)
