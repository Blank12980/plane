# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""OAuth 2.1 authorization server of the MCP server: the rules shared by the protocol endpoints and the consent API.

Applications such as ChatGPT discover the endpoints from ``/.well-known/oauth-protected-resource`` and
``/.well-known/oauth-authorization-server``, register themselves (RFC 7591), send the user to the consent screen
(authorization code + PKCE S256) and exchange the code for a short-lived access token and a rotating refresh token.
The access token is a regular ``APIToken``, so scopes, workspace binding, rate limits and the MCP policy of God Mode
apply to it exactly as they do to tokens created in the profile settings.
"""

# Python imports
import base64
import hashlib
import hmac
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlsplit, urlunsplit

# Django imports
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

# Module imports
from plane.db.models import APIToken, OAuthAuthorizationCode, OAuthAuthorizationRequest, OAuthClient, OAuthConnection
from plane.db.models.api import API_TOKEN_SCOPES, API_TOKEN_SOURCE_OAUTH
from plane.utils.ip_address import get_client_ip

ACCESS_TOKEN_SECONDS = 3600
AUTHORIZATION_CODE_SECONDS = 300
AUTHORIZATION_REQUEST_SECONDS = 900
# Longest lifetime of a refresh token when the instance policy sets no limit for MCP tokens.
DEFAULT_REFRESH_DAYS = 365
# A refresh token that was just replaced may still arrive once more (two parallel refreshes): that is not a leak.
REFRESH_REUSE_GRACE_SECONDS = 60
MAX_REDIRECT_URIS = 5
MAX_CLIENT_NAME = 100
MAX_CONNECTIONS_PER_USER = 30
# What an application gets when it does not ask for particular scopes.
DEFAULT_CONNECT_SCOPES = ("read", "issues:write", "comments:write", "worklogs:write")

MCP_RESOURCE_PATH = "/mcp"
AUTHORIZE_PATH = "/auth/oauth/authorize/"
TOKEN_PATH = "/auth/oauth/token/"
REGISTER_PATH = "/auth/oauth/register/"
REVOKE_PATH = "/auth/oauth/revoke/"
CONSENT_PATH = "/oauth/authorize"

ACCESS_TOKEN_PREFIX = "plane_oauth_"
REFRESH_TOKEN_PREFIX = "plane_rt_"

CODE_VERIFIER_RE = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
CODE_CHALLENGE_RE = re.compile(r"^[A-Za-z0-9\-_]{43}$")
CLIENT_AUTH_METHODS = ("none", "client_secret_post", "client_secret_basic")
FORBIDDEN_REDIRECT_SCHEMES = {"javascript", "data", "file", "vbscript", "blob", "about", "ftp", "ws", "wss"}
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1", "[::1]"}


class OAuthError(Exception):
    """An error in the format of RFC 6749 section 5.2."""

    def __init__(self, error, description="", status=400):
        super().__init__(description or error)
        self.error = error
        self.description = description
        self.status = status

    def payload(self):
        body = {"error": self.error}
        if self.description:
            body["error_description"] = self.description
        return body


def hash_value(value: str) -> str:
    """Codes, secrets and refresh tokens are long random values, so a plain SHA-256 is enough to store them."""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def random_value(prefix="", nbytes=32) -> str:
    return prefix + secrets.token_urlsafe(nbytes)


def oauth_enabled(policy) -> bool:
    return bool(policy["enabled"] and policy["allow_oauth"])


def public_base_url(request=None) -> str:
    """The public origin of this instance, without a trailing slash."""
    base = (getattr(settings, "APP_BASE_URL", None) or "").strip().rstrip("/")
    if base:
        return base
    if request is not None:
        return request.build_absolute_uri("/").rstrip("/")
    return ""


def resource_url(request=None) -> str:
    return f"{public_base_url(request)}{MCP_RESOURCE_PATH}"


def endpoints(request=None) -> dict:
    base = public_base_url(request)
    return {
        "issuer": base,
        "resource": f"{base}{MCP_RESOURCE_PATH}",
        "authorization_endpoint": f"{base}{AUTHORIZE_PATH}",
        "token_endpoint": f"{base}{TOKEN_PATH}",
        "registration_endpoint": f"{base}{REGISTER_PATH}",
        "revocation_endpoint": f"{base}{REVOKE_PATH}",
        "protected_resource_metadata": f"{base}/.well-known/oauth-protected-resource{MCP_RESOURCE_PATH}",
        "authorization_server_metadata": f"{base}/.well-known/oauth-authorization-server",
    }


def authorization_server_metadata(policy, request=None) -> dict:
    urls = endpoints(request)
    return {
        "issuer": urls["issuer"],
        "authorization_endpoint": urls["authorization_endpoint"],
        "token_endpoint": urls["token_endpoint"],
        "registration_endpoint": urls["registration_endpoint"],
        "revocation_endpoint": urls["revocation_endpoint"],
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "token_endpoint_auth_methods_supported": list(CLIENT_AUTH_METHODS),
        "revocation_endpoint_auth_methods_supported": list(CLIENT_AUTH_METHODS),
        "code_challenge_methods_supported": ["S256"],
        "scopes_supported": list(policy["allowed_scopes"]),
    }


def protected_resource_metadata(policy, request=None) -> dict:
    urls = endpoints(request)
    return {
        "resource": urls["resource"],
        "authorization_servers": [urls["issuer"]],
        "scopes_supported": list(policy["allowed_scopes"]),
        "bearer_methods_supported": ["header"],
        "resource_name": "Gizmo MCP",
    }


# --- Rate limiting of the unauthenticated endpoints --------------------------------------------------------------


def rate_limited(request, scope: str, limit: int, window_seconds: int = 60) -> bool:
    """A small fixed window counter per client address. Fails open when the cache is down."""
    key = f"oauth:rate:{scope}:{get_client_ip(request)}"
    try:
        added = cache.add(key, 1, window_seconds)
        if added:
            return False
        return cache.incr(key) > limit
    except Exception:
        return False


# --- Clients ----------------------------------------------------------------------------------------------------


def _is_loopback_http(parsed) -> bool:
    return parsed.scheme == "http" and (parsed.hostname or "") in LOOPBACK_HOSTS


def validate_redirect_uri(value) -> str:
    """HTTPS, loopback HTTP (native apps) and private-use schemes of desktop apps (cursor://, vscode://) are fine."""
    if not isinstance(value, str) or not value or len(value) > 500 or any(ch.isspace() for ch in value):
        raise OAuthError("invalid_redirect_uri", "Each redirect URI must be a string without spaces (max 500 chars).")
    parsed = urlsplit(value)
    if parsed.fragment:
        raise OAuthError("invalid_redirect_uri", "A redirect URI must not contain a fragment.")
    scheme = parsed.scheme.lower()
    if not scheme or scheme in FORBIDDEN_REDIRECT_SCHEMES:
        raise OAuthError("invalid_redirect_uri", f"Redirect URI scheme is not allowed: {parsed.scheme or '(none)'}.")
    if scheme in ("http", "https"):
        if not parsed.hostname or parsed.username or parsed.password:
            raise OAuthError("invalid_redirect_uri", "A redirect URI needs a host and no credentials.")
        if scheme == "http" and not _is_loopback_http(parsed):
            raise OAuthError("invalid_redirect_uri", "Plain http is only allowed for localhost redirect URIs.")
    return value


def clean_client_name(value) -> str:
    name = re.sub(r"[\x00-\x1f\x7f<>]", "", str(value or "")).strip()
    return name[:MAX_CLIENT_NAME] or "MCP client"


def register_client(data: dict) -> tuple[OAuthClient, str]:
    """Dynamic Client Registration (RFC 7591). Returns the client and its plain secret (empty for public clients)."""
    if not isinstance(data, dict):
        raise OAuthError("invalid_client_metadata", "The body must be a JSON object.")
    redirect_uris = data.get("redirect_uris")
    if not isinstance(redirect_uris, list) or not redirect_uris:
        raise OAuthError("invalid_redirect_uri", "redirect_uris is required.")
    if len(redirect_uris) > MAX_REDIRECT_URIS:
        raise OAuthError("invalid_redirect_uri", f"At most {MAX_REDIRECT_URIS} redirect URIs are allowed.")
    redirect_uris = list(dict.fromkeys(validate_redirect_uri(uri) for uri in redirect_uris))

    method = data.get("token_endpoint_auth_method") or "none"
    if method not in CLIENT_AUTH_METHODS:
        raise OAuthError("invalid_client_metadata", f"Unsupported token_endpoint_auth_method: {method}.")
    grant_types = data.get("grant_types") or ["authorization_code"]
    if not isinstance(grant_types, list) or not set(grant_types) <= {"authorization_code", "refresh_token"}:
        raise OAuthError(
            "invalid_client_metadata", "Only the authorization_code and refresh_token grants are supported."
        )
    response_types = data.get("response_types") or ["code"]
    if response_types != ["code"]:
        raise OAuthError("invalid_client_metadata", "Only the code response type is supported.")

    client_uri = data.get("client_uri") or ""
    if client_uri:
        parsed = urlparse(str(client_uri))
        if parsed.scheme not in ("http", "https") or not parsed.hostname or len(client_uri) > 500:
            client_uri = ""

    secret = ""
    if method != "none":
        secret = random_value(nbytes=32)
    client = OAuthClient.objects.create(
        client_id=random_value("gzo_", 24),
        client_secret_hash=hash_value(secret) if secret else "",
        client_name=clean_client_name(data.get("client_name")),
        client_uri=client_uri,
        redirect_uris=redirect_uris,
        token_endpoint_auth_method=method,
    )
    return client, secret


def authenticate_client(request, data) -> OAuthClient:
    """Identify the application at the token and revocation endpoints (``none``, ``client_secret_post`` or Basic)."""
    client_id = data.get("client_id")
    secret = data.get("client_secret")
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if header.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(header[6:].strip()).decode("utf-8")
            basic_id, _, basic_secret = decoded.partition(":")
            client_id, secret = unquote(basic_id), unquote(basic_secret)
        except Exception:
            raise OAuthError("invalid_client", "Malformed Basic authorization header.", status=401)
    if not client_id or not isinstance(client_id, str):
        raise OAuthError("invalid_client", "client_id is required.", status=401)
    client = OAuthClient.objects.filter(client_id=client_id).first()
    if client is None:
        raise OAuthError("invalid_client", "Unknown client.", status=401)
    if client.token_endpoint_auth_method != "none":
        if not secret or not hmac.compare_digest(hash_value(str(secret)), client.client_secret_hash):
            raise OAuthError("invalid_client", "Wrong client secret.", status=401)
    return client


def purge_expired():
    """Housekeeping done on the way: stale requests and codes, revoked connections, clients nobody ever used."""
    now = timezone.now()
    OAuthAuthorizationRequest.objects.filter(expires_at__lt=now).delete()
    OAuthAuthorizationCode.objects.filter(expires_at__lt=now - timedelta(days=1)).delete()
    OAuthConnection.objects.filter(
        Q(revoked_at__lt=now - timedelta(days=30)) | Q(refresh_expires_at__lt=now - timedelta(days=30))
    ).delete()
    OAuthClient.objects.filter(
        created_at__lt=now - timedelta(days=7), connections__isnull=True, authorization_codes__isnull=True
    ).delete()


# --- Authorization requests -------------------------------------------------------------------------------------


def parse_scopes(raw, policy) -> list:
    """Known and allowed scopes from a space separated ``scope`` parameter, in the canonical order."""
    if isinstance(raw, str):
        asked = set(raw.split())
    elif isinstance(raw, (list, tuple, set)):
        asked = {str(item) for item in raw}
    else:
        asked = set()
    return [scope for scope in API_TOKEN_SCOPES if scope in asked and scope in policy["allowed_scopes"]]


def default_scopes(requested, policy) -> list:
    """What the consent screen offers: what the application asked for, or a sensible set when it asked for nothing."""
    chosen = list(requested) or [scope for scope in DEFAULT_CONNECT_SCOPES if scope in policy["allowed_scopes"]]
    if "read" in policy["allowed_scopes"] and "read" not in chosen:
        chosen.insert(0, "read")
    return chosen


def normalize_resource(value: str) -> str:
    return value.strip().rstrip("/")


def start_authorization(params: dict, policy, request) -> OAuthAuthorizationRequest:
    """Validate an authorization request. Raises ``AuthorizeError`` that says whether the redirect URI is trusted."""
    client = OAuthClient.objects.filter(client_id=params.get("client_id") or "").first()
    if client is None:
        raise AuthorizeError("invalid_request", "Unknown client_id. Register the application first.")
    redirect_uri = params.get("redirect_uri") or ""
    if not redirect_uri and len(client.redirect_uris) == 1:
        redirect_uri = client.redirect_uris[0]
    if redirect_uri not in client.redirect_uris:
        raise AuthorizeError("invalid_request", "redirect_uri does not match a registered redirect URI.")

    state = (params.get("state") or "")[:1000]

    def fail(error, description):
        raise AuthorizeError(error, description, redirect_uri=redirect_uri, state=state)

    if params.get("response_type") != "code":
        fail("unsupported_response_type", "Only response_type=code is supported.")
    challenge = params.get("code_challenge") or ""
    if not CODE_CHALLENGE_RE.match(challenge):
        fail("invalid_request", "A PKCE code_challenge (S256) is required.")
    if (params.get("code_challenge_method") or "S256") != "S256":
        fail("invalid_request", "Only code_challenge_method=S256 is supported.")
    resource = normalize_resource(params.get("resource") or "")
    if resource and resource != normalize_resource(resource_url(request)):
        fail("invalid_target", "resource must be the MCP server URL of this instance.")

    return OAuthAuthorizationRequest.objects.create(
        request_id=random_value(nbytes=24),
        client=client,
        redirect_uri=redirect_uri,
        code_challenge=challenge,
        state=state,
        requested_scopes=parse_scopes(params.get("scope"), policy),
        resource=resource,
        expires_at=timezone.now() + timedelta(seconds=AUTHORIZATION_REQUEST_SECONDS),
    )


class AuthorizeError(Exception):
    """An authorization request error: with a ``redirect_uri`` it goes back to the application, else to the user."""

    def __init__(self, error, description, redirect_uri="", state=""):
        super().__init__(description)
        self.error = error
        self.description = description
        self.redirect_uri = redirect_uri
        self.state = state


def append_query(url: str, params: dict) -> str:
    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True) + [(k, v) for k, v in params.items() if v not in (None, "")]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def redirect_host(redirect_uri: str) -> str:
    """What the user is told about where the approval goes."""
    parsed = urlsplit(redirect_uri)
    return parsed.netloc if parsed.scheme in ("http", "https") else f"{parsed.scheme}://"


def create_authorization_code(auth_request, user, scopes, workspace) -> str:
    code = random_value(nbytes=32)
    OAuthAuthorizationCode.objects.create(
        code_hash=hash_value(code),
        client=auth_request.client,
        user=user,
        workspace=workspace,
        scopes=scopes,
        redirect_uri=auth_request.redirect_uri,
        code_challenge=auth_request.code_challenge,
        resource=auth_request.resource,
        expires_at=timezone.now() + timedelta(seconds=AUTHORIZATION_CODE_SECONDS),
    )
    return code


# --- Tokens -----------------------------------------------------------------------------------------------------


def pkce_matches(verifier: str, challenge: str) -> bool:
    if not CODE_VERIFIER_RE.match(verifier or ""):
        return False
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return hmac.compare_digest(expected, challenge)


def refresh_lifetime(policy) -> timedelta:
    return timedelta(days=policy["max_token_days"] or DEFAULT_REFRESH_DAYS)


def revoke_connection(connection: OAuthConnection):
    now = timezone.now()
    connection.revoked_at = connection.revoked_at or now
    connection.save(update_fields=["revoked_at"])
    token = connection.access_token
    if token is not None:
        token.is_active = False
        token.expired_at = now
        token.save(update_fields=["is_active", "expired_at", "updated_at"])


def issue_tokens(connection: OAuthConnection, policy, first=False) -> dict:
    """Rotate the access token (same ``APIToken`` row, new secret) and the refresh token of a connection."""
    now = timezone.now()
    access_value = random_value(ACCESS_TOKEN_PREFIX, 32)
    refresh_value = random_value(REFRESH_TOKEN_PREFIX, 40)

    token = connection.access_token
    if token is None:
        token = APIToken(
            user=connection.user,
            user_type=1 if connection.user.is_bot else 0,
            source=API_TOKEN_SOURCE_OAUTH,
            description="Issued by the OAuth authorization server of the MCP server",
        )
    token.label = f"OAuth: {connection.client.client_name}"[:255]
    token.workspace = connection.workspace
    token.scopes = list(connection.scopes)
    token.allowed_rate_limit = policy["default_rate_limit"]
    token.token = access_value
    token.is_active = True
    token.expired_at = now + timedelta(seconds=ACCESS_TOKEN_SECONDS)
    token.save()

    if not first:
        connection.previous_refresh_token_hash = connection.refresh_token_hash
        connection.rotated_at = now
    connection.refresh_token_hash = hash_value(refresh_value)
    connection.refresh_expires_at = now + refresh_lifetime(policy)
    connection.access_token = token
    connection.last_used_at = now
    connection.save()
    return {
        "access_token": access_value,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_SECONDS,
        "refresh_token": refresh_value,
        "scope": " ".join(connection.scopes),
    }


def connection_payload(connection: OAuthConnection) -> dict:
    workspace = connection.workspace
    payload = {
        "id": str(connection.id),
        "client_name": connection.client.client_name,
        "client_uri": connection.client.client_uri,
        "workspace": {"slug": workspace.slug, "name": workspace.name} if workspace else None,
        "scopes": connection.scopes,
        "created_at": connection.created_at,
        "last_used_at": connection.last_used_at,
        "expires_at": connection.refresh_expires_at,
    }
    return payload


def active_connections():
    now = timezone.now()
    return OAuthConnection.objects.filter(revoked_at__isnull=True, refresh_expires_at__gt=now).select_related(
        "client", "workspace", "user", "access_token"
    )
