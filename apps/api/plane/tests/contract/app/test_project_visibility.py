"""A project admin sees exactly what any other member sees.

Nothing of the private projects they do not belong to and nothing of the workspaces they are not a member of."""

import json
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Cycle,
    Issue,
    IssueActivity,
    Label,
    Module,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
)

pytestmark = [pytest.mark.contract, pytest.mark.django_db]

SECRET = "TOPSECRET"


@pytest.fixture(autouse=True)
def background_tasks():
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield


@pytest.fixture
def scene(workspace, create_user):
    """create_user owns the workspace. `admin` is a workspace *member* who administers one project only."""
    admin = User.objects.create(email="project-admin@gizmo.so", username="project-admin", display_name="Project Admin")
    WorkspaceMember.objects.create(workspace=workspace, member=admin, role=15)

    own = Project.objects.create(name="Own project", identifier="OWN", workspace=workspace, network=0)
    ProjectMember.objects.create(project=own, member=admin, role=20)
    ProjectMember.objects.create(project=own, member=create_user, role=20)

    public = Project.objects.create(name="Public project", identifier="PUB", workspace=workspace, network=2)
    ProjectMember.objects.create(project=public, member=create_user, role=20)

    private = Project.objects.create(name=f"{SECRET} private project", identifier="SEC", workspace=workspace, network=0)
    ProjectMember.objects.create(project=private, member=create_user, role=20)
    state = State.objects.create(project=private, name=f"{SECRET} state", color="#123456")
    issue = Issue.objects.bulk_create(
        [
            Issue(
                project=private,
                workspace=workspace,
                state=state,
                name=f"{SECRET} issue",
                sequence_id=1,
                created_by=admin,
            )
        ]
    )[0]
    Cycle.objects.create(project=private, workspace=workspace, name=f"{SECRET} cycle", owned_by=create_user)
    Module.objects.create(project=private, workspace=workspace, name=f"{SECRET} module")
    Label.objects.create(project=private, workspace=workspace, name=f"{SECRET} label")
    IssueActivity.objects.create(
        issue=issue,
        project=private,
        workspace=workspace,
        actor=admin,
        verb="created",
        field="name",
        comment=f"{SECRET} activity",
    )

    # a former member keeps their old activity in the project they left
    ProjectMember.objects.create(project=private, member=admin, role=20, is_active=False)

    other_owner = User.objects.create(email="other-owner@gizmo.so", username="other-owner")
    other_workspace = Workspace.objects.create(name=f"{SECRET} workspace", slug="secret-workspace", owner=other_owner)
    WorkspaceMember.objects.create(workspace=other_workspace, member=other_owner, role=20)
    Project.objects.create(name=f"{SECRET} elsewhere", identifier="ELS", workspace=other_workspace, network=0)

    client = APIClient()
    client.force_authenticate(user=admin)
    return {
        "client": client,
        "admin": admin,
        "workspace": workspace,
        "own": own,
        "public": public,
        "private": private,
        "other_workspace": other_workspace,
    }


def dump(response):
    return json.dumps(response.data, default=str) if hasattr(response, "data") else response.content.decode()


def test_project_lists_contain_only_member_and_public_projects(scene):
    client, slug = scene["client"], scene["workspace"].slug
    for path in ("projects/", "projects/details/"):
        response = client.get(f"/api/workspaces/{slug}/{path}")
        assert response.status_code == 200
        ids = {str(item["id"]) for item in (response.data["results"] if "results" in response.data else response.data)}
        assert str(scene["private"].id) not in ids, path
        assert {str(scene["own"].id), str(scene["public"].id)} <= ids, path


def test_workspace_list_and_roles_only_cover_own_memberships(scene):
    client, slug = scene["client"], scene["workspace"].slug
    response = client.get("/api/users/me/workspaces/")
    assert response.status_code == 200
    assert [item["slug"] for item in response.data] == [slug]
    roles = client.get(f"/api/users/me/workspaces/{slug}/project-roles/")
    assert set(roles.data) == {str(scene["own"].id)}
    # the other workspace does not exist for this user
    assert client.get(f"/api/workspaces/{scene['other_workspace'].slug}/projects/").status_code in (403, 404)
    assert client.get(f"/api/workspaces/{scene['other_workspace'].slug}/members/").status_code in (403, 404)


@pytest.mark.parametrize(
    "path",
    [
        "projects/",
        "projects/details/",
        "project-stats/",
        "project-members/",
        "cycles/",
        "modules/",
        "states/",
        "labels/",
        "estimates/",
        "issues/",
        "views/",
        "user-favorites/",
        "recent-visits/",
        "analytics/?x_axis=priority&y_axis=issue_count",
        "default-analytics/",
        "search/?search=" + SECRET,
        "entity-search/?query=" + SECRET + "&count=10",
        "users/notifications/",
        "users/notifications/unread/",
    ],
)
def test_workspace_endpoints_never_leak_private_project_content(scene, path):
    client, slug = scene["client"], scene["workspace"].slug
    response = client.get(f"/api/workspaces/{slug}/{path}")
    assert response.status_code in (200, 400, 403, 404), (path, response.status_code)
    assert SECRET not in dump(response), path
    assert str(scene["private"].id) not in dump(response), path


def test_profile_endpoints_do_not_expose_activity_in_projects_the_viewer_cannot_access(scene, create_user):
    """create_user (workspace owner) opens the profile of `admin`; admin looks at the profile of create_user."""
    slug, admin = scene["workspace"].slug, scene["admin"]
    own_view = scene["client"]
    for user_id in (admin.id, create_user.id):
        for path in ("user-activity/{}/", "user-profile/{}/", "user-stats/{}/", "user-issues/{}/"):
            response = own_view.get(f"/api/workspaces/{slug}/{path.format(user_id)}")
            assert response.status_code in (200, 400, 403, 404), (path, response.status_code)
            assert SECRET not in dump(response), path
            assert str(scene["private"].id) not in dump(response), path


def test_public_api_and_mcp_endpoints_hide_private_projects_for_project_admin(scene):
    """The MCP server reads through the public API with a token of the project admin."""
    from plane.db.models import APIToken

    admin, slug = scene["admin"], scene["workspace"].slug
    token = APIToken.objects.create(user=admin, workspace=scene["workspace"], scopes=["read"], source="mcp")
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token, HTTP_X_MCP_TOOL="list_projects")

    projects = client.get(f"/api/v1/workspaces/{slug}/projects/")
    assert projects.status_code == 200
    names = {item["name"] for item in projects.json()["results"]}
    assert names == {"Own project", "Public project"}

    for path in (
        f"projects/{scene['private'].id}/",
        f"projects/{scene['private'].id}/work-items/",
        f"projects/{scene['private'].id}/time-budget/",
        "work-items/search/?search=" + SECRET,
        "issues/search/?search=" + SECRET,
        "time-report/",
    ):
        response = client.get(f"/api/v1/workspaces/{slug}/{path}")
        assert SECRET not in response.content.decode(), path
        if path.startswith("projects/"):
            assert response.status_code in (403, 404), (path, response.status_code)
