# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Protocol endpoints of the OAuth 2.1 authorization server of the MCP server (see plane.utils.oauth)."""

# Python imports
import json
from datetime import timedelta
from functools import wraps
from urllib.parse import urlencode

# Django imports
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

# Module imports
from plane.db.models import OAuthAuthorizationCode, OAuthConnection
from plane.utils import oauth
from plane.utils.mcp import get_mcp_policy
from plane.utils.oauth import AuthorizeError, OAuthError

NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def with_cors(view):
    """These endpoints are public and called by other origins (browser based MCP clients); no cookies are involved."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        if request.method == "OPTIONS":
            response = HttpResponse(status=204)
        else:
            response = view(request, *args, **kwargs)
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response["Access-Control-Allow-Headers"] = "Content-Type, Authorization, MCP-Protocol-Version"
        response["Access-Control-Max-Age"] = "600"
        return response

    return wrapper


def json_error(error: OAuthError):
    response = JsonResponse(error.payload(), status=error.status)
    for key, value in NO_STORE.items():
        response[key] = value
    if error.status == 401:
        response["WWW-Authenticate"] = 'Basic realm="gizmo-oauth"'
    return response


def request_data(request) -> dict:
    """Token and registration requests are form encoded (RFC 6749) but JSON is accepted as well."""
    if (request.content_type or "").startswith("application/json"):
        try:
            data = json.loads(request.body or b"{}")
        except ValueError:
            raise OAuthError("invalid_request", "The body is not valid JSON.")
        if not isinstance(data, dict):
            raise OAuthError("invalid_request", "The body must be a JSON object.")
        return data
    return {key: value for key, value in request.POST.items()}


def policy_or_404():
    policy = get_mcp_policy()
    return policy if oauth.oauth_enabled(policy) else None


def disabled_response():
    return JsonResponse({"error": "OAuth is switched off by the instance administrator."}, status=404)


@with_cors
def authorization_server_metadata(request, suffix=""):
    policy = policy_or_404()
    if policy is None:
        return disabled_response()
    return JsonResponse(oauth.authorization_server_metadata(policy, request))


@with_cors
def protected_resource_metadata(request, suffix=""):
    policy = policy_or_404()
    if policy is None:
        return disabled_response()
    return JsonResponse(oauth.protected_resource_metadata(policy, request))


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(with_cors, name="dispatch")
class RegisterView(View):
    """Dynamic Client Registration (RFC 7591): applications such as ChatGPT register themselves."""

    http_method_names = ["post", "options"]

    def post(self, request):
        if policy_or_404() is None:
            return disabled_response()
        if oauth.rate_limited(request, "register", limit=20, window_seconds=3600):
            return json_error(OAuthError("temporarily_unavailable", "Too many registrations, retry later.", status=429))
        try:
            client, secret = oauth.register_client(request_data(request))
        except OAuthError as error:
            return json_error(error)
        oauth.purge_expired()
        body = {
            "client_id": client.client_id,
            "client_id_issued_at": int(client.created_at.timestamp()),
            "client_name": client.client_name,
            "redirect_uris": client.redirect_uris,
            "token_endpoint_auth_method": client.token_endpoint_auth_method,
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        }
        if secret:
            body["client_secret"] = secret
            body["client_secret_expires_at"] = 0
        response = JsonResponse(body, status=201)
        for key, value in NO_STORE.items():
            response[key] = value
        return response


def redirect(url: str) -> HttpResponse:
    # HttpResponseRedirect refuses the private-use schemes (cursor://, vscode://) that desktop apps register.
    response = HttpResponse(status=302)
    response["Location"] = url
    return response


class AuthorizeView(View):
    """Where the browser lands first: validate the request, then continue on the consent screen of the web app."""

    http_method_names = ["get", "head"]

    def get(self, request):
        base = oauth.public_base_url(request)
        consent = f"{base}{oauth.CONSENT_PATH}"

        def error_page(error, description):
            # the application cannot be trusted with the error yet, so the user reads it in the web app
            return redirect(f"{consent}?{urlencode({'error': error, 'error_description': description})}")

        policy = policy_or_404()
        if policy is None:
            return error_page("access_denied", "OAuth is switched off by the instance administrator.")
        if oauth.rate_limited(request, "authorize", limit=60):
            return error_page("temporarily_unavailable", "Too many requests, retry later.")
        try:
            auth_request = oauth.start_authorization(
                {key: value for key, value in request.GET.items()}, policy, request
            )
        except AuthorizeError as error:
            if error.redirect_uri:
                # the redirect URI is registered, so the application can be told
                return redirect(
                    oauth.append_query(
                        error.redirect_uri,
                        {"error": error.error, "error_description": error.description, "state": error.state},
                    )
                )
            return error_page(error.error, error.description)
        return redirect(f"{consent}?{urlencode({'request': auth_request.request_id})}")


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(with_cors, name="dispatch")
class TokenView(View):
    http_method_names = ["post", "options"]

    def post(self, request):
        policy = policy_or_404()
        if policy is None:
            return json_error(OAuthError("unauthorized_client", "OAuth is switched off by the instance administrator."))
        if oauth.rate_limited(request, "token", limit=120):
            return json_error(OAuthError("temporarily_unavailable", "Too many requests, retry later.", status=429))
        try:
            data = request_data(request)
            client = oauth.authenticate_client(request, data)
            grant_type = data.get("grant_type")
            if grant_type == "authorization_code":
                body = self.exchange_code(client, data, policy)
            elif grant_type == "refresh_token":
                body = self.refresh(client, data, policy)
            else:
                raise OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.")
        except OAuthError as error:
            return json_error(error)
        response = JsonResponse(body)
        for key, value in NO_STORE.items():
            response[key] = value
        return response

    def exchange_code(self, client, data, policy):
        with transaction.atomic():
            result = self._exchange_code(client, data, policy)
        # Errors that must keep what was written (a revoked connection) are returned, not raised: raising inside the
        # transaction would roll the revocation back.
        if isinstance(result, OAuthError):
            raise result
        return result

    def _exchange_code(self, client, data, policy):
        code_value = data.get("code")
        if not code_value or not isinstance(code_value, str):
            raise OAuthError("invalid_request", "code is required.")
        code = (
            OAuthAuthorizationCode.objects.select_for_update(of=("self",))
            .select_related("user", "workspace", "connection")
            .filter(code_hash=oauth.hash_value(code_value), client=client)
            .first()
        )
        if code is None:
            raise OAuthError("invalid_grant", "The authorization code is invalid.")
        if code.used_at is not None:
            # A code is single use. Seeing it again means somebody else got hold of it: close what it opened.
            if code.connection is not None:
                oauth.revoke_connection(code.connection)
            return OAuthError("invalid_grant", "The authorization code was already used.")
        if code.expires_at <= timezone.now():
            raise OAuthError("invalid_grant", "The authorization code has expired.")
        redirect_uri = data.get("redirect_uri")
        if redirect_uri and redirect_uri != code.redirect_uri:
            raise OAuthError("invalid_grant", "redirect_uri does not match the authorization request.")
        if not oauth.pkce_matches(data.get("code_verifier") or "", code.code_challenge):
            raise OAuthError("invalid_grant", "The PKCE code_verifier does not match the code_challenge.")
        resource = oauth.normalize_resource(data.get("resource") or "")
        if resource and code.resource and resource != code.resource:
            raise OAuthError("invalid_target", "resource does not match the authorization request.")
        if not code.user.is_active:
            raise OAuthError("invalid_grant", "The user is not active.")

        # One connection per user and application: connecting again replaces the previous one.
        for previous in OAuthConnection.objects.filter(user=code.user, client=client, revoked_at__isnull=True):
            oauth.revoke_connection(previous)
        connection = OAuthConnection.objects.create(
            user=code.user,
            client=client,
            workspace=code.workspace,
            scopes=code.scopes,
            resource=code.resource,
            # unique placeholders until issue_tokens() stores the real refresh token
            refresh_token_hash=oauth.hash_value(oauth.random_value()),
            refresh_expires_at=timezone.now() + oauth.refresh_lifetime(policy),
        )
        body = oauth.issue_tokens(connection, policy, first=True)
        code.used_at = timezone.now()
        code.connection = connection
        code.save(update_fields=["used_at", "connection"])
        return body

    def refresh(self, client, data, policy):
        with transaction.atomic():
            result = self._refresh(client, data, policy)
        if isinstance(result, OAuthError):
            raise result
        return result

    def _refresh(self, client, data, policy):
        value = data.get("refresh_token")
        if not value or not isinstance(value, str):
            raise OAuthError("invalid_request", "refresh_token is required.")
        digest = oauth.hash_value(value)
        connection = (
            OAuthConnection.objects.select_for_update(of=("self",))
            .select_related("user", "client", "workspace", "access_token")
            .filter(client=client)
            .filter(refresh_token_hash=digest)
            .first()
        )
        if connection is None:
            stale = (
                OAuthConnection.objects.select_for_update(of=("self",))
                .select_related("access_token")
                .filter(client=client, previous_refresh_token_hash=digest)
                .first()
            )
            if stale is not None:
                grace = timedelta(seconds=oauth.REFRESH_REUSE_GRACE_SECONDS)
                if stale.rotated_at is None or timezone.now() - stale.rotated_at > grace:
                    # An old refresh token is used again after the new one was already in use: it leaked.
                    oauth.revoke_connection(stale)
            return OAuthError("invalid_grant", "The refresh token is invalid or was already used.")
        if connection.revoked_at is not None or connection.refresh_expires_at <= timezone.now():
            raise OAuthError("invalid_grant", "The connection was revoked or has expired. Connect again.")
        if not connection.user.is_active:
            raise OAuthError("invalid_grant", "The user is not active.")
        return oauth.issue_tokens(connection, policy)


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(with_cors, name="dispatch")
class RevokeView(View):
    """RFC 7009: the application can close its own connection. Always answers 200, like the RFC asks."""

    http_method_names = ["post", "options"]

    def post(self, request):
        try:
            data = request_data(request)
            client = oauth.authenticate_client(request, data)
        except OAuthError as error:
            return json_error(error)
        value = data.get("token")
        if value and isinstance(value, str):
            connection = (
                OAuthConnection.objects.select_related("access_token")
                .filter(client=client, revoked_at__isnull=True)
                .filter(refresh_token_hash=oauth.hash_value(value))
                .first()
                or OAuthConnection.objects.select_related("access_token")
                .filter(client=client, revoked_at__isnull=True, access_token__token=value)
                .first()
            )
            if connection is not None:
                oauth.revoke_connection(connection)
        response = HttpResponse(status=200)
        for key, headers in NO_STORE.items():
            response[key] = headers
        return response
