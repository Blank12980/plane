# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# ruff: noqa: F811  (the fixtures are imported from test_client_access and used as test arguments)

from uuid import uuid4

import pytest

from plane.db.models import (
    ClientAccessGrant,
    Issue,
    Project,
    ProjectClient,
    ProjectMember,
    User,
    WorkspaceMember,
)
from plane.tests.contract.app.test_client_access import (  # noqa: F401  (the fixtures are reused)
    client_scope,
    clients_url,
    grant_url,
    user_client,
)

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


def links_url(workspace, client_id=None):
    suffix = f"{client_id}/" if client_id else ""
    return f"/api/workspaces/{workspace.slug}/clients/project-links/{suffix}"


def candidates_url(workspace):
    return f"/api/workspaces/{workspace.slug}/clients/candidates/"


@pytest.fixture
def second_client(workspace):
    user = User.objects.create_user(email="second-client@example.com", username="second-client")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=3)
    return user


def project_clients(browser, workspace, project):
    response = browser.get(clients_url(workspace), {"project_id": str(project.id)})
    assert response.status_code == 200, response.content
    return [item["id"] for item in response.json()["clients"]]


def add(browser, workspace, project, **body):
    return browser.post(links_url(workspace), {"project_id": str(project.id), **body}, format="json")


def test_a_project_lists_only_the_clients_that_were_added_to_it(session_client, workspace, client_scope, second_client):
    client, _, project, *_ = client_scope
    assert project_clients(session_client, workspace, project) == []
    # the workspace level still lists every client
    everyone = {item["id"] for item in session_client.get(clients_url(workspace)).json()["clients"]}
    assert everyone == {str(client.id), str(second_client.id)}

    found = session_client.get(candidates_url(workspace), {"project_id": str(project.id)}).json()
    assert {item["id"] for item in found["clients"]} == {str(client.id), str(second_client.id)}

    response = add(session_client, workspace, project, client_ids=[str(client.id)])
    assert response.status_code == 201, response.content
    assert response.json() == {"linked": 1, "promoted": 0}
    assert project_clients(session_client, workspace, project) == [str(client.id)]
    found = session_client.get(candidates_url(workspace), {"project_id": str(project.id)}).json()
    assert [item["id"] for item in found["clients"]] == [str(second_client.id)]
    # adding twice does not duplicate
    assert add(session_client, workspace, project, client_ids=[str(client.id)]).json()["linked"] == 0
    assert ProjectClient.objects.filter(project=project, client=client).count() == 1


def test_a_project_admin_adds_and_removes_clients_in_their_own_project_only(workspace, create_user, client_scope):
    client, _, project, issues, *_ = client_scope
    admin = User.objects.create_user(email="proj-admin@example.com", username="proj-admin")
    WorkspaceMember.objects.create(workspace=workspace, member=admin, role=15)
    ProjectMember.objects.create(project=project, member=admin, role=20)
    other = Project.objects.create(workspace=workspace, name="Closed", identifier="CLS", network=0)
    ProjectMember.objects.create(project=other, member=create_user, role=20)
    browser = user_client(admin)

    assert add(browser, workspace, project, client_ids=[str(client.id)]).status_code == 201
    assert add(browser, workspace, other, client_ids=[str(client.id)]).status_code == 403
    assert browser.get(candidates_url(workspace), {"project_id": str(other.id)}).status_code == 403
    assert browser.post(links_url(workspace), {"client_ids": [str(client.id)]}, format="json").status_code in (400, 403)

    # a project admin cannot change workspace roles, so there are no members to promote
    found = browser.get(candidates_url(workspace), {"project_id": str(project.id)}).json()
    assert found["members"] == [] and found["can_promote"] is False
    plain = User.objects.create_user(email="plain@example.com", username="plain")
    WorkspaceMember.objects.create(workspace=workspace, member=plain, role=15)
    assert add(browser, workspace, project, promote_member_ids=[str(plain.id)]).status_code == 403
    assert WorkspaceMember.objects.get(workspace=workspace, member=plain).role == 15

    # removing a client closes what was shared in this project, but not in other projects
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, issue=issues[0])
    other_issue = Issue.objects.bulk_create([Issue(project=other, workspace=workspace, name="X", sequence_id=1)])[0]
    other_grant = ClientAccessGrant.objects.create(workspace=workspace, project=other, client=client, issue=other_issue)
    assert browser.delete(links_url(workspace, client.id) + f"?project_id={other.id}").status_code == 403
    assert browser.delete(links_url(workspace, client.id) + f"?project_id={project.id}").status_code == 204
    assert not ClientAccessGrant.objects.filter(pk=grant.pk).exists()
    assert ClientAccessGrant.objects.filter(pk=other_grant.pk).exists()
    assert not ProjectClient.objects.filter(project=project, client=client).exists()
    assert project_clients(browser, workspace, project) == []


def test_workspace_admin_can_turn_a_member_into_a_client_of_the_project(session_client, workspace, client_scope):
    _, _, project, *_ = client_scope
    member = User.objects.create_user(email="becomes-client@example.com", username="becomes-client")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    project_member = ProjectMember.objects.create(project=project, member=member, role=15)
    other_admin = User.objects.create_user(email="other-admin@example.com", username="other-admin")
    WorkspaceMember.objects.create(workspace=workspace, member=other_admin, role=20)

    found = session_client.get(candidates_url(workspace), {"project_id": str(project.id)}).json()
    offered = {item["id"] for item in found["members"]}
    assert str(member.id) in offered and str(other_admin.id) not in offered
    assert found["can_promote"] is True

    response = add(session_client, workspace, project, promote_member_ids=[str(member.id)])
    assert response.status_code == 201, response.content
    assert response.json() == {"linked": 1, "promoted": 1}
    assert WorkspaceMember.objects.get(workspace=workspace, member=member).role == 3
    project_member.refresh_from_db()
    assert project_member.is_active is False
    assert project_clients(session_client, workspace, project) == [str(member.id)]

    # administrators and unknown users cannot be promoted
    for victim in (other_admin.id, uuid4()):
        assert add(session_client, workspace, project, promote_member_ids=[str(victim)]).status_code == 400


def test_sharing_with_a_client_adds_them_to_the_project(session_client, workspace, client_scope):
    client, _, project, issues, *_ = client_scope
    assert not ProjectClient.objects.filter(project=project, client=client).exists()
    response = session_client.post(
        grant_url(workspace, client),
        {"resource_type": "issue", "resource_id": str(issues[0].id), "project_id": str(project.id)},
        format="json",
    )
    assert response.status_code == 201
    assert ProjectClient.objects.filter(project=project, client=client).exists()


def test_adding_clients_validates_the_request(session_client, workspace, client_scope):
    client, _, project, *_ = client_scope
    plain = User.objects.create_user(email="not-a-client@example.com", username="not-a-client")
    WorkspaceMember.objects.create(workspace=workspace, member=plain, role=15)
    assert add(session_client, workspace, project).status_code == 400
    assert add(session_client, workspace, project, client_ids=[str(plain.id)]).status_code == 400
    bad_project = session_client.post(
        links_url(workspace), {"project_id": "nope", "client_ids": [str(client.id)]}, format="json"
    )
    assert bad_project.status_code == 400
    unknown = session_client.post(
        links_url(workspace), {"project_id": str(uuid4()), "client_ids": [str(client.id)]}, format="json"
    )
    assert unknown.status_code in (403, 404)
