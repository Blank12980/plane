# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest

from plane.db.models import (
    Project,
    ProjectMember,
    ProjectMemberInvite,
    ProjectUserProperty,
    User,
    WorkspaceMember,
)


pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def privacy_projects(workspace, create_user):
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)
    public = Project.objects.create(workspace=workspace, name="Public", identifier="PUB", network=2)
    private = Project.objects.create(workspace=workspace, name="Private", identifier="PVT", network=0)
    joined = Project.objects.create(workspace=workspace, name="Joined", identifier="JOIN", network=0)
    ProjectMember.objects.create(project=joined, member=create_user, role=15)
    return public, private, joined


@pytest.mark.parametrize("suffix", ["", "details/"])
def test_project_lists_follow_visibility_rules(session_client, workspace, privacy_projects, suffix):
    public, private, joined = privacy_projects
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{suffix}")
    assert response.status_code == 200
    assert {project["id"] for project in response.json()} == {str(public.id), str(joined.id)}
    assert str(private.id) not in {project["id"] for project in response.json()}
    discovered = next(project for project in response.json() if project["id"] == str(public.id))
    assert "members" not in discovered
    assert "next_work_item_sequence" not in discovered


@pytest.mark.parametrize("network", [0, 2])
@pytest.mark.parametrize("suffix", ["", "members/", "project-deploy-boards/", "project-members/me/"])
def test_non_members_cannot_read_project_api(session_client, workspace, privacy_projects, network, suffix):
    project = next(project for project in privacy_projects[:2] if project.network == network)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/{suffix}")
    assert response.status_code == 403


def test_non_member_cannot_publish_or_add_project_members(session_client, workspace, privacy_projects, create_user):
    public, *_ = privacy_projects
    base = f"/api/workspaces/{workspace.slug}/projects/{public.id}/"
    assert session_client.post(base + "project-deploy-boards/", {}, format="json").status_code == 403
    assert (
        session_client.post(
            base + "members/", {"members": [{"member_id": str(create_user.id), "role": 20}]}, format="json"
        ).status_code
        == 403
    )


@pytest.mark.parametrize("project_index", [0, 1])
def test_self_join_requires_invitation(session_client, workspace, privacy_projects, project_index):
    project = privacy_projects[project_index]
    response = session_client.post(
        f"/api/users/me/workspaces/{workspace.slug}/projects/invitations/",
        {"project_ids": [str(project.id)]},
        format="json",
    )
    assert response.status_code == 403
    assert not ProjectMember.objects.filter(project=project, member__email="test@gizmo.so").exists()


def test_workspace_admin_can_open_private_project_without_joining(
    session_client, workspace, privacy_projects, create_user, monkeypatch
):
    _, private, _ = privacy_projects
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=20)
    monkeypatch.setattr("plane.app.views.project.base.recent_visited_task.delay", lambda **kwargs: None)
    response = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{private.id}/")
    assert response.status_code == 200
    assert response.json()["id"] == str(private.id)
    assert not ProjectMember.objects.filter(project=private, member=create_user).exists()


def test_admin_join_rejects_project_from_another_workspace(session_client, workspace):
    response = session_client.post(
        f"/api/users/me/workspaces/{workspace.slug}/projects/invitations/",
        {"project_ids": [str(uuid4())]},
        format="json",
    )
    assert response.status_code == 400


def make_invitation(workspace, project, user):
    return ProjectMemberInvite.objects.create(
        workspace=workspace,
        project=project,
        email=user.email,
        role=15,
        token=uuid4().hex,
    )


def invitation_url(workspace, project, invitation):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/join/{invitation.id}/"


def test_invitation_recipient_can_join_a_private_project(session_client, workspace, privacy_projects, create_user):
    _, private, _ = privacy_projects
    invitation = make_invitation(workspace, private, create_user)
    response = session_client.post(invitation_url(workspace, private, invitation), {"accepted": True}, format="json")
    assert response.status_code == 200
    assert ProjectMember.objects.filter(project=private, member=create_user, is_active=True, role=15).exists()
    assert ProjectUserProperty.objects.filter(project=private, user=create_user).exists()
    invitation.refresh_from_db()
    assert invitation.accepted and invitation.responded_at is not None


def test_invitation_cannot_be_accepted_by_spoofing_recipient_email(
    session_client, workspace, privacy_projects, create_user
):
    _, private, _ = privacy_projects
    recipient = User.objects.create_user(email="recipient@example.com", username="recipient")
    invitation = make_invitation(workspace, private, recipient)
    url = invitation_url(workspace, private, invitation)
    assert session_client.get(url).status_code == 404
    response = session_client.post(url, {"email": recipient.email, "accepted": True}, format="json")
    assert response.status_code == 404
    assert not ProjectMember.objects.filter(project=private, member=create_user).exists()
    invitation.refresh_from_db()
    assert invitation.responded_at is None


def test_leave_revokes_access_and_consumed_invitation_cannot_rejoin(
    session_client, workspace, privacy_projects, create_user
):
    _, private, _ = privacy_projects
    invitation = make_invitation(workspace, private, create_user)
    url = invitation_url(workspace, private, invitation)
    assert session_client.post(url, {"accepted": True}, format="json").status_code == 200
    base = f"/api/workspaces/{workspace.slug}/projects/{private.id}/"
    assert session_client.post(base + "members/leave/", {}, format="json").status_code == 204
    assert not ProjectMember.objects.filter(project=private, member=create_user, is_active=True).exists()
    assert session_client.get(base).status_code == 403
    assert session_client.post(url, {"accepted": True}, format="json").status_code == 400
    fresh_invitation = make_invitation(workspace, private, create_user)
    assert (
        session_client.post(
            invitation_url(workspace, private, fresh_invitation), {"accepted": True}, format="json"
        ).status_code
        == 200
    )


def test_last_project_admin_must_transfer_role_before_leaving(session_client, workspace, privacy_projects, create_user):
    _, _, joined = privacy_projects
    ProjectMember.objects.filter(project=joined, member=create_user).update(role=20)
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/projects/{joined.id}/members/leave/", {}, format="json"
    )
    assert response.status_code == 400
    assert ProjectMember.objects.filter(project=joined, member=create_user, is_active=True).exists()


@pytest.mark.parametrize("network", [0, 2])
@pytest.mark.parametrize("suffix", ["", "summary/", "members/"])
def test_api_key_cannot_access_projects_without_membership(
    api_key_client, workspace, privacy_projects, network, suffix
):
    project = next(project for project in privacy_projects[:2] if project.network == network)
    response = api_key_client.get(f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/{suffix}")
    assert response.status_code == 403


def test_regular_members_cannot_bypass_project_admin_checks_with_put(
    session_client, workspace, privacy_projects, create_user
):
    _, _, joined = privacy_projects
    response = session_client.put(
        f"/api/workspaces/{workspace.slug}/projects/{joined.id}/",
        {"name": "Unauthorized rename", "identifier": "JOIN", "network": 2},
        format="json",
    )
    assert response.status_code == 403
    joined.refresh_from_db()
    assert joined.name == "Joined" and joined.network == 0
