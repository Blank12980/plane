# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import APIToken, User, Workspace, WorkspaceMember
from plane.license.models import McpSettings
from plane.utils.mcp import invalidate_mcp_policy

pytestmark = [pytest.mark.contract, pytest.mark.django_db]

USER_URL = "/api/users/me/mcp/"
TOKENS_URL = "/api/users/me/mcp/tokens/"
ADMIN_URL = "/api/instances/mcp/"


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
    client_space = Workspace.objects.create(name="As client", slug="as-client", owner=foreign_owner)
    WorkspaceMember.objects.create(workspace=client_space, member=foreign_owner, role=20)
    WorkspaceMember.objects.create(workspace=client_space, member=create_user, role=3)
    return workspace, second


def set_policy(**values):
    row = McpSettings.load()
    for key, value in values.items():
        setattr(row, key, value)
    row.save()
    invalidate_mcp_policy()


def api_client(token):
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    return client


# -- one token for every workspace ---------------------------------------------------------------------------------


def test_one_token_can_cover_all_workspaces_of_the_user(session_client, two_workspaces, create_user):
    first, second = two_workspaces
    response = session_client.post(
        TOKENS_URL,
        {"label": "Everywhere", "all_workspaces": True, "scopes": ["read"], "expires_in_days": 30},
        format="json",
    )
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["workspace"] is None
    token = APIToken.objects.get(pk=body["id"])
    assert token.workspace_id is None and token.source == "mcp" and token.user_id == create_user.id

    # it works in each workspace of the user, and nowhere else
    client = api_client(token)
    for slug in (first.slug, second.slug):
        assert client.get(f"/api/v1/workspaces/{slug}/projects/").status_code == 200
    assert client.get("/api/v1/workspaces/foreign/projects/").status_code in (403, 404)
    assert client.get("/api/v1/workspaces/as-client/projects/").status_code in (403, 404)

    # the agent can ask which workspaces it may use (client-role workspaces are not offered)
    listed = client.get("/api/v1/users/me/workspaces/").json()
    assert {item["slug"] for item in listed} == {first.slug, second.slug}


def test_a_workspace_token_lists_only_its_own_workspace(session_client, two_workspaces):
    first, _ = two_workspaces
    created = session_client.post(
        TOKENS_URL, {"label": "One", "workspace_slug": first.slug, "scopes": ["read"]}, format="json"
    ).json()
    listed = api_client(APIToken.objects.get(pk=created["id"])).get("/api/v1/users/me/workspaces/").json()
    assert [item["slug"] for item in listed] == [first.slug]


@pytest.mark.parametrize(
    "payload",
    [
        {"label": "x", "scopes": ["read"]},  # neither a workspace nor all of them
        {"label": "x", "all_workspaces": True, "workspace_slug": "test-workspace", "scopes": ["read"]},
    ],
)
def test_a_token_needs_exactly_one_target(session_client, two_workspaces, payload):
    assert session_client.post(TOKENS_URL, payload, format="json").status_code == 400


def test_the_administrator_can_forbid_tokens_for_all_workspaces(session_client, two_workspaces):
    set_policy(allow_all_workspaces=False)
    overview = session_client.get(USER_URL).json()
    assert overview["policy"]["allow_all_workspaces"] is False
    denied = session_client.post(
        TOKENS_URL, {"label": "Everywhere", "all_workspaces": True, "scopes": ["read"]}, format="json"
    )
    assert denied.status_code == 400
    # a token for a single workspace is still fine
    ok = session_client.post(
        TOKENS_URL, {"label": "One", "workspace_slug": "test-workspace", "scopes": ["read"]}, format="json"
    )
    assert ok.status_code == 201


def test_all_workspaces_policy_is_part_of_the_god_mode_settings(workspace):
    from plane.license.models import Instance, InstanceAdmin

    admin = User.objects.create_user(email="root-agent@example.com", username="root-agent")
    instance = Instance.objects.create(
        instance_name="Agent instance",
        instance_id="agent-instance",
        current_version="t",
        last_checked_at=timezone.now(),
    )
    InstanceAdmin.objects.create(instance=instance, user=admin, role=20)
    client = APIClient()
    client.force_authenticate(user=admin)
    with patch("plane.license.api.views.mcp.requests.get", side_effect=OSError("offline")):
        assert client.get(ADMIN_URL).json()["settings"]["allow_all_workspaces"] is True
        updated = client.patch(ADMIN_URL, {"allow_all_workspaces": False}, format="json")
        assert updated.status_code == 200
        assert updated.json()["settings"]["allow_all_workspaces"] is False


# -- the owner can get the token again for the agent prompt -----------------------------------------------------------


def create(session_client, workspace, **extra):
    payload = {"label": "Cursor", "workspace_slug": workspace.slug, "scopes": ["read"], **extra}
    response = session_client.post(TOKENS_URL, payload, format="json")
    assert response.status_code == 201, response.content
    return response.json()


def test_the_owner_can_read_their_working_token_again(session_client, workspace):
    created = create(session_client, workspace)
    response = session_client.get(f"{TOKENS_URL}{created['id']}/")
    assert response.status_code == 200
    assert response.json() == {"token": created["token"]}
    assert "no-store" in response["Cache-Control"]
    # the overview itself never contains secrets
    assert created["token"] not in session_client.get(USER_URL).content.decode()


def test_only_working_tokens_of_the_owner_can_be_read(session_client, workspace, create_user):
    created = create(session_client, workspace)
    token = APIToken.objects.get(pk=created["id"])

    stranger = User.objects.create_user(email="stranger-agent@example.com", username="stranger-agent")
    other = APIClient()
    other.force_authenticate(user=stranger)
    assert other.get(f"{TOKENS_URL}{token.id}/").status_code == 404

    token.is_active = False
    token.save(update_fields=["is_active"])
    assert session_client.get(f"{TOKENS_URL}{token.id}/").status_code == 404
    token.is_active = True
    token.expired_at = timezone.now() - timedelta(days=1)
    token.save(update_fields=["is_active", "expired_at"])
    assert session_client.get(f"{TOKENS_URL}{token.id}/").status_code == 404

    plain = APIToken.objects.create(user=create_user, label="plain", workspace=workspace)
    assert session_client.get(f"{TOKENS_URL}{plain.id}/").status_code == 404  # not an MCP token
    assert session_client.get(TOKENS_URL).status_code == 405


def test_the_secret_cannot_be_read_with_an_api_key(session_client, workspace):
    created = create(session_client, workspace)
    token = APIToken.objects.get(pk=created["id"])
    # app endpoints only accept the signed-in session, an API key does not authenticate there
    assert api_client(token).get(f"{TOKENS_URL}{token.id}/").status_code in (401, 403)
