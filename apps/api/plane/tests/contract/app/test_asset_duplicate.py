# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest
from django.utils import timezone

from plane.app.views.asset.v2 import DuplicateAssetEndpoint
from plane.db.models import FileAsset, Workspace


@pytest.fixture(autouse=True)
def no_throttle_and_no_background_cascade():
    # The duplicate endpoint is throttled through the cache and soft deletes enqueue a celery cascade,
    # neither a cache nor a broker is available to the tests.
    with (
        patch.object(DuplicateAssetEndpoint, "throttle_classes", []),
        patch("plane.db.mixins.soft_delete_related_objects.delay"),
    ):
        yield


def make_asset(workspace):
    return FileAsset.objects.create(
        attributes={"name": "shot.png", "type": "image/png", "size": 10},
        asset=f"{workspace.id}/abc123-shot.png",
        size=10,
        workspace=workspace,
        entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        is_uploaded=True,
    )


def duplicate_url(workspace, asset):
    return f"/api/assets/v2/workspaces/{workspace.slug}/duplicate-assets/{asset.id}/"


@pytest.mark.contract
@pytest.mark.django_db
def test_an_image_the_editor_soft_deleted_can_still_be_duplicated(session_client, workspace):
    original = make_asset(workspace)
    # what the editor's DELETE leaves behind when an image leaves a description that another place still shows
    FileAsset.objects.filter(pk=original.pk).update(is_deleted=True, deleted_at=timezone.now())

    with patch("plane.app.views.asset.v2.S3Storage") as storage:
        response = session_client.post(
            duplicate_url(workspace, original), {"entity_type": "ISSUE_DESCRIPTION"}, format="json"
        )

    assert response.status_code == 200
    copy = FileAsset.objects.get(id=response.data["asset_id"])
    assert copy.id != original.id
    assert copy.is_uploaded
    assert copy.workspace_id == workspace.id
    storage.return_value.copy_object.assert_called_once()


@pytest.mark.contract
@pytest.mark.django_db
def test_an_image_of_another_workspace_cannot_be_duplicated(session_client, workspace, create_user):
    other = Workspace.objects.create(name="Other Workspace", owner=create_user, slug="other-workspace")
    foreign = make_asset(other)

    with patch("plane.app.views.asset.v2.S3Storage") as storage:
        response = session_client.post(
            duplicate_url(workspace, foreign), {"entity_type": "ISSUE_DESCRIPTION"}, format="json"
        )

    assert response.status_code == 404
    storage.return_value.copy_object.assert_not_called()
    assert FileAsset.objects.filter(workspace=workspace).count() == 0
