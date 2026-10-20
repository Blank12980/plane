# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import base64
import hashlib
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    OAuthAuthorizationCode,
    OAuthAuthorizationRequest,
    OAuthClient,
    OAuthConnection,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import Instance, InstanceAdmin, McpSettings
from plane.utils.mcp import invalidate_mcp_policy

pytestmark = [pytest.mark.contract, pytest.mark.django_db]

BASE = "http://localhost"
REGISTER = "/auth/oauth/register/"
AUTHORIZE = "/auth/oauth/authorize/"
TOKEN = "/auth/oauth/token/"
REVOKE = "/auth/oauth/revoke/"
REDIRECT = "https://chatgpt.com/connector/oauth/abc123"
VERIFIER = "v" * 64
CHALLENGE = base64.urlsafe_b64encode(hashlib.sha256(VERIFIER.encode()).digest()).decode().rstrip("=")


@pytest.fixture(autouse=True)
def fresh_policy_cache():
    cache.clear()
    invalidate_mcp_policy()
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield
    cache.clear()
    invalidate_mcp_policy()


@pytest.fixture
def two_workspaces(workspace, create_user):
    owner = User.objects.create_user(email="owner2@example.com", username="owner2")
    second = Workspace.objects.create(name="Second", slug="second", owner=owner)
    WorkspaceMember.objects.create(workspace=second, member=owner, role=20)
    WorkspaceMember.objects.create(workspace=second, member=create_user, role=15)
    foreign_owner = User.objects.create_user(email="owner3@example.com", username="owner3")
    foreign = Workspace.objects.create(name="Foreign", slug="foreign", owner=foreign_owner)
    WorkspaceMember.objects.create(workspace=foreign, member=foreign_owner, role=20)
    return workspace, second, foreign


def set_policy(**values):
    row = McpSettings.load()
    for key, value in values.items():
        setattr(row, key, value)
    row.save()
    invalidate_mcp_policy()


def anonymous():
    return APIClient()


def user_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def register(**overrides):
    body = {"client_name": "ChatGPT", "redirect_uris": [REDIRECT], "token_endpoint_auth_method": "none"}
    body.update(overrides)
    response = anonymous().post(REGISTER, body, format="json")
    return response


def start(client_id, **overrides):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT,
        "code_challenge": CHALLENGE,
        "code_challenge_method": "S256",
        "state": "xyz",
        "scope": "read issues:write",
        "resource": f"{BASE}/mcp",
    }
    params.update(overrides)
    params = {key: value for key, value in params.items() if value is not None}
    return anonymous().get(AUTHORIZE, params)


def request_id_from(response):
    assert response.status_code == 302, response.content
    location = urlsplit(response["Location"])
    assert location.path == "/oauth/authorize"
    query = parse_qs(location.query)
    assert "request" in query, location.query
    return query["request"][0]


def approve(browser, request_id, **overrides):
    consent = browser.get(f"/api/oauth/authorize/{request_id}/")
    assert consent.status_code == 200, consent.content
    body = {
        "decision": "approve",
        "consent_token": consent.json()["consent_token"],
        "scopes": ["read", "issues:write"],
        "all_workspaces": True,
    }
    body.update(overrides)
    return browser.post(f"/api/oauth/authorize/{request_id}/", body, format="json")


def code_from(response):
    assert response.status_code == 200, response.content
    url = urlsplit(response.json()["redirect_url"])
    assert f"{url.scheme}://{url.netloc}{url.path}" == REDIRECT
    query = parse_qs(url.query)
    assert query["state"] == ["xyz"]
    return query["code"][0]


def exchange(client_id, code, **overrides):
    body = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "code": code,
        "code_verifier": VERIFIER,
        "redirect_uri": REDIRECT,
    }
    body.update(overrides)
    return anonymous().post(TOKEN, body)


def connect(user, **approve_overrides):
    """The whole dance up to the token response. Returns (client_id, token response json)."""
    client_id = register().json()["client_id"]
    request_id = request_id_from(start(client_id))
    code = code_from(approve(user_client(user), request_id, **approve_overrides))
    response = exchange(client_id, code)
    assert response.status_code == 200, response.content
    return client_id, response.json()


def api(token):
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token)
    return client


# -- discovery -------------------------------------------------------------------------------------------------


def test_discovery_documents_describe_the_server():
    resource = anonymous().get("/.well-known/oauth-protected-resource/mcp")
    assert resource.status_code == 200
    assert resource.json()["resource"] == f"{BASE}/mcp"
    assert resource.json()["authorization_servers"] == [BASE]
    assert resource["Access-Control-Allow-Origin"] == "*"
    # the same document is served without the resource path
    assert anonymous().get("/.well-known/oauth-protected-resource").json() == resource.json()

    meta = anonymous().get("/.well-known/oauth-authorization-server").json()
    assert meta["issuer"] == BASE
    assert meta["authorization_endpoint"] == f"{BASE}/auth/oauth/authorize/"
    assert meta["token_endpoint"] == f"{BASE}/auth/oauth/token/"
    assert meta["registration_endpoint"] == f"{BASE}/auth/oauth/register/"
    assert meta["code_challenge_methods_supported"] == ["S256"]
    assert meta["response_types_supported"] == ["code"]
    assert set(meta["grant_types_supported"]) == {"authorization_code", "refresh_token"}
    assert "read" in meta["scopes_supported"] and "issues:delete" not in meta["scopes_supported"]
    assert anonymous().options("/.well-known/oauth-authorization-server").status_code == 204


@pytest.mark.parametrize("policy", [{"allow_oauth": False}, {"enabled": False}])
def test_nothing_is_discoverable_when_oauth_is_off(policy):
    set_policy(**policy)
    assert anonymous().get("/.well-known/oauth-protected-resource/mcp").status_code == 404
    assert anonymous().get("/.well-known/oauth-authorization-server").status_code == 404
    assert register().status_code == 404
    token = anonymous().post(TOKEN, {"grant_type": "authorization_code", "client_id": "x"})
    assert token.status_code == 400 and token.json()["error"] == "unauthorized_client"
    location = start("whatever")["Location"]
    assert urlsplit(location).path == "/oauth/authorize" and "error=access_denied" in location


# -- registration ----------------------------------------------------------------------------------------------


def test_applications_register_themselves():
    response = register()
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["client_id"].startswith("gzo_") and "client_secret" not in body
    assert body["redirect_uris"] == [REDIRECT] and body["token_endpoint_auth_method"] == "none"
    assert response["Cache-Control"] == "no-store"
    assert OAuthClient.objects.get(client_id=body["client_id"]).client_name == "ChatGPT"

    secret_client = register(token_endpoint_auth_method="client_secret_post").json()
    assert secret_client["client_secret"]
    stored = OAuthClient.objects.get(client_id=secret_client["client_id"])
    assert stored.client_secret_hash and stored.client_secret_hash != secret_client["client_secret"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"redirect_uris": []},
        {"redirect_uris": ["http://evil.example/callback"]},
        {"redirect_uris": ["javascript:alert(1)"]},
        {"redirect_uris": ["https://ok.example/cb#fragment"]},
        {"redirect_uris": [f"https://ok.example/{n}" for n in range(6)]},
        {"token_endpoint_auth_method": "private_key_jwt"},
        {"grant_types": ["password"]},
    ],
)
def test_registration_rejects_unsafe_metadata(overrides):
    response = register(**overrides)
    assert response.status_code == 400
    assert response.json()["error"] in {"invalid_redirect_uri", "invalid_client_metadata"}


def test_desktop_applications_may_use_loopback_and_private_schemes():
    ok = register(redirect_uris=["http://127.0.0.1:33418/callback", "cursor://anysphere.cursor-retrieve/oauth"])
    assert ok.status_code == 201, ok.content


# -- the authorization code flow -------------------------------------------------------------------------------


def test_full_flow_gives_a_working_token_for_all_workspaces(two_workspaces, create_user):
    first, second, foreign = two_workspaces
    client_id, tokens = connect(create_user)
    assert tokens["token_type"] == "Bearer" and tokens["expires_in"] == 3600
    assert tokens["access_token"].startswith("plane_oauth_") and tokens["refresh_token"].startswith("plane_rt_")
    assert tokens["scope"] == "read issues:write"

    client = api(tokens["access_token"])
    assert client.get("/api/v1/users/me/").status_code == 200
    # the token acts for the user in every workspace of theirs and nowhere else
    assert client.get(f"/api/v1/workspaces/{first.slug}/projects/").status_code == 200
    assert client.get(f"/api/v1/workspaces/{second.slug}/projects/").status_code == 200
    assert client.get(f"/api/v1/workspaces/{foreign.slug}/projects/").status_code in (403, 404)
    # scopes are enforced: no comments:write was granted
    token = APIToken.objects.get(token=tokens["access_token"])
    assert token.source == "oauth" and token.scopes == ["read", "issues:write"] and token.workspace_id is None
    assert token.user_id == create_user.id

    info = client.get("/api/v1/users/me/token/").json()
    assert info["source"] == "oauth" and info["workspace"] is None
    assert set(info["workspaces"]) == {first.slug, second.slug}


def test_a_connection_can_be_bound_to_one_workspace(two_workspaces, create_user):
    first, second, _ = two_workspaces
    _, tokens = connect(create_user, all_workspaces=False, workspace_slug=second.slug)
    client = api(tokens["access_token"])
    assert client.get(f"/api/v1/workspaces/{second.slug}/projects/").status_code == 200
    assert client.get(f"/api/v1/workspaces/{first.slug}/projects/").status_code == 403
    info = client.get("/api/v1/users/me/token/").json()
    assert info["workspace"] == second.slug and info["workspaces"] == [second.slug]


def test_authorization_requests_are_validated(create_user, workspace):
    client_id = register().json()["client_id"]

    # an unknown application or a foreign redirect URI must never be redirected to
    for response in (start("nope"), start(client_id, redirect_uri="https://evil.example/cb")):
        location = response["Location"]
        assert urlsplit(location).path == "/oauth/authorize" and "error=invalid_request" in location
        assert "evil.example" not in location.split("?")[0]

    # errors after the redirect URI is trusted go back to the application together with its state
    for overrides, error in [
        ({"response_type": "token"}, "unsupported_response_type"),
        ({"code_challenge": None}, "invalid_request"),
        ({"code_challenge_method": "plain"}, "invalid_request"),
        ({"resource": "https://other.example/mcp"}, "invalid_target"),
    ]:
        location = urlsplit(start(client_id, **overrides)["Location"])
        assert f"{location.scheme}://{location.netloc}{location.path}" == REDIRECT
        query = parse_qs(location.query)
        assert query["error"] == [error] and query["state"] == ["xyz"]

    assert OAuthAuthorizationRequest.objects.count() == 0
    # the resource may be written with a trailing slash, and omitted
    assert start(client_id, resource=f"{BASE}/mcp/").status_code == 302
    assert request_id_from(start(client_id, resource=None))


def test_the_consent_screen_shows_what_is_asked_and_needs_a_signed_in_user(two_workspaces, create_user):
    client_id = register(client_name="ChatGPT <b>x</b>").json()["client_id"]
    request_id = request_id_from(start(client_id, scope="read comments:write bogus:scope issues:delete"))

    assert anonymous().get(f"/api/oauth/authorize/{request_id}/").status_code in (401, 403)

    body = user_client(create_user).get(f"/api/oauth/authorize/{request_id}/").json()
    assert body["client"]["name"] == "ChatGPT bx/b"  # angle brackets are stripped from the name
    assert body["client"]["redirect_host"] == "chatgpt.com"
    # unknown scopes and scopes the instance does not allow are not offered
    assert body["scopes"]["requested"] == ["read", "comments:write"]
    assert body["scopes"]["default"] == ["read", "comments:write"]
    assert "issues:delete" not in body["scopes"]["allowed"]
    assert {w["slug"] for w in body["workspaces"]} == {two_workspaces[0].slug, two_workspaces[1].slug}
    assert body["allow_all_workspaces"] is True

    # asking for nothing offers a sensible default instead of an empty grant
    other = request_id_from(start(client_id, scope=None))
    assert user_client(create_user).get(f"/api/oauth/authorize/{other}/").json()["scopes"]["default"] == [
        "read",
        "issues:write",
        "comments:write",
        "worklogs:write",
    ]

    assert user_client(create_user).get("/api/oauth/authorize/missing/").status_code == 404
    OAuthAuthorizationRequest.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert user_client(create_user).get(f"/api/oauth/authorize/{request_id}/").status_code == 404


def test_approval_cannot_be_forged(two_workspaces, create_user):
    client_id = register().json()["client_id"]
    request_id = request_id_from(start(client_id))
    browser = user_client(create_user)
    url = f"/api/oauth/authorize/{request_id}/"
    base = {"decision": "approve", "scopes": ["read"], "all_workspaces": True}

    # no confirmation, a made-up one, or one that was issued to somebody else
    assert browser.post(url, base, format="json").status_code == 400
    assert browser.post(url, {**base, "consent_token": "forged"}, format="json").status_code == 403
    other = User.objects.create_user(email="other-user@example.com", username="other-user")
    WorkspaceMember.objects.create(workspace=two_workspaces[0], member=other, role=15)
    stolen = user_client(other).get(url).json()["consent_token"]
    assert browser.post(url, {**base, "consent_token": stolen}, format="json").status_code == 403
    assert OAuthAuthorizationCode.objects.count() == 0 and OAuthAuthorizationRequest.objects.count() == 1


def test_the_user_chooses_scopes_and_workspaces_within_the_policy(two_workspaces, create_user):
    first, second, foreign = two_workspaces
    client_id = register().json()["client_id"]

    def attempt(**overrides):
        request_id = request_id_from(start(client_id))
        return approve(user_client(create_user), request_id, **overrides)

    assert attempt(scopes=["issues:delete", "read"]).status_code == 400  # not allowed by default
    assert attempt(scopes=["issues:write"]).status_code == 400  # read is required
    assert attempt(scopes=[]).status_code == 400
    assert attempt(all_workspaces=False, workspace_slug=foreign.slug).status_code == 400  # not a member
    assert attempt(all_workspaces=False, workspace_slug="").status_code == 400
    assert attempt(all_workspaces=True, workspace_slug=first.slug).status_code == 400
    set_policy(allow_all_workspaces=False)
    assert attempt(all_workspaces=True).status_code == 400
    assert attempt(all_workspaces=False, workspace_slug=first.slug).status_code == 200


def test_a_client_role_member_has_nothing_to_connect(create_user, workspace):
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=3)
    client_id = register().json()["client_id"]
    request_id = request_id_from(start(client_id))
    assert user_client(create_user).get(f"/api/oauth/authorize/{request_id}/").json()["workspaces"] == []
    assert approve(user_client(create_user), request_id).status_code == 400


def test_denying_returns_access_denied_and_closes_the_request(workspace, create_user):
    client_id = register().json()["client_id"]
    request_id = request_id_from(start(client_id))
    browser = user_client(create_user)
    token = browser.get(f"/api/oauth/authorize/{request_id}/").json()["consent_token"]
    response = browser.post(
        f"/api/oauth/authorize/{request_id}/", {"decision": "deny", "consent_token": token}, format="json"
    )
    query = parse_qs(urlsplit(response.json()["redirect_url"]).query)
    assert query == {"error": ["access_denied"], "state": ["xyz"]}
    assert OAuthAuthorizationRequest.objects.count() == 0
    assert browser.get(f"/api/oauth/authorize/{request_id}/").status_code == 404


# -- the token endpoint ----------------------------------------------------------------------------------------


def test_pkce_binds_the_code_to_the_application_that_asked(workspace, create_user):
    client_id = register().json()["client_id"]
    code = code_from(approve(user_client(create_user), request_id_from(start(client_id))))

    wrong = exchange(client_id, code, code_verifier="w" * 64)
    assert wrong.status_code == 400 and wrong.json()["error"] == "invalid_grant"
    short = exchange(client_id, code, code_verifier="short")
    assert short.json()["error"] == "invalid_grant"
    other_uri = exchange(client_id, code, redirect_uri="https://evil.example/cb")
    assert other_uri.json()["error"] == "invalid_grant"
    other_client = register().json()["client_id"]
    assert exchange(other_client, code).json()["error"] == "invalid_grant"
    assert OAuthConnection.objects.count() == 0

    assert exchange(client_id, code).status_code == 200


def test_a_code_works_once_and_replaying_it_closes_the_connection(workspace, create_user):
    client_id = register().json()["client_id"]
    code = code_from(approve(user_client(create_user), request_id_from(start(client_id))))
    first = exchange(client_id, code).json()
    assert api(first["access_token"]).get("/api/v1/users/me/").status_code == 200

    replay = exchange(client_id, code)
    assert replay.status_code == 400 and replay.json()["error"] == "invalid_grant"
    assert api(first["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert refresh(client_id, first["refresh_token"]).json()["error"] == "invalid_grant"


def test_an_expired_code_is_refused(workspace, create_user):
    client_id = register().json()["client_id"]
    code = code_from(approve(user_client(create_user), request_id_from(start(client_id))))
    OAuthAuthorizationCode.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
    assert exchange(client_id, code).json()["error"] == "invalid_grant"


def test_confidential_clients_must_prove_their_secret(workspace, create_user):
    registered = register(token_endpoint_auth_method="client_secret_post").json()
    client_id, secret = registered["client_id"], registered["client_secret"]
    code = code_from(approve(user_client(create_user), request_id_from(start(client_id))))

    missing = exchange(client_id, code)
    assert missing.status_code == 401 and missing.json()["error"] == "invalid_client"
    assert exchange(client_id, code, client_secret="nope").status_code == 401
    assert exchange(client_id, code, client_secret=secret).status_code == 200

    basic = register(token_endpoint_auth_method="client_secret_basic").json()
    code = code_from(approve(user_client(create_user), request_id_from(start(basic["client_id"]))))
    client = anonymous()
    client.credentials(
        HTTP_AUTHORIZATION="Basic "
        + base64.b64encode(f"{basic['client_id']}:{basic['client_secret']}".encode()).decode()
    )
    body = {"grant_type": "authorization_code", "code": code, "code_verifier": VERIFIER, "redirect_uri": REDIRECT}
    assert client.post(TOKEN, body).status_code == 200

    assert anonymous().post(TOKEN, {"grant_type": "authorization_code", "client_id": "unknown"}).status_code == 401
    unsupported = anonymous().post(TOKEN, {"grant_type": "password", "client_id": client_id, "client_secret": secret})
    assert unsupported.json()["error"] == "unsupported_grant_type"


def refresh(client_id, token, **overrides):
    return anonymous().post(
        TOKEN, {"grant_type": "refresh_token", "client_id": client_id, "refresh_token": token, **overrides}
    )


def test_refreshing_rotates_both_tokens(workspace, create_user):
    client_id, first = connect(create_user)
    response = refresh(client_id, first["refresh_token"])
    assert response.status_code == 200, response.content
    second = response.json()
    assert second["access_token"] != first["access_token"] and second["refresh_token"] != first["refresh_token"]
    assert second["scope"] == first["scope"]

    assert api(first["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert api(second["access_token"]).get("/api/v1/users/me/").status_code == 200
    # still one access token row for the connection, not one per refresh
    assert APIToken.objects.filter(source="oauth").count() == 1

    third = refresh(client_id, second["refresh_token"]).json()
    assert api(third["access_token"]).get("/api/v1/users/me/").status_code == 200


def test_a_refresh_token_replayed_after_rotation_closes_the_connection(workspace, create_user):
    client_id, first = connect(create_user)
    second = refresh(client_id, first["refresh_token"]).json()

    # a parallel duplicate right after the rotation is only refused
    assert refresh(client_id, first["refresh_token"]).json()["error"] == "invalid_grant"
    assert api(second["access_token"]).get("/api/v1/users/me/").status_code == 200

    # much later the old token shows up again: it leaked, so everything is closed
    OAuthConnection.objects.update(rotated_at=timezone.now() - timedelta(minutes=5))
    assert refresh(client_id, first["refresh_token"]).json()["error"] == "invalid_grant"
    assert api(second["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert refresh(client_id, second["refresh_token"]).json()["error"] == "invalid_grant"


def test_refresh_stops_when_the_connection_ends(workspace, create_user):
    client_id, tokens = connect(create_user)
    other = register().json()["client_id"]
    assert refresh(other, tokens["refresh_token"]).json()["error"] == "invalid_grant"

    OAuthConnection.objects.update(refresh_expires_at=timezone.now() - timedelta(seconds=1))
    assert refresh(client_id, tokens["refresh_token"]).json()["error"] == "invalid_grant"

    client_id, tokens = connect(create_user)
    User.objects.filter(pk=create_user.pk).update(is_active=False)
    assert refresh(client_id, tokens["refresh_token"]).json()["error"] == "invalid_grant"
    assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)


def test_the_refresh_lifetime_follows_the_token_policy(workspace, create_user):
    set_policy(max_token_days=7)
    connect(create_user)
    connection = OAuthConnection.objects.get()
    assert timedelta(days=6, hours=23) < connection.refresh_expires_at - timezone.now() <= timedelta(days=7)
    token = APIToken.objects.get(source="oauth")
    assert token.allowed_rate_limit == "120/min"
    assert timezone.now() < token.expired_at <= timezone.now() + timedelta(hours=1)


def test_connecting_the_same_application_again_replaces_the_old_connection(workspace, create_user):
    client_id, first = connect(create_user)
    code = code_from(approve(user_client(create_user), request_id_from(start(client_id))))
    second = exchange(client_id, code).json()
    assert api(first["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert api(second["access_token"]).get("/api/v1/users/me/").status_code == 200
    assert OAuthConnection.objects.filter(revoked_at__isnull=True).count() == 1


# -- revoking and the instance policy --------------------------------------------------------------------------


def test_the_application_can_revoke_its_own_token(workspace, create_user):
    client_id, tokens = connect(create_user)
    other = register().json()["client_id"]
    # somebody else's token is silently ignored
    assert anonymous().post(REVOKE, {"client_id": other, "token": tokens["refresh_token"]}).status_code == 200
    assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code == 200

    assert anonymous().post(REVOKE, {"client_id": client_id, "token": tokens["refresh_token"]}).status_code == 200
    assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert refresh(client_id, tokens["refresh_token"]).json()["error"] == "invalid_grant"


def test_the_user_sees_and_closes_their_connections(workspace, create_user):
    _, tokens = connect(create_user)
    browser = user_client(create_user)
    overview = browser.get("/api/users/me/mcp/").json()
    assert overview["policy"]["allow_oauth"] is True
    assert overview["oauth"]["enabled"] is True
    assert (
        overview["oauth"]["endpoints"]["authorization_server_metadata"]
        == f"{BASE}/.well-known/oauth-authorization-server"
    )
    assert overview["oauth"]["endpoints"]["resource"] == f"{BASE}/mcp"
    [connection] = overview["oauth"]["connections"]
    assert connection["client_name"] == "ChatGPT" and connection["scopes"] == ["read", "issues:write"]
    assert connection["workspace"] is None
    # OAuth tokens are not listed with the tokens the user creates by hand, and cannot be revealed
    assert overview["tokens"] == []
    assert "access_token" not in str(overview) and tokens["access_token"] not in str(overview)

    stranger = User.objects.create_user(email="stranger@example.com", username="stranger")
    assert user_client(stranger).delete(f"/api/users/me/mcp/connections/{connection['id']}/").status_code == 404
    assert browser.delete(f"/api/users/me/mcp/connections/{connection['id']}/").status_code == 204
    assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert browser.get("/api/users/me/mcp/").json()["oauth"]["connections"] == []


def test_switching_oauth_or_mcp_off_stops_existing_connections(workspace, create_user):
    _, tokens = connect(create_user)
    client = api(tokens["access_token"])
    set_policy(allow_oauth=False)
    assert client.get("/api/v1/users/me/").status_code in (401, 403)
    set_policy(allow_oauth=True, enabled=False)
    assert client.get("/api/v1/users/me/").status_code in (401, 403)
    set_policy(enabled=True)
    assert client.get("/api/v1/users/me/").status_code == 200

    # personal tokens made by hand are not affected by the OAuth switch
    set_policy(allow_oauth=False)
    token = APIToken.objects.create(user=create_user, source="mcp", scopes=["read"])
    assert api(token.token).get("/api/v1/users/me/").status_code == 200


def test_consent_is_refused_when_oauth_is_off(workspace, create_user):
    client_id = register().json()["client_id"]
    request_id = request_id_from(start(client_id))
    set_policy(allow_oauth=False)
    assert user_client(create_user).get(f"/api/oauth/authorize/{request_id}/").status_code == 403


def test_the_token_check_is_not_rate_limited_and_reports_the_token(workspace, create_user):
    token = APIToken.objects.create(user=create_user, source="mcp", scopes=["read"], allowed_rate_limit="1/min")
    client = api(token.token)
    for _ in range(3):
        response = client.get("/api/v1/users/me/token/")
        assert response.status_code == 200
    body = response.json()
    assert body["active"] is True and body["source"] == "mcp" and body["scopes"] == ["read"]
    assert body["workspaces"] == [workspace.slug]
    assert APIClient().get("/api/v1/users/me/token/").status_code in (401, 403)


# -- God Mode --------------------------------------------------------------------------------------------------


@pytest.fixture
def instance_admin(db):
    admin = User.objects.create_user(email="root@example.com", username="root")
    instance = Instance.objects.create(
        instance_name="MCP instance", instance_id="mcp-instance", current_version="test", last_checked_at=timezone.now()
    )
    InstanceAdmin.objects.create(instance=instance, user=admin, role=20)
    return user_client(admin)


def test_the_administrator_switches_oauth_and_sees_all_connections(workspace, create_user, instance_admin):
    _, tokens = connect(create_user)
    with patch("plane.license.api.views.mcp.requests.get", side_effect=OSError("offline")):
        settings = instance_admin.get("/api/instances/mcp/").json()
        assert settings["settings"]["allow_oauth"] is True and settings["stats"]["oauth_connections"] == 1
        # OAuth tokens do not show up among the MCP tokens
        assert instance_admin.get("/api/instances/mcp/tokens/").json() == []

        rows = instance_admin.get("/api/instances/mcp/connections/").json()
        assert len(rows) == 1 and rows[0]["user"]["email"] == create_user.email and rows[0]["client_name"] == "ChatGPT"

        patched = instance_admin.patch("/api/instances/mcp/", {"allow_oauth": False}, format="json")
        assert patched.status_code == 200 and patched.json()["settings"]["allow_oauth"] is False
        assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
        instance_admin.patch("/api/instances/mcp/", {"allow_oauth": True}, format="json")

        assert instance_admin.delete(f"/api/instances/mcp/connections/{rows[0]['id']}/").status_code == 204
    assert api(tokens["access_token"]).get("/api/v1/users/me/").status_code in (401, 403)
    assert instance_admin.get("/api/instances/mcp/connections/").json() == []
    assert user_client(create_user).get("/api/instances/mcp/connections/").status_code in (401, 403)


def test_housekeeping_removes_stale_records(workspace, create_user):
    from plane.utils.oauth import purge_expired

    stale = register().json()["client_id"]
    OAuthClient.objects.filter(client_id=stale).update(created_at=timezone.now() - timedelta(days=8))
    used, _ = connect(create_user)
    OAuthClient.objects.filter(client_id=used).update(created_at=timezone.now() - timedelta(days=8))
    request_id_from(start(register().json()["client_id"]))
    OAuthAuthorizationRequest.objects.update(expires_at=timezone.now() - timedelta(seconds=1))

    purge_expired()
    assert not OAuthClient.objects.filter(client_id=stale).exists()
    assert OAuthClient.objects.filter(client_id=used).exists()
    assert OAuthAuthorizationRequest.objects.count() == 0
