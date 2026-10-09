# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    FileAsset,
    Issue,
    IssueTag,
    Project,
    ProjectMember,
    State,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceTag,
)


@pytest.fixture(autouse=True)
def no_background_cascade():
    # Soft deletes enqueue a celery cascade, which needs a broker that tests do not have.
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield


def make_member(workspace, email, role):
    user = User.objects.create(
        email=email, username=email.split("@")[0], first_name="Member", last_name=email.split("@")[0]
    )
    user.set_password("test-password")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def tags_url(workspace):
    return f"/api/workspaces/{workspace.slug}/tags/"


@pytest.fixture
def issue(workspace, create_user):
    project = Project.objects.create(name="Tagged", identifier="TG", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="Todo", color="#123456")
    return Issue.objects.bulk_create(
        [Issue(project=project, workspace=workspace, state=state, name="T", sequence_id=1)]
    )[0]


@pytest.mark.contract
@pytest.mark.django_db
def test_admin_creates_updates_and_deletes_tag(session_client, workspace, tags_url):
    created = session_client.post(tags_url, {"name": "  Срочно ", "color": "#ff0000"}, format="json")
    assert created.status_code == 201
    assert created.data["name"] == "Срочно"
    assert created.data["image_url"] is None
    tag_id = created.data["id"]

    # colour and image are optional
    assert session_client.post(tags_url, {"name": "Без цвета"}, format="json").status_code == 201

    listed = session_client.get(tags_url)
    assert [tag["name"] for tag in listed.data] == ["Без цвета", "Срочно"]

    updated = session_client.patch(f"{tags_url}{tag_id}/", {"color": ""}, format="json")
    assert updated.status_code == 200
    assert updated.data["color"] == ""

    assert session_client.delete(f"{tags_url}{tag_id}/").status_code == 204
    assert [tag["name"] for tag in session_client.get(tags_url).data] == ["Без цвета"]
    # the name can be reused once the old tag is gone
    assert session_client.post(tags_url, {"name": "Срочно"}, format="json").status_code == 201


@pytest.mark.contract
@pytest.mark.django_db
def test_tag_names_are_unique_per_workspace_ignoring_case_and_colours_are_validated(
    session_client, workspace, create_user, tags_url
):
    assert session_client.post(tags_url, {"name": "Backend"}, format="json").status_code == 201
    assert session_client.post(tags_url, {"name": "backend"}, format="json").status_code == 400
    assert session_client.post(tags_url, {"name": "   "}, format="json").status_code == 400
    assert session_client.post(tags_url, {"name": "Bad", "color": "red"}, format="json").status_code == 400
    assert session_client.post(tags_url, {"name": "Short", "color": "#abc"}, format="json").status_code == 201

    # the same name is fine in another workspace
    other = Workspace.objects.create(name="Other", owner=create_user, slug="other-workspace")
    WorkspaceMember.objects.create(workspace=other, member=create_user, role=20)
    assert (
        session_client.post(f"/api/workspaces/{other.slug}/tags/", {"name": "Backend"}, format="json").status_code
        == 201
    )

    # renaming a tag to its own name is not a conflict, renaming onto another tag is
    tag = WorkspaceTag.objects.get(workspace=workspace, name="Backend")
    assert session_client.patch(f"{tags_url}{tag.id}/", {"name": "Backend"}, format="json").status_code == 200
    assert session_client.patch(f"{tags_url}{tag.id}/", {"name": "short"}, format="json").status_code == 400


@pytest.mark.contract
@pytest.mark.django_db
def test_only_admins_manage_tags_but_every_member_can_read_them(session_client, workspace, tags_url):
    tag = session_client.post(tags_url, {"name": "Shared"}, format="json").data
    member = client_for(make_member(workspace, "member@gizmo.so", 15))
    guest = client_for(make_member(workspace, "guest@gizmo.so", 5))

    for client in (member, guest):
        assert [item["name"] for item in client.get(tags_url).data] == ["Shared"]
        assert client.post(tags_url, {"name": "Nope"}, format="json").status_code == 403
        assert client.patch(f"{tags_url}{tag['id']}/", {"name": "Nope"}, format="json").status_code == 403
        assert client.delete(f"{tags_url}{tag['id']}/").status_code == 403

    outsider = User.objects.create(email="outsider@gizmo.so", username="outsider")
    assert client_for(outsider).get(tags_url).status_code == 403
    assert WorkspaceTag.objects.filter(workspace=workspace).count() == 1


@pytest.mark.contract
@pytest.mark.django_db
def test_tag_image_is_uploaded_through_the_asset_endpoint_by_admins_only(session_client, workspace, tags_url):
    tag = session_client.post(tags_url, {"name": "Logo"}, format="json").data
    member = client_for(make_member(workspace, "member@gizmo.so", 15))
    assets_url = f"/api/assets/v2/workspaces/{workspace.slug}/"
    payload = {
        "name": "logo.png",
        "type": "image/png",
        "size": 1024,
        "entity_type": "TAG_IMAGE",
        "entity_identifier": tag["id"],
    }

    with (
        patch("plane.app.views.asset.v2.S3Storage") as storage,
        patch("plane.app.views.asset.v2.get_asset_object_metadata.delay"),
    ):
        storage.return_value.generate_presigned_post.return_value = {"url": "https://s3", "fields": {}}

        assert member.post(assets_url, payload, format="json").status_code == 403

        # a tag that does not exist in this workspace cannot receive an image
        missing = session_client.post(assets_url, {**payload, "entity_identifier": "not-a-uuid"}, format="json")
        assert missing.status_code == 404

        created = session_client.post(assets_url, payload, format="json")
        assert created.status_code == 200
        asset_id = created.data["asset_id"]
        assert created.data["asset_url"] == f"/api/assets/v2/static/{asset_id}/"

        assert member.patch(f"{assets_url}{asset_id}/", {}, format="json").status_code == 403
        assert session_client.patch(f"{assets_url}{asset_id}/", {}, format="json").status_code == 204

    listed = session_client.get(tags_url).data
    assert listed[0]["image_url"] == f"/api/assets/v2/static/{asset_id}/"

    # replacing the image retires the previous asset
    with (
        patch("plane.app.views.asset.v2.S3Storage") as storage,
        patch("plane.app.views.asset.v2.get_asset_object_metadata.delay"),
    ):
        storage.return_value.generate_presigned_post.return_value = {"url": "https://s3", "fields": {}}
        second = session_client.post(assets_url, payload, format="json").data["asset_id"]
        assert session_client.patch(f"{assets_url}{second}/", {}, format="json").status_code == 204
    assert WorkspaceTag.objects.get(id=tag["id"]).image_asset_id == FileAsset.all_objects.get(id=second).id
    assert FileAsset.all_objects.get(id=asset_id).is_deleted is True

    # removing the image keeps the tag
    assert session_client.delete(f"{assets_url}{second}/").status_code == 204
    assert session_client.get(tags_url).data[0]["image_url"] is None


@pytest.mark.contract
@pytest.mark.django_db
def test_issue_tags_are_replaced_as_a_set_and_validated(session_client, workspace, create_user, issue, tags_url):
    first = str(session_client.post(tags_url, {"name": "One"}, format="json").data["id"])
    second = str(session_client.post(tags_url, {"name": "Two"}, format="json").data["id"])
    url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/tags/"

    assert session_client.get(url).data == {"tag_ids": []}
    assert sorted(
        session_client.put(url, {"tag_ids": [first, second, first]}, format="json").data["tag_ids"]
    ) == sorted([first, second])
    assert IssueTag.objects.filter(issue=issue).count() == 2

    assert session_client.put(url, {"tag_ids": [second]}, format="json").data == {"tag_ids": [second]}
    assert session_client.get(url).data == {"tag_ids": [second]}
    assert session_client.put(url, {"tag_ids": []}, format="json").data == {"tag_ids": []}
    # re-adding a previously removed tag works with the soft-deleted row still present
    assert session_client.put(url, {"tag_ids": [first]}, format="json").data == {"tag_ids": [first]}

    assert session_client.put(url, {"tag_ids": "nope"}, format="json").status_code == 400
    assert session_client.put(url, {"tag_ids": ["not-a-uuid"]}, format="json").status_code == 400
    assert (
        session_client.put(url, {"tag_ids": ["6f1b2f43-0c27-4bb7-8f7e-0c4d4a2b1a11"]}, format="json").status_code == 400
    )
    assert session_client.get(url).data == {"tag_ids": [first]}

    # a tag from another workspace cannot be used
    other = Workspace.objects.create(name="Other", owner=create_user, slug="other-workspace")
    foreign = WorkspaceTag.objects.create(workspace=other, name="Foreign")
    assert session_client.put(url, {"tag_ids": [str(foreign.id)]}, format="json").status_code == 400


@pytest.mark.contract
@pytest.mark.django_db
def test_guests_read_issue_tags_but_cannot_change_them_and_deleted_tags_disappear(
    session_client, workspace, issue, tags_url
):
    tag = str(session_client.post(tags_url, {"name": "Temp"}, format="json").data["id"])
    url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/tags/"
    assert session_client.put(url, {"tag_ids": [tag]}, format="json").status_code == 200

    guest = make_member(workspace, "guest@gizmo.so", 5)
    ProjectMember.objects.create(project=issue.project, member=guest, role=5)
    guest_client = client_for(guest)
    assert guest_client.get(url).data == {"tag_ids": [tag]}
    assert guest_client.put(url, {"tag_ids": []}, format="json").status_code == 403

    assert session_client.delete(f"{tags_url}{tag}/").status_code == 204
    assert session_client.get(url).data == {"tag_ids": []}
    assert not IssueTag.objects.filter(issue=issue).exists()
