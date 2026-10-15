# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4
from types import SimpleNamespace

import pytest
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from plane.db.models import Page, ProjectPage, Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.utils.core import clear_read_replica_context, set_use_read_replica, should_use_read_replica
from plane.utils.project_access import (
    ProjectAccessMixin,
    has_project_role,
    project_list_data,
    projects_for_user,
    require_project_access,
    require_asset_access,
)
from plane.app.permissions import ProjectMemberPermission
from plane.license.models import Instance, InstanceAdmin


pytestmark = [pytest.mark.unit, pytest.mark.django_db]


@pytest.fixture
def access_scope():
    # Bulk inserts isolate access tests from onboarding/preferences signals.
    user = User(email="privacy@example.com", username="privacy")
    User.objects.bulk_create([user])
    workspace = Workspace(name="Privacy", slug="privacy", owner=user)
    Workspace.objects.bulk_create([workspace])
    workspace_member = WorkspaceMember(workspace=workspace, member=user, role=15)
    WorkspaceMember.objects.bulk_create([workspace_member])
    public = Project(workspace=workspace, name="Public", identifier="PUB", network=2)
    private = Project(workspace=workspace, name="Private", identifier="PVT", network=0)
    joined = Project(workspace=workspace, name="Joined", identifier="JOIN", network=0)
    Project.objects.bulk_create([public, private, joined])
    membership = ProjectMember(workspace=workspace, project=joined, member=user, role=15)
    ProjectMember.objects.bulk_create([membership])
    return user, workspace, workspace_member, public, private, joined, membership


def ids(queryset):
    return set(queryset.values_list("pk", flat=True))


@pytest.mark.parametrize("role", [5, 15])
def test_discovery_includes_public_and_joined_projects_only(access_scope, role):
    user, workspace, workspace_member, public, private, joined, _ = access_scope
    workspace_member.role = role
    workspace_member.save()
    assert ids(projects_for_user(user, workspace.slug, include_public=True)) == {public.id, joined.id}
    assert private.id not in ids(projects_for_user(user, workspace.slug, include_public=True))
    assert ids(projects_for_user(user, workspace.slug)) == {joined.id}


@pytest.mark.parametrize("project_index", [3, 4])
def test_non_member_cannot_access_public_or_private_project(access_scope, project_index):
    user, workspace, *_ = access_scope
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, access_scope[project_index].id)


def test_workspace_admin_has_access_without_project_membership(access_scope):
    user, workspace, workspace_member, public, private, joined, _ = access_scope
    workspace_member.role = 20
    workspace_member.save()
    assert ids(projects_for_user(user, workspace.slug)) == {public.id, private.id, joined.id}
    require_project_access(user, workspace.slug, private.id)
    assert has_project_role(user, workspace.slug, private.id, [20])


def test_instance_admin_access_is_independent_of_local_membership(access_scope):
    user, workspace, workspace_member, public, private, joined, _ = access_scope
    instance = Instance.objects.create(
        instance_name="Privacy instance",
        instance_id="privacy-unit-instance",
        current_version="test",
        last_checked_at=timezone.now(),
    )
    InstanceAdmin.objects.create(instance=instance, user=user, role=15)
    workspace_member.is_active = False
    workspace_member.save()
    assert ids(projects_for_user(user, workspace.slug)) == {public.id, private.id, joined.id}
    require_project_access(user, workspace.slug, private.id)


@pytest.mark.parametrize("field,value", [("is_active", False), ("deleted_at", "now")])
def test_inactive_and_deleted_memberships_do_not_grant_access(access_scope, field, value):
    from django.utils import timezone

    user, workspace, _, public, _, joined, membership = access_scope
    setattr(membership, field, timezone.now() if value == "now" else value)
    membership.save()
    assert ids(projects_for_user(user, workspace.slug)) == set()
    assert ids(projects_for_user(user, workspace.slug, include_public=True)) == {public.id}
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, joined.id)


def test_workspace_departure_revokes_existing_project_membership(access_scope):
    user, workspace, workspace_member, _, _, joined, _ = access_scope
    workspace_member.is_active = False
    workspace_member.save()
    assert not projects_for_user(user, workspace.slug, include_public=True).exists()
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, joined.id)


def test_project_uuid_cannot_be_used_in_another_workspace(access_scope):
    user, _, _, _, _, joined, _ = access_scope
    with pytest.raises(PermissionDenied):
        require_project_access(user, "another-workspace", joined.id)


def test_anonymous_user_has_no_project_access(access_scope):
    _, workspace, _, public, *_ = access_scope
    assert not projects_for_user(AnonymousUser(), workspace.slug, include_public=True).exists()
    with pytest.raises(PermissionDenied):
        require_project_access(AnonymousUser(), workspace.slug, public.id)


def test_public_discovery_does_not_expose_project_contents(access_scope):
    user, workspace, _, public, _, joined, _ = access_scope
    payload = [
        {"id": str(public.id), "name": "Public", "members": ["secret-member"], "next_work_item_sequence": 42},
        {"id": str(joined.id), "name": "Joined", "members": [str(user.id)]},
    ]
    result = project_list_data(user, workspace.slug, payload)
    assert result[0] == {"id": str(public.id), "name": "Public"}
    assert result[1] == payload[1]


class GuardedView(ProjectAccessMixin, APIView):
    def get(self, request, **kwargs):
        return Response({"ok": True})

    post = get


@pytest.mark.parametrize("method", ["get", "post"])
def test_common_guard_covers_endpoints_with_only_default_permissions(access_scope, method):
    user, workspace, _, public, *_ = access_scope
    request = getattr(APIRequestFactory(), method)("/project/", {}, format="json")
    force_authenticate(request, user=user)
    response = GuardedView.as_view()(request, slug=workspace.slug, project_id=public.id)
    assert response.status_code == 403


def test_guard_uses_primary_database_after_departure(access_scope):
    user, workspace, _, _, _, joined, _ = access_scope
    request = APIRequestFactory().get("/project/")
    force_authenticate(request, user=user)
    set_use_read_replica(True)
    try:
        response = GuardedView.as_view()(request, slug=workspace.slug, project_id=joined.id)
        assert response.status_code == 200
        assert not should_use_read_replica()
    finally:
        clear_read_replica_context()


@pytest.mark.parametrize("field", ["project_id", "project", "target_project_id", "destination_project_id"])
def test_guard_validates_project_id_in_payload(access_scope, field):
    user, workspace, _, public, *_ = access_scope
    request = APIRequestFactory().post("/workspace/", {field: str(public.id)}, format="json")
    force_authenticate(request, user=user)
    response = GuardedView.as_view()(request, slug=workspace.slug)
    assert response.status_code == 403


def test_guard_rejects_missing_project(access_scope):
    user, workspace, *_ = access_scope
    request = APIRequestFactory().get("/project/")
    force_authenticate(request, user=user)
    assert GuardedView.as_view()(request, slug=workspace.slug, project_id=uuid4()).status_code == 403


def test_project_membership_in_one_project_does_not_allow_posting_to_another(access_scope):
    user, workspace, _, public, *_ = access_scope
    request = SimpleNamespace(user=user, method="POST")
    view = SimpleNamespace(workspace_slug=workspace.slug, project_id=public.id)
    assert not ProjectMemberPermission().has_permission(request, view)


def test_public_project_becomes_hidden_when_made_private(access_scope):
    user, workspace, _, public, _, joined, _ = access_scope
    Project.objects.filter(pk=public.id).update(network=0)
    assert ids(projects_for_user(user, workspace.slug, include_public=True)) == {joined.id}


def test_private_project_files_require_membership(access_scope):
    user, workspace, _, _, private, _, _ = access_scope
    asset = SimpleNamespace(project_id=private.id, issue_id=None, comment_id=None, entity_type="ISSUE_ATTACHMENT")
    with pytest.raises(PermissionDenied):
        require_asset_access(user, workspace.slug, asset)


def test_public_project_cover_is_discoverable_but_attachments_are_restricted(access_scope):
    user, workspace, _, public, *_ = access_scope
    asset = SimpleNamespace(project_id=public.id, issue_id=None, comment_id=None, entity_type="PROJECT_COVER")
    require_asset_access(user, workspace.slug, asset, discovery=True)
    asset.entity_type = "ISSUE_ATTACHMENT"
    with pytest.raises(PermissionDenied):
        require_asset_access(user, workspace.slug, asset, discovery=True)


def test_legacy_file_without_project_fk_inherits_issue_project_access(access_scope):
    user, workspace, _, _, private, _, _ = access_scope
    asset = SimpleNamespace(project_id=None, issue_id=uuid4(), issue=SimpleNamespace(project_id=private.id))
    with pytest.raises(PermissionDenied):
        require_asset_access(user, workspace.slug, asset)


@pytest.mark.parametrize("joined_page", [True, False])
def test_page_files_check_the_actual_project_relation(access_scope, joined_page):
    user, workspace, _, _, private, joined, _ = access_scope
    project = joined if joined_page else private
    page = Page(workspace=workspace, owned_by=user, name="Page")
    Page.objects.bulk_create([page])
    ProjectPage.objects.bulk_create([ProjectPage(workspace=workspace, project=project, page=page)])
    asset = SimpleNamespace(project_id=None, issue_id=None, comment_id=None, page_id=page.id)
    if joined_page:
        require_asset_access(user, workspace.slug, asset)
    else:
        with pytest.raises(PermissionDenied):
            require_asset_access(user, workspace.slug, asset)


def test_member_cannot_use_joined_project_url_to_read_another_projects_page(access_scope):
    user, workspace, _, _, private, joined, _ = access_scope
    page = Page(workspace=workspace, owned_by=user, name="Private project page")
    Page.objects.bulk_create([page])
    ProjectPage.objects.bulk_create([ProjectPage(workspace=workspace, project=private, page=page)])
    request = APIRequestFactory().get("/page/")
    force_authenticate(request, user=user)
    response = GuardedView.as_view()(request, slug=workspace.slug, project_id=joined.id, page_id=page.id)
    assert response.status_code == 403


def test_stale_instance_projection_does_not_make_a_regular_user_a_project_member(access_scope):
    user, workspace, _, public, private, joined, _ = access_scope
    ProjectMember.objects.bulk_create(
        [ProjectMember(workspace=workspace, project=private, member=user, role=20, is_instance_admin_access=True)]
    )
    assert ids(projects_for_user(user, workspace.slug, include_public=True)) == {public.id, joined.id}
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, private.id)


def test_stale_workspace_projection_does_not_grant_admin_access(access_scope):
    from plane.utils.project_access import is_workspace_admin

    user, workspace, membership, *_ = access_scope
    WorkspaceMember.objects.filter(pk=membership.id).update(role=20, is_instance_admin_access=True)
    assert not is_workspace_admin(user, workspace.slug)
    assert not projects_for_user(user, workspace.slug).exists()


def test_workspace_invitation_does_not_reactivate_departed_project_members(access_scope):
    from plane.license.workspace_access import promote_explicit_workspace_membership

    user, workspace, _, _, _, joined, membership = access_scope
    ProjectMember.objects.filter(pk=membership.pk).update(is_active=False)
    promote_explicit_workspace_membership(user, workspace, role=15)
    membership.refresh_from_db()
    assert not membership.is_active
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, joined.id)


def make_instance():
    return Instance.objects.create(
        instance_name="Privacy", instance_id=uuid4().hex, current_version="test", last_checked_at=timezone.now()
    )


@pytest.mark.parametrize("action", ["downgrade", "soft_delete", "hard_delete"])
def test_losing_instance_admin_role_revokes_technical_but_preserves_explicit_memberships(access_scope, action):
    user, workspace, workspace_member, _, private, joined, membership = access_scope
    admin = InstanceAdmin.objects.create(instance=make_instance(), user=user, role=20)
    projection = ProjectMember.objects.get(project=private, member=user)
    assert projection.is_active and projection.is_instance_admin_access
    if action == "hard_delete":
        admin.delete(soft=False)
    else:
        if action == "downgrade":
            admin.role = 5
        else:
            admin.deleted_at = timezone.now()
        admin.save()
    projection.refresh_from_db()
    workspace_member.refresh_from_db()
    membership.refresh_from_db()
    assert not projection.is_active and not projection.is_instance_admin_access and projection.role == 5
    assert workspace_member.is_active and workspace_member.role == 15
    assert membership.is_active and membership.role == 15
    require_project_access(user, workspace.slug, joined.id)
    with pytest.raises(PermissionDenied):
        require_project_access(user, workspace.slug, private.id)


def test_removing_one_admin_record_keeps_access_when_another_is_current(access_scope):
    user, workspace, _, _, private, *_ = access_scope
    admin = InstanceAdmin.objects.create(instance=make_instance(), user=user, role=20)
    InstanceAdmin.objects.create(instance=make_instance(), user=user, role=15)
    admin.delete(soft=False)
    assert ProjectMember.objects.get(project=private, member=user).is_instance_admin_access
    require_project_access(user, workspace.slug, private.id)


def test_migration_revokes_only_stale_projections_and_restores_previous_roles(access_scope):
    from importlib import import_module
    from django.apps import apps
    from django.db import connection

    user, workspace, workspace_member, public, private, joined, membership = access_scope
    stale = ProjectMember.objects.create(
        workspace=workspace, project=private, member=user, role=20, is_instance_admin_access=True
    )
    WorkspaceMember.objects.filter(pk=workspace_member.pk).update(
        role=20, is_instance_admin_access=True, instance_admin_previous_role=15
    )
    current_admin = User(email="current-admin@example.com", username="current-admin")
    User.objects.bulk_create([current_admin])
    InstanceAdmin.objects.create(instance=make_instance(), user=current_admin, role=20)
    migration = import_module("plane.db.migrations.0133_revoke_stale_instance_admin_access")
    for _ in range(2):
        migration.revoke_stale_instance_admin_access(apps, SimpleNamespace(connection=connection))
    stale.refresh_from_db()
    workspace_member.refresh_from_db()
    membership.refresh_from_db()
    assert not stale.is_active and stale.role == 5 and not stale.is_instance_admin_access
    assert workspace_member.is_active and workspace_member.role == 15 and not workspace_member.is_instance_admin_access
    assert workspace_member.instance_admin_previous_role is None
    assert membership.is_active and membership.role == 15
    assert ProjectMember.objects.get(project=private, member=current_admin).is_instance_admin_access
    assert ids(projects_for_user(user, workspace.slug, include_public=True)) == {public.id, joined.id}
