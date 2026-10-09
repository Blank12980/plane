# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest
from django.core.cache import cache
from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import APIToken, Issue, Project, ProjectMember, State, Workspace, WorkspaceMember


@pytest.fixture(autouse=True)
def no_background_tasks():
    with (
        patch("plane.db.mixins.soft_delete_related_objects.delay"),
        patch("plane.api.views.issue.issue_activity.delay"),
        patch("plane.api.views.issue.model_activity.delay"),
    ):
        yield


@pytest.fixture(autouse=True)
def clear_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Scoped", identifier="SC", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(project=project, workspace=workspace, name="Todo", group="unstarted", default=True)
    return project


@pytest.fixture
def issue(project):
    return Issue.objects.create(project=project, workspace=project.workspace, name="Scoped issue")


def token_client(user, workspace=None, scopes=None, rate=None):
    token = APIToken.objects.create(
        user=user,
        label="scoped",
        workspace=workspace,
        scopes=scopes or [],
        **({"allowed_rate_limit": rate} if rate else {}),
    )
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    return client


def issues_url(workspace, project):
    return f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/work-items/"


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceBinding:
    def test_bound_token_works_in_its_workspace(self, create_user, workspace, project):
        client = token_client(create_user, workspace=workspace)
        assert client.get(issues_url(workspace, project)).status_code == status.HTTP_200_OK

    def test_bound_token_is_rejected_in_another_workspace(self, create_user, workspace, project):
        other = Workspace.objects.create(name="Other", owner=create_user, slug="other-workspace")
        WorkspaceMember.objects.create(workspace=other, member=create_user, role=20)
        other_project = Project.objects.create(name="Other", identifier="OT", workspace=other)
        ProjectMember.objects.create(project=other_project, member=create_user, role=20)

        client = token_client(create_user, workspace=workspace)
        response = client.get(issues_url(other, other_project))
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "workspace" in response.data["detail"]

    def test_unbound_legacy_token_keeps_working_everywhere(self, create_user, workspace, project):
        client = token_client(create_user)
        assert client.get(issues_url(workspace, project)).status_code == status.HTTP_200_OK

    def test_bound_token_can_read_users_me(self, create_user, workspace):
        client = token_client(create_user, workspace=workspace, scopes=["read"])
        assert client.get("/api/v1/users/me/").status_code == status.HTTP_200_OK


@pytest.mark.contract
@pytest.mark.django_db
class TestTokenScopes:
    def test_read_scope_allows_get_and_blocks_writes(self, create_user, workspace, project):
        client = token_client(create_user, workspace=workspace, scopes=["read"])
        assert client.get(issues_url(workspace, project)).status_code == status.HTTP_200_OK

        response = client.post(issues_url(workspace, project), {"name": "Nope"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert "issues:write" in response.data["detail"]

    def test_write_scope_without_read_cannot_list(self, create_user, workspace, project):
        client = token_client(create_user, workspace=workspace, scopes=["issues:write"])
        assert client.get(issues_url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN

    def test_issues_write_allows_create_but_not_delete(self, create_user, workspace, project, issue):
        client = token_client(create_user, workspace=workspace, scopes=["read", "issues:write"])
        created = client.post(issues_url(workspace, project), {"name": "Agent task"}, format="json")
        assert created.status_code == status.HTTP_201_CREATED

        deleted = client.delete(f"{issues_url(workspace, project)}{issue.id}/")
        assert deleted.status_code == status.HTTP_403_FORBIDDEN
        assert "issues:delete" in deleted.data["detail"]

    def test_issues_delete_scope_allows_delete(self, create_user, workspace, project, issue):
        client = token_client(create_user, workspace=workspace, scopes=["read", "issues:delete"])
        response = client.delete(f"{issues_url(workspace, project)}{issue.id}/")
        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_comments_need_comments_scope(self, create_user, workspace, project, issue):
        url = f"{issues_url(workspace, project)}{issue.id}/comments/"
        payload = {"comment_html": "<p>hi</p>"}
        no_scope = token_client(create_user, workspace=workspace, scopes=["read", "issues:write"])
        assert no_scope.post(url, payload, format="json").status_code == status.HTTP_403_FORBIDDEN

        with patch("plane.api.views.issue.issue_activity.delay"):
            allowed = token_client(create_user, workspace=workspace, scopes=["read", "comments:write"])
            assert allowed.post(url, payload, format="json").status_code == status.HTTP_201_CREATED

    def test_unmapped_write_is_denied_for_scoped_tokens(self, create_user, workspace):
        client = token_client(create_user, workspace=workspace, scopes=["read", "issues:write"])
        response = client.post(
            f"/api/v1/workspaces/{workspace.slug}/projects/",
            {"name": "New", "identifier": "NEW"},
            format="json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_unmapped_write_still_works_for_legacy_tokens(self, create_user, workspace):
        client = token_client(create_user)
        response = client.post(
            f"/api/v1/workspaces/{workspace.slug}/projects/",
            {"name": "New", "identifier": "NEW"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED

    def test_scopes_do_not_grant_more_than_the_role(self, workspace, project, issue):
        from plane.db.models import User

        guest = User.objects.create(email="guest@gizmo.so", username="guest", first_name="Guest")
        WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
        ProjectMember.objects.create(project=project, member=guest, role=5)
        client = token_client(guest, workspace=workspace, scopes=["read", "issues:write", "issues:delete"])
        response = client.delete(f"{issues_url(workspace, project)}{issue.id}/")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
@pytest.mark.django_db
class TestTokenRateLimit:
    def test_token_rate_limit_is_enforced(self, create_user, workspace, project):
        client = token_client(create_user, workspace=workspace, scopes=["read"], rate="2/min")
        url = issues_url(workspace, project)
        assert client.get(url).status_code == status.HTTP_200_OK
        assert client.get(url).status_code == status.HTTP_200_OK
        assert client.get(url).status_code == status.HTTP_429_TOO_MANY_REQUESTS


@pytest.mark.contract
@pytest.mark.django_db
class TestApiTokenAppEndpoint:
    def test_create_scoped_bound_token(self, session_client, workspace):
        response = session_client.post(
            "/api/users/api-tokens/",
            {"label": "agent", "scopes": ["issues:write", "read"], "workspace_slug": workspace.slug},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["scopes"] == ["read", "issues:write"]
        assert str(response.data["workspace"]) == str(workspace.id)

    def test_unknown_scope_is_rejected(self, session_client):
        response = session_client.post("/api/users/api-tokens/", {"scopes": ["mail:send"]}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_foreign_workspace_is_rejected(self, session_client, create_user):
        from plane.db.models import User

        owner = User.objects.create(email="owner@gizmo.so", username="owner")
        Workspace.objects.create(name="Foreign", owner=owner, slug="foreign")
        response = session_client.post("/api/users/api-tokens/", {"workspace_slug": "foreign"}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_rate_limit_and_service_flag_are_read_only(self, session_client, create_api_token_for_user):
        response = session_client.patch(
            f"/api/users/api-tokens/{create_api_token_for_user.id}/",
            {"allowed_rate_limit": "100000/min", "is_service": True},
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK
        create_api_token_for_user.refresh_from_db()
        assert create_api_token_for_user.allowed_rate_limit == "60/min"
        assert create_api_token_for_user.is_service is False


@pytest.mark.contract
@pytest.mark.django_db
def test_create_agent_token_command(workspace, project, capsys):
    call_command(
        "create_agent_token",
        email="agent@gizmo.so",
        workspace=workspace.slug,
        scopes="read,worklogs:write",
        rate_limit="30/min",
        create_bot=True,
        projects=project.identifier,
    )
    token = APIToken.objects.get(user__email="agent@gizmo.so")
    assert token.user.is_bot
    assert token.workspace_id == workspace.id
    assert token.scopes == ["read", "worklogs:write"]
    assert token.allowed_rate_limit == "30/min"
    assert token.expired_at is not None
    assert ProjectMember.objects.filter(project=project, member=token.user, role=15).exists()
    assert token.token in capsys.readouterr().out
