# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import OpenApiResponse

# Module imports
from plane.api.serializers import UserLiteSerializer
from plane.api.views.base import BaseAPIView
from plane.db.models import User, Workspace, WorkspaceMember
from plane.utils.openapi.decorators import user_docs
from plane.utils.openapi import USER_EXAMPLE


class UserEndpoint(BaseAPIView):
    serializer_class = UserLiteSerializer
    model = User

    @user_docs(
        operation_id="get_current_user",
        summary="Get current user",
        description="Retrieve the authenticated user's profile information including basic details.",
        responses={
            200: OpenApiResponse(
                description="Current user profile",
                response=UserLiteSerializer,
                examples=[USER_EXAMPLE],
            ),
        },
    )
    def get(self, request):
        """Get current user

        Retrieve the authenticated user's profile information including basic details.
        Returns user data based on the current authentication context.
        """
        serializer = UserLiteSerializer(request.user)
        return Response(serializer.data, status=status.HTTP_200_OK)


def token_workspaces(request):
    """Workspaces the token can work in: its own workspace, or every workspace of the user for an unbound token."""
    memberships = WorkspaceMember.objects.filter(member=request.user, is_active=True, role__gt=3)
    workspaces = Workspace.objects.filter(pk__in=memberships.values("workspace_id"), deleted_at__isnull=True)
    api_token = getattr(request, "api_token", None)
    if api_token is not None and api_token.workspace_id:
        workspaces = workspaces.filter(pk=api_token.workspace_id)
    return workspaces.order_by("name")


class UserWorkspacesEndpoint(BaseAPIView):
    model = Workspace

    def get(self, request):
        return Response(
            [{"slug": workspace.slug, "name": workspace.name} for workspace in token_workspaces(request)],
            status=status.HTTP_200_OK,
        )


class UserTokenEndpoint(BaseAPIView):
    """What the MCP server needs to know about a token before serving a request: is it valid, where does it work.

    A bad token is rejected with 401 by authentication already. This call is not rate limited: it is the MCP
    server's own check and must not eat the budget of the token.
    """

    model = User

    def get_throttles(self):
        return []

    def get(self, request):
        api_token = getattr(request, "api_token", None)
        workspaces = list(token_workspaces(request))
        return Response(
            {
                "active": True,
                "source": getattr(api_token, "source", None),
                "scopes": list(getattr(api_token, "scopes", None) or []),
                "workspace": api_token.workspace.slug if api_token is not None and api_token.workspace_id else None,
                "workspaces": [workspace.slug for workspace in workspaces],
                "expires_at": getattr(api_token, "expired_at", None),
            },
            status=status.HTTP_200_OK,
        )
