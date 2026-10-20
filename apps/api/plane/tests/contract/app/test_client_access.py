# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from plane.db.models import (
    ClientAccessGrant,
    FileAsset,
    Issue,
    IssueComment,
    Page,
    Project,
    ProjectMember,
    ProjectPage,
    User,
    WorkspaceMember,
)


pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture
def client_scope(workspace, create_user, monkeypatch):
    monkeypatch.setattr("celery.app.task.Task.apply_async", lambda *args, **kwargs: None)
    client = User.objects.create_user(email="client@example.com", username="client")
    membership = WorkspaceMember.objects.create(workspace=workspace, member=client, role=3)
    project = Project.objects.create(workspace=workspace, name="Shared project", identifier="CLI", network=2)
    issues = [
        Issue(project=project, workspace=workspace, name=name, sequence_id=index, description_html=f"<p>{name}</p>")
        for index, name in enumerate(["Shared task", "Secret task"], start=1)
    ]
    Issue.objects.bulk_create(issues)
    pages = [
        Page(workspace=workspace, owned_by=create_user, name=name, access=1, description_html=f"<p>{name}</p>")
        for name in ("Shared page", "Secret page")
    ]
    Page.objects.bulk_create(pages)
    ProjectPage.objects.bulk_create([ProjectPage(workspace=workspace, project=project, page=page) for page in pages])
    browser = APIClient()
    browser.force_authenticate(user=client)
    return client, membership, project, issues, pages, browser


def grant_url(workspace, client):
    return f"/api/workspaces/{workspace.slug}/clients/{client.id}/access/"


def resources_url(workspace):
    return f"/api/workspaces/{workspace.slug}/client-resources/"


def test_client_starts_with_no_access_even_with_project_membership(workspace, client_scope):
    client, _, project, _, _, browser = client_scope
    ProjectMember.objects.create(project=project, member=client, role=20)
    assert browser.get(resources_url(workspace)).json() == []
    assert browser.get(f"/api/workspaces/{workspace.slug}/projects/").status_code == 403
    assert browser.get(f"/api/v1/workspaces/{workspace.slug}/projects/").status_code in (401, 403)


@pytest.mark.parametrize("kind", ["issue", "page"])
def test_admin_grants_one_resource_without_exposing_siblings(session_client, workspace, client_scope, kind):
    client, _, project, issues, pages, browser = client_scope
    resource = issues[0] if kind == "issue" else pages[0]
    response = session_client.post(
        grant_url(workspace, client),
        {
            "resource_type": kind,
            "resource_id": str(resource.id),
            "project_id": str(project.id),
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    grant_id = response.json()["id"]
    listing = browser.get(resources_url(workspace))
    assert listing.status_code == 200
    assert [item["resource_id"] for item in listing.json()] == [str(resource.id)]
    detail = browser.get(resources_url(workspace) + grant_id + "/")
    assert detail.status_code == 200, detail.data
    assert detail.json()["description_html"] == resource.description_html
    assert "Secret" not in str(detail.json())
    # Direct routes cannot expose project totals, relations or other resources.
    assert browser.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/").status_code == 403
    assert (
        browser.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/issues/{issues[1].id}/").status_code == 403
    )
    assert (
        browser.get(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/{pages[1].id}/description/"
        ).status_code
        == 403
    )
    assert session_client.delete(grant_url(workspace, client) + grant_id + "/").status_code == 204
    assert browser.get(resources_url(workspace)).json() == []
    assert browser.get(resources_url(workspace) + grant_id + "/").status_code == 404


def test_admin_can_search_and_page_resources(session_client, workspace, client_scope):
    client, _, project, issues, _, _ = client_scope
    response = session_client.get(
        grant_url(workspace, client), {"type": "issue", "search": "Shared", "project_id": str(project.id)}
    )
    assert response.status_code == 200, response.data
    assert [item["resource_id"] for item in response.json()["resources"]] == [str(issues[0].id)]


def test_client_cannot_grant_access_or_read_another_clients_grant(workspace, client_scope):
    client, _, project, issues, _, browser = client_scope
    assert browser.post(grant_url(workspace, client), {}, format="json").status_code == 403
    other = User.objects.create_user(email="other-client@example.com", username="other-client")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=3)
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=other, issue=issues[0])
    assert browser.get(resources_url(workspace) + str(grant.id) + "/").status_code == 404


@pytest.mark.parametrize("method", ["post", "patch", "delete"])
def test_client_resource_endpoint_is_read_only(workspace, client_scope, method):
    client, _, project, issues, _, browser = client_scope
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, issue=issues[0])
    assert (
        getattr(browser, method)(resources_url(workspace) + str(grant.id) + "/", {}, format="json").status_code == 403
    )


def test_project_members_cannot_assign_clients_or_grant_resources(session_client, workspace, create_user, client_scope):
    client, *_ = client_scope
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=15)
    assert session_client.post(grant_url(workspace, client), {}, format="json").status_code == 403
    assert (
        session_client.post(
            f"/api/workspaces/{workspace.slug}/invitations/",
            {
                "emails": [{"email": "new@example.com", "role": 3}],
            },
            format="json",
        ).status_code
        == 403
    )


def test_assigning_client_revokes_prior_memberships(session_client, workspace, client_scope):
    client, membership, project, _, _, browser = client_scope
    WorkspaceMember.objects.filter(pk=membership.pk).update(role=15)
    project_member = ProjectMember.objects.create(project=project, member=client, role=20)
    assert (
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/members/{membership.id}/", {"role": 3}, format="json"
        ).status_code
        == 200
    )
    project_member.refresh_from_db()
    assert project_member.role == 3 and not project_member.is_active
    assert browser.get(resources_url(workspace)).json() == []


def test_grant_cannot_reference_resource_from_another_project(session_client, workspace, client_scope):
    client, _, _, issues, _, _ = client_scope
    another = Project.objects.create(workspace=workspace, name="Other", identifier="OTHER")
    response = session_client.post(
        grant_url(workspace, client),
        {
            "resource_type": "issue",
            "resource_id": str(issues[0].id),
            "project_id": str(another.id),
        },
        format="json",
    )
    assert response.status_code == 404
    assert not ClientAccessGrant.objects.exists()


def test_leaving_workspace_or_unlinking_page_revokes_access(workspace, client_scope):
    client, membership, project, _, pages, browser = client_scope
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, page=pages[0])
    ProjectPage.objects.filter(page=pages[0], project=project).delete()
    assert browser.get(resources_url(workspace) + str(grant.id) + "/").status_code == 404
    WorkspaceMember.objects.filter(pk=membership.pk).update(is_active=False)
    assert browser.get(resources_url(workspace)).status_code == 403


def test_client_files_require_the_specific_grant_and_hide_internal_comments(workspace, client_scope):
    from plane.utils.project_access import require_asset_access

    client, _, project, issues, _, _ = client_scope
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, issue=issues[0])
    shared = FileAsset(workspace=workspace, project=project, issue=issues[0], entity_type="ISSUE_ATTACHMENT")
    secret = FileAsset(workspace=workspace, project=project, issue=issues[1], entity_type="ISSUE_ATTACHMENT")
    internal = IssueComment(workspace=workspace, project=project, issue=issues[0], access="INTERNAL")
    comment_file = FileAsset(workspace=workspace, project=project, comment=internal, entity_type="COMMENT_ATTACHMENT")
    require_asset_access(client, workspace.slug, shared)
    with pytest.raises(PermissionDenied):
        require_asset_access(client, workspace.slug, secret)
    with pytest.raises(PermissionDenied):
        require_asset_access(client, workspace.slug, comment_file)
    grant.delete()
    with pytest.raises(PermissionDenied):
        require_asset_access(client, workspace.slug, shared)


def test_client_sees_only_external_comments_and_authorized_files(workspace, client_scope, create_user, monkeypatch):
    client, _, project, issues, _, browser = client_scope
    grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, issue=issues[0])
    IssueComment.objects.bulk_create(
        [
            IssueComment(
                workspace=workspace,
                project=project,
                issue=issues[0],
                actor=create_user,
                access=access,
                comment_html=f"<p>{access}</p>",
            )
            for access in ("INTERNAL", "EXTERNAL")
        ]
    )
    assets = [
        FileAsset(
            workspace=workspace,
            project=project,
            issue=issue,
            asset=f"test/{issue.id}.txt",
            entity_type="ISSUE_ATTACHMENT",
            is_uploaded=True,
            attributes={"name": "File.txt"},
        )
        for issue in issues
    ]
    FileAsset.objects.bulk_create(assets)
    response = browser.get(resources_url(workspace) + str(grant.id) + "/")
    assert response.status_code == 200
    assert [comment["html"] for comment in response.json()["comments"]] == ["<p>EXTERNAL</p>"]
    assert [asset["id"] for asset in response.json()["attachments"]] == [str(assets[0].id)]

    class Storage:
        def __init__(self, **kwargs):
            pass

        def generate_presigned_url(self, **kwargs):
            return "https://files.example/shared-file"

    monkeypatch.setattr("plane.app.views.workspace.client_access.S3Storage", Storage)
    base = resources_url(workspace) + str(grant.id) + "/files/"
    assert browser.get(base + str(assets[0].id) + "/").status_code == 302
    assert browser.get(base + str(assets[1].id) + "/").status_code == 403
    grant.delete()
    assert browser.get(base + str(assets[0].id) + "/").status_code in (403, 404)


def test_client_cannot_join_projects_with_old_invitations(workspace, client_scope):
    from plane.db.models import ProjectMemberInvite

    client, _, project, _, _, browser = client_scope
    invitation = ProjectMemberInvite.objects.create(
        workspace=workspace, project=project, email=client.email, token="old", role=15
    )
    response = browser.post(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/join/{invitation.id}/",
        {"accepted": True},
        format="json",
    )
    assert response.status_code == 403
    assert not ProjectMember.objects.filter(member=client, project=project).exists()


def test_client_cannot_join_collaboration_for_a_shared_page(workspace, client_scope):
    client, _, project, _, pages, browser = client_scope
    ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, page=pages[0])
    response = browser.get(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/pages/{pages[0].id}/collaboration-access/"
    )
    assert response.status_code == 403


# -- who may configure the clients -------------------------------------------------------------------------------


def clients_url(workspace):
    return f"/api/workspaces/{workspace.slug}/clients/"


def user_client(user):
    browser = APIClient()
    browser.force_authenticate(user=user)
    return browser


@pytest.fixture
def two_projects(workspace, create_user, client_scope):
    """`project_admin` administers the shared project only; a second private project has its own task and grant."""
    client, _, project, issues, pages, _ = client_scope
    project_admin = User.objects.create_user(email="project-admin@example.com", username="project-admin")
    WorkspaceMember.objects.create(workspace=workspace, member=project_admin, role=15)
    ProjectMember.objects.create(project=project, member=project_admin, role=20)
    other = Project.objects.create(workspace=workspace, name="Private project", identifier="PRV", network=0)
    ProjectMember.objects.create(project=other, member=create_user, role=20)
    other_issue = Issue.objects.bulk_create(
        [Issue(project=other, workspace=workspace, name="Private task", sequence_id=1)]
    )[0]
    own_grant = ClientAccessGrant.objects.create(workspace=workspace, project=project, client=client, issue=issues[0])
    other_grant = ClientAccessGrant.objects.create(workspace=workspace, project=other, client=client, issue=other_issue)
    return client, project_admin, project, other, own_grant, other_grant


def test_project_admin_manages_clients_of_their_project_only(workspace, two_projects):
    client, project_admin, project, other, own_grant, other_grant = two_projects
    browser = user_client(project_admin)

    listing = browser.get(clients_url(workspace), {"project_id": str(project.id)})
    assert listing.status_code == 200, listing.data
    assert listing.json()["project"]["id"] == str(project.id)
    assert [(item["id"], item["issue_count"]) for item in listing.json()["clients"]] == [(str(client.id), 1)]

    access = browser.get(grant_url(workspace, client), {"project_id": str(project.id)})
    assert access.status_code == 200
    assert [grant["id"] for grant in access.json()["grants"]] == [str(own_grant.id)]
    assert [item["id"] for item in access.json()["projects"]] == [str(project.id)]

    # nothing beyond the administered project
    assert browser.get(clients_url(workspace)).status_code == 403
    assert browser.get(grant_url(workspace, client)).status_code == 403
    assert browser.get(clients_url(workspace), {"project_id": str(other.id)}).status_code == 403
    assert browser.get(grant_url(workspace, client), {"project_id": str(other.id)}).status_code == 403


def test_project_admin_grants_and_revokes_inside_their_project_only(workspace, two_projects, client_scope):
    client, project_admin, project, other, own_grant, other_grant = two_projects
    _, _, _, issues, pages, _ = client_scope
    browser = user_client(project_admin)

    created = browser.post(
        grant_url(workspace, client),
        {"resource_type": "page", "resource_id": str(pages[0].id), "project_id": str(project.id)},
        format="json",
    )
    assert created.status_code == 201, created.data

    outside = browser.post(
        grant_url(workspace, client),
        {"resource_type": "issue", "resource_id": str(other_grant.issue_id), "project_id": str(other.id)},
        format="json",
    )
    assert outside.status_code == 403

    assert browser.delete(grant_url(workspace, client) + f"{other_grant.id}/").status_code == 403
    assert ClientAccessGrant.objects.filter(pk=other_grant.pk).exists()
    assert browser.delete(grant_url(workspace, client) + f"{own_grant.id}/").status_code == 204
    assert not ClientAccessGrant.objects.filter(pk=own_grant.pk).exists()


def test_workspace_admin_sees_workspace_and_every_project(session_client, workspace, two_projects):
    client, _, project, other, *_ = two_projects
    everything = session_client.get(clients_url(workspace))
    assert everything.status_code == 200
    assert everything.json()["project"] is None
    assert everything.json()["clients"][0]["issue_count"] == 2
    for scoped in (project, other):
        listing = session_client.get(clients_url(workspace), {"project_id": str(scoped.id)})
        assert listing.status_code == 200
        assert listing.json()["clients"][0]["issue_count"] == 1


def test_instance_admin_manages_clients_in_every_workspace_and_project(workspace, two_projects):
    from django.utils import timezone

    from plane.license.models import Instance, InstanceAdmin

    client, _, project, other, *_ = two_projects
    superuser = User.objects.create_user(email="instance-admin@example.com", username="instance-admin")
    instance = Instance.objects.create(
        instance_name="Clients instance",
        instance_id="clients-instance",
        current_version="test",
        last_checked_at=timezone.now(),
    )
    InstanceAdmin.objects.create(instance=instance, user=superuser, role=20)
    browser = user_client(superuser)
    assert browser.get(clients_url(workspace)).status_code == 200
    for scoped in (project, other):
        assert browser.get(clients_url(workspace), {"project_id": str(scoped.id)}).status_code == 200


def test_plain_members_guests_and_clients_cannot_open_client_settings(workspace, two_projects):
    client, _, project, *_ = two_projects
    for role in (15, 5):
        user = User.objects.create_user(email=f"role-{role}@example.com", username=f"role-{role}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
        ProjectMember.objects.create(project=project, member=user, role=role)
        browser = user_client(user)
        assert browser.get(clients_url(workspace), {"project_id": str(project.id)}).status_code == 403
        assert browser.get(clients_url(workspace)).status_code == 403
    assert user_client(client).get(clients_url(workspace), {"project_id": str(project.id)}).status_code == 403
