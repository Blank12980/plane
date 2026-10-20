# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import APIActivityLog, APIToken, User, Workspace, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin, McpSettings
from plane.utils.mcp import invalidate_mcp_policy

pytestmark = [pytest.mark.contract, pytest.mark.django_db]

ADMIN_URL = "/api/instances/mcp/"
TOKENS_URL = "/api/instances/mcp/tokens/"
USER_URL = "/api/users/me/mcp/"
USER_TOKENS_URL = "/api/users/me/mcp/tokens/"


@pytest.fixture(autouse=True)
def fresh_policy_cache():
    cache.clear()
    invalidate_mcp_policy()
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield
    cache.clear()
    invalidate_mcp_policy()


@pytest.fixture
def instance_admin(db):
    admin = User.objects.create_user(email="root@example.com", username="root")
    instance = Instance.objects.create(
        instance_name="MCP instance", instance_id="mcp-instance", current_version="test", last_checked_at=timezone.now()
    )
    InstanceAdmin.objects.create(instance=instance, user=admin, role=20)
    client = APIClient()
    client.force_authenticate(user=admin)
    return admin, client


def set_policy(**values):
    row = McpSettings.load()
    for key, value in values.items():
        setattr(row, key, value)
    row.save()
    invalidate_mcp_policy()


def create_token(client, workspace, **overrides):
    payload = {"label": "Cursor", "workspace_slug": workspace.slug, "scopes": ["read", "issues:write"]}
    payload.update(overrides)
    return client.post(USER_TOKENS_URL, payload, format="json")


@pytest.fixture
def mcp_calls():
    """Rejects nothing, only keeps the health probe offline."""
    with patch("plane.license.api.views.mcp.requests.get", side_effect=OSError("offline")):
        yield


# -- God Mode ----------------------------------------------------------------------------------------------------


def test_only_instance_admins_manage_mcp(session_client, mcp_calls):
    for url in (ADMIN_URL, TOKENS_URL, ADMIN_URL + "activity/"):
        assert session_client.get(url).status_code == 403
    assert session_client.patch(ADMIN_URL, {"enabled": False}, format="json").status_code == 403


def test_defaults_and_settings_update(instance_admin, mcp_calls):
    _, client = instance_admin
    data = client.get(ADMIN_URL).json()
    assert data["settings"]["enabled"] is True
    assert "issues:delete" not in data["settings"]["allowed_scopes"]
    assert data["health"]["status"] == "unavailable"
    assert data["stats"]["tokens_total"] == 0

    response = client.patch(
        ADMIN_URL,
        {
            "enabled": True,
            "allow_user_tokens": False,
            "allowed_scopes": ["comments:write", "read"],
            "max_token_days": 30,
            "default_rate_limit": "30/min",
        },
        format="json",
    )
    assert response.status_code == 200, response.content
    settings = response.json()["settings"]
    assert settings["allow_user_tokens"] is False
    assert settings["allowed_scopes"] == ["read", "comments:write"]
    assert settings["max_token_days"] == 30
    assert settings["default_rate_limit"] == "30/min"


@pytest.mark.parametrize(
    "payload",
    [
        {"allowed_scopes": ["issues:write"]},  # read is mandatory
        {"allowed_scopes": ["read", "root"]},
        {"default_rate_limit": "fast"},
        {"max_token_days": -1},
        {"max_token_days": 100000},
    ],
)
def test_invalid_settings_are_rejected(instance_admin, mcp_calls, payload):
    _, client = instance_admin
    assert client.patch(ADMIN_URL, payload, format="json").status_code == 400


# -- the profile settings -----------------------------------------------------------------------------------------


def test_user_connects_mcp_on_their_own_behalf(session_client, workspace, create_user, mcp_calls):
    overview = session_client.get(USER_URL).json()
    assert overview["enabled"] is True
    assert [item["slug"] for item in overview["workspaces"]] == [workspace.slug]
    assert overview["tokens"] == []

    response = create_token(session_client, workspace, scopes=["read", "comments:write"], expires_in_days=30)
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["token"].startswith("plane_api_")
    token = APIToken.objects.get(pk=body["id"])
    assert (token.user_id, token.source, token.workspace_id) == (create_user.id, "mcp", workspace.id)
    assert token.scopes == ["read", "comments:write"]
    assert token.allowed_rate_limit == "120/min"
    assert token.expired_at is not None
    # the secret is only returned on creation
    listing = session_client.get(USER_URL).json()["tokens"]
    assert [item["id"] for item in listing] == [body["id"]]
    assert "token" not in listing[0]


def test_policy_limits_what_a_user_may_create(session_client, workspace, mcp_calls):
    set_policy(allowed_scopes=["read", "comments:write"], max_token_days=30, default_rate_limit="15/min")
    assert create_token(session_client, workspace, scopes=["read", "issues:write"]).status_code == 400
    assert create_token(session_client, workspace, scopes=[]).status_code == 400
    assert create_token(session_client, workspace, scopes=["read"], expires_in_days=31).status_code == 400
    ok = create_token(session_client, workspace, scopes=["read"])
    assert ok.status_code == 201
    token = APIToken.objects.get(pk=ok.json()["id"])
    # without an explicit lifetime the instance maximum applies, and the rate limit comes from the policy
    assert token.allowed_rate_limit == "15/min"
    assert timedelta(days=29) < token.expired_at - timezone.now() <= timedelta(days=30)


def test_switching_mcp_off_or_user_tokens_off_blocks_creation(session_client, workspace, mcp_calls):
    set_policy(allow_user_tokens=False)
    assert create_token(session_client, workspace).status_code == 403
    set_policy(allow_user_tokens=True, enabled=False)
    assert create_token(session_client, workspace).status_code == 403
    assert session_client.get(USER_URL).json()["enabled"] is False


def test_user_cannot_connect_a_foreign_workspace_or_use_the_client_role(
    session_client, workspace, create_user, mcp_calls
):
    owner = User.objects.create_user(email="foreign@example.com", username="foreign")
    foreign = Workspace.objects.create(name="Foreign", slug="foreign", owner=owner)
    WorkspaceMember.objects.create(workspace=foreign, member=owner, role=20)
    assert create_token(session_client, foreign).status_code == 400

    WorkspaceMember.objects.create(workspace=foreign, member=create_user, role=3)
    assert foreign.slug not in [item["slug"] for item in session_client.get(USER_URL).json()["workspaces"]]
    assert create_token(session_client, foreign).status_code == 400


def test_tokens_are_per_user_and_deletable_by_the_owner_only(session_client, workspace, mcp_calls):
    created = create_token(session_client, workspace).json()
    stranger = User.objects.create_user(email="stranger@example.com", username="stranger")
    other = APIClient()
    other.force_authenticate(user=stranger)
    assert other.delete(f"{USER_TOKENS_URL}{created['id']}/").status_code == 404
    assert session_client.delete(f"{USER_TOKENS_URL}{created['id']}/").status_code == 204
    assert not APIToken.objects.filter(pk=created["id"]).exists()


def test_user_cannot_create_more_than_the_limit(session_client, workspace, mcp_calls):
    from plane.app.views.user.mcp import MAX_USER_MCP_TOKENS

    for _ in range(MAX_USER_MCP_TOKENS):
        assert create_token(session_client, workspace).status_code == 201
    assert create_token(session_client, workspace).status_code == 400


# -- enforcement on the API ---------------------------------------------------------------------------------------


def api_client(token):
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    return client


def test_disabling_mcp_stops_mcp_tokens_and_the_mcp_server_but_not_plain_api_tokens(
    session_client, workspace, create_user, mcp_calls
):
    mcp_token = APIToken.objects.get(pk=create_token(session_client, workspace).json()["id"])
    plain_token = APIToken.objects.create(user=create_user, label="plain", workspace=workspace)
    url = f"/api/v1/workspaces/{workspace.slug}/projects/"

    assert api_client(mcp_token).get(url).status_code == 200
    assert api_client(plain_token).get(url, HTTP_X_MCP_TOOL="list_projects").status_code == 200

    set_policy(enabled=False)
    blocked = api_client(mcp_token).get(url)
    assert blocked.status_code in (401, 403)
    assert "MCP" in str(blocked.json())
    # a plain token that is used through the MCP server is blocked as well ...
    assert api_client(plain_token).get(url, HTTP_X_MCP_TOOL="list_projects").status_code in (401, 403)
    # ... but the same token keeps working for ordinary API integrations
    assert api_client(plain_token).get(url).status_code == 200

    set_policy(enabled=True)
    assert api_client(mcp_token).get(url).status_code == 200


# -- inventory, revocation and usage in God Mode -------------------------------------------------------------------


def test_admin_sees_every_mcp_token_and_can_revoke_restore_and_delete(
    instance_admin, session_client, workspace, create_user, mcp_calls
):
    _, admin_client = instance_admin
    token_id = create_token(session_client, workspace).json()["id"]
    APIToken.objects.create(user=create_user, label="not mcp", workspace=workspace)

    listing = admin_client.get(TOKENS_URL).json()
    assert [item["id"] for item in listing] == [token_id]
    assert listing[0]["user"]["email"] == create_user.email
    assert listing[0]["workspace"]["slug"] == workspace.slug
    assert "token" not in listing[0]

    token = APIToken.objects.get(pk=token_id)
    url = f"/api/v1/workspaces/{workspace.slug}/projects/"
    assert api_client(token).get(url).status_code == 200
    assert admin_client.patch(f"{TOKENS_URL}{token_id}/", {"is_active": False}, format="json").json()["revoked"] is True
    assert api_client(token).get(url).status_code in (401, 403)
    assert (
        admin_client.patch(f"{TOKENS_URL}{token_id}/", {"is_active": True}, format="json").json()["is_active"] is True
    )
    assert api_client(token).get(url).status_code == 200
    assert admin_client.patch(f"{TOKENS_URL}{token_id}/", {}, format="json").status_code == 400
    assert admin_client.delete(f"{TOKENS_URL}{token_id}/").status_code == 204
    assert not APIToken.objects.filter(pk=token_id).exists()
    assert admin_client.delete(f"{TOKENS_URL}{token_id}/").status_code == 404


def test_god_mode_counts_tokens_and_recent_tool_calls_without_leaking_secrets(
    instance_admin, session_client, workspace, mcp_calls
):
    _, admin_client = instance_admin
    token = APIToken.objects.get(pk=create_token(session_client, workspace).json()["id"])
    token.last_used = timezone.now()
    token.save(update_fields=["last_used"])
    for name, code in (("list_projects", 200), ("list_projects", 200), ("add_comment", 403)):
        APIActivityLog.objects.create(
            token_identifier=token.token,
            path="/api/v1/x/",
            method="GET",
            headers=str({"Host": "x", "X-Api-Key": token.token, "X-Mcp-Tool": name}),
            response_code=code,
        )
    APIActivityLog.objects.create(
        token_identifier="other", path="/api/v1/y/", method="GET", headers=str({"Host": "x"}), response_code=200
    )

    stats = admin_client.get(ADMIN_URL).json()["stats"]
    assert (stats["tokens_total"], stats["tokens_active"], stats["tokens_used_24h"]) == (1, 1, 1)
    assert (stats["calls_24h"], stats["errors_24h"]) == (3, 1)
    assert stats["top_tools"][0] == {"tool": "list_projects", "calls": 2}

    activity = admin_client.get(ADMIN_URL + "activity/")
    assert activity.status_code == 200
    assert {row["tool"] for row in activity.json()} == {"list_projects", "add_comment"}
    assert token.token not in activity.content.decode()
    assert admin_client.get(ADMIN_URL + "activity/?limit=oops").status_code == 200
