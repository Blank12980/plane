# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os

# Django imports
from django.conf import settings
from django.shortcuts import get_object_or_404

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.db.models import APIToken, Workspace, WorkspaceMember
from plane.utils.mcp import UserMcpTokenSerializer, get_mcp_policy, token_payload

MAX_USER_MCP_TOKENS = 20


def public_endpoint():
    base = (settings.APP_BASE_URL or os.environ.get("APP_BASE_URL") or "").rstrip("/")
    return f"{base}/mcp" if base else "/mcp"


def connectable_workspaces(user):
    """Workspaces where the user can work with the API: everything except the read-through Client role."""
    memberships = WorkspaceMember.objects.filter(member=user, is_active=True, role__gt=3).values("workspace_id")
    return Workspace.objects.filter(pk__in=memberships, deleted_at__isnull=True).order_by("name")


def own_mcp_tokens(user):
    return APIToken.objects.filter(user=user, source="mcp").select_related("user", "workspace").order_by("-created_at")


class UserMcpEndpoint(BaseAPIView):
    """Everything the profile settings need to connect an AI agent to Gizmo on behalf of the signed-in user."""

    def get(self, request):
        policy = get_mcp_policy()
        return Response(
            {
                "enabled": policy["enabled"],
                "allow_user_tokens": policy["allow_user_tokens"],
                "endpoint": public_endpoint(),
                "policy": {
                    "allowed_scopes": policy["allowed_scopes"],
                    "max_token_days": policy["max_token_days"],
                    "default_rate_limit": policy["default_rate_limit"],
                },
                "workspaces": [{"slug": w.slug, "name": w.name} for w in connectable_workspaces(request.user)],
                "tokens": [token_payload(token) for token in own_mcp_tokens(request.user)],
            },
            status=status.HTTP_200_OK,
        )


class UserMcpTokenEndpoint(BaseAPIView):
    def post(self, request):
        policy = get_mcp_policy()
        if not policy["enabled"]:
            return Response(
                {"error": "MCP is switched off by the instance administrator."}, status=status.HTTP_403_FORBIDDEN
            )
        if not policy["allow_user_tokens"]:
            return Response(
                {"error": "The instance administrator does not allow creating MCP tokens in the profile."},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = UserMcpTokenSerializer(data=request.data, context={"policy": policy})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        workspace = connectable_workspaces(request.user).filter(slug=data["workspace_slug"]).first()
        if workspace is None:
            return Response(
                {"workspace_slug": ["You are not a member of this workspace."]}, status=status.HTTP_400_BAD_REQUEST
            )
        if own_mcp_tokens(request.user).count() >= MAX_USER_MCP_TOKENS:
            return Response(
                {"error": f"You can have at most {MAX_USER_MCP_TOKENS} MCP tokens. Delete the ones you do not use."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token = APIToken.objects.create(
            user=request.user,
            user_type=1 if request.user.is_bot else 0,
            label=data["label"].strip() or "MCP",
            description="Created in the profile settings for an MCP client",
            workspace=workspace,
            scopes=data["scopes"],
            expired_at=data["expired_at"],
            # the user cannot choose the limit, the instance policy does
            allowed_rate_limit=policy["default_rate_limit"],
            source="mcp",
        )
        # The secret is shown exactly once, right now.
        return Response({**token_payload(token), "token": token.token}, status=status.HTTP_201_CREATED)

    def delete(self, request, pk):
        token = get_object_or_404(APIToken, pk=pk, user=request.user, source="mcp")
        token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
