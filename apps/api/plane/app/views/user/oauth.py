# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""The consent screen of the OAuth authorization server of the MCP server and the user's own connections."""

# Django imports
from django.core import signing
from django.shortcuts import get_object_or_404
from django.utils import timezone

# Third party imports
from rest_framework import serializers, status
from rest_framework.response import Response

# Module imports
from plane.app.views.base import BaseAPIView
from plane.app.views.user.mcp import connectable_workspaces
from plane.db.models import OAuthAuthorizationRequest
from plane.db.models.api import API_TOKEN_SCOPES
from plane.utils import oauth
from plane.utils.mcp import get_mcp_policy

CONSENT_SALT = "gizmo.oauth.consent"


def consent_token(user, request_id: str) -> str:
    """Proves that the approval comes from the screen this very user was shown, not from a forged cross-site POST."""
    return signing.dumps({"u": str(user.id), "r": request_id}, salt=CONSENT_SALT)


def valid_consent_token(user, request_id: str, value) -> bool:
    try:
        data = signing.loads(value or "", salt=CONSENT_SALT, max_age=oauth.AUTHORIZATION_REQUEST_SECONDS)
    except signing.BadSignature:
        return False
    return data == {"u": str(user.id), "r": request_id}


class ConsentDecisionSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=["approve", "deny"])
    consent_token = serializers.CharField()
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=API_TOKEN_SCOPES), required=False)
    all_workspaces = serializers.BooleanField(required=False, default=False)
    workspace_slug = serializers.SlugField(required=False, allow_blank=True)


class OAuthConsentEndpoint(BaseAPIView):
    """What the application asks for (GET) and the user's decision (POST). Requires the signed-in session."""

    def get_request_or_error(self, request_id):
        auth_request = OAuthAuthorizationRequest.objects.select_related("client").filter(request_id=request_id).first()
        if auth_request is None or auth_request.expires_at <= timezone.now():
            return None, Response(
                {"error": "This connection request has expired. Start the connection again in the application."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return auth_request, None

    @staticmethod
    def disabled_response(policy):
        if oauth.oauth_enabled(policy):
            return None
        return Response(
            {"error": "Connecting applications through OAuth is switched off by the instance administrator."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def get(self, request, request_id):
        policy = get_mcp_policy()
        if (disabled := self.disabled_response(policy)) is not None:
            return disabled
        auth_request, error = self.get_request_or_error(request_id)
        if error is not None:
            return error
        client = auth_request.client
        response = Response(
            {
                "client": {
                    "name": client.client_name,
                    "uri": client.client_uri,
                    "redirect_uri": auth_request.redirect_uri,
                    "redirect_host": oauth.redirect_host(auth_request.redirect_uri),
                },
                "user": {"display_name": request.user.display_name, "email": request.user.email},
                "scopes": {
                    "requested": auth_request.requested_scopes,
                    "allowed": policy["allowed_scopes"],
                    "default": oauth.default_scopes(auth_request.requested_scopes, policy),
                },
                "workspaces": [{"slug": w.slug, "name": w.name} for w in connectable_workspaces(request.user)],
                "allow_all_workspaces": policy["allow_all_workspaces"],
                "access_days": policy["max_token_days"] or oauth.DEFAULT_REFRESH_DAYS,
                "consent_token": consent_token(request.user, request_id),
                "expires_at": auth_request.expires_at,
            },
            status=status.HTTP_200_OK,
        )
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request, request_id):
        policy = get_mcp_policy()
        if (disabled := self.disabled_response(policy)) is not None:
            return disabled
        auth_request, error = self.get_request_or_error(request_id)
        if error is not None:
            return error
        serializer = ConsentDecisionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not valid_consent_token(request.user, request_id, data["consent_token"]):
            return Response(
                {"error": "The confirmation is no longer valid. Reload the page and try again."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if data["decision"] == "deny":
            auth_request.delete()
            url = oauth.append_query(auth_request.redirect_uri, {"error": "access_denied", "state": auth_request.state})
            return Response({"redirect_url": url}, status=status.HTTP_200_OK)

        scopes = [scope for scope in API_TOKEN_SCOPES if scope in (data.get("scopes") or [])]
        denied = sorted(set(scopes) - set(policy["allowed_scopes"]))
        if denied:
            return Response(
                {"scopes": [f"These scopes are not allowed on this instance: {', '.join(denied)}"]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if "read" not in scopes:
            return Response({"scopes": ["The read scope is required."]}, status=status.HTTP_400_BAD_REQUEST)

        workspaces = connectable_workspaces(request.user)
        if data["all_workspaces"]:
            if data.get("workspace_slug"):
                return Response(
                    {"workspace_slug": ["Choose one workspace or all of them, not both."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not policy["allow_all_workspaces"]:
                return Response(
                    {"all_workspaces": ["The instance administrator does not allow access to all workspaces."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not workspaces.exists():
                return Response(
                    {"all_workspaces": ["You do not belong to any workspace."]}, status=status.HTTP_400_BAD_REQUEST
                )
            workspace = None
        else:
            workspace = workspaces.filter(slug=data.get("workspace_slug") or "").first()
            if workspace is None:
                return Response(
                    {"workspace_slug": ["Choose a workspace you belong to."]}, status=status.HTTP_400_BAD_REQUEST
                )

        code = oauth.create_authorization_code(auth_request, request.user, scopes, workspace)
        auth_request.delete()
        url = oauth.append_query(auth_request.redirect_uri, {"code": code, "state": auth_request.state})
        return Response({"redirect_url": url}, status=status.HTTP_200_OK)


class UserOAuthConnectionEndpoint(BaseAPIView):
    """Applications the signed-in user connected through OAuth: the user can disconnect them."""

    def delete(self, request, pk):
        connection = get_object_or_404(oauth.active_connections(), pk=pk, user=request.user)
        oauth.revoke_connection(connection)
        return Response(status=status.HTTP_204_NO_CONTENT)
