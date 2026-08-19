# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.license.models import Instance, InstanceAdmin
from plane.license.workspace_access import (
    grant_instance_admin_access,
    promote_explicit_workspace_membership,
)


@pytest.fixture
def managed_instance(db):
    return Instance.objects.create(
        instance_name="Managed instance",
        instance_id=uuid4().hex,
        current_version="1.0.0",
        last_checked_at=timezone.now(),
    )


def create_user(email):
    return User.objects.create(
        email=email,
        username=uuid4().hex,
        first_name=email.split("@")[0],
        last_name="User",
    )


@pytest.mark.contract
class TestInstanceManagement:
    @pytest.mark.django_db
    def test_delegated_admin_gets_existing_workspace_and_project_access(self, api_client, managed_instance):
        super_admin = create_user("root@gizmo.so")
        delegated_admin = create_user("delegated@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="workspace", owner=owner)
        project = Project.objects.create(name="Project", identifier="PRJ", workspace=workspace, created_by=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=super_admin, role=20)
        api_client.force_authenticate(user=super_admin)

        response = api_client.post(
            "/api/instances/admins/",
            {"email": delegated_admin.email},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert WorkspaceMember.objects.filter(
            workspace=workspace,
            member=delegated_admin,
            role=20,
            is_active=True,
            is_instance_admin_access=True,
        ).exists()
        assert ProjectMember.objects.filter(
            project=project,
            member=delegated_admin,
            role=20,
            is_active=True,
            is_instance_admin_access=True,
        ).exists()

    @pytest.mark.django_db
    def test_new_workspaces_and_projects_include_existing_instance_admin(self, managed_instance):
        admin = create_user("admin@gizmo.so")
        owner = create_user("owner@gizmo.so")
        InstanceAdmin.objects.create(instance=managed_instance, user=admin, role=15)

        workspace = Workspace.objects.create(name="Future workspace", slug="future-workspace", owner=owner)
        project = Project.objects.create(name="Future project", identifier="FTR", workspace=workspace, created_by=owner)

        assert WorkspaceMember.objects.filter(
            workspace=workspace,
            member=admin,
            is_instance_admin_access=True,
            is_active=True,
        ).exists()
        assert ProjectMember.objects.filter(
            project=project,
            member=admin,
            is_instance_admin_access=True,
            is_active=True,
        ).exists()

    @pytest.mark.django_db
    def test_revoking_admin_restores_local_role_and_removes_project_projection(self, api_client, managed_instance):
        super_admin = create_user("root@gizmo.so")
        delegated_admin = create_user("delegated@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="workspace", owner=owner)
        WorkspaceMember.objects.create(workspace=workspace, member=delegated_admin, role=15)
        project = Project.objects.create(name="Project", identifier="PRJ", workspace=workspace, created_by=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=super_admin, role=20)
        api_client.force_authenticate(user=super_admin)
        create_response = api_client.post(
            "/api/instances/admins/",
            {"email": delegated_admin.email},
            format="json",
        )
        delegated_role_id = create_response.data["id"]

        response = api_client.delete(f"/api/instances/admins/{delegated_role_id}/")

        assert response.status_code == status.HTTP_204_NO_CONTENT
        workspace_member = WorkspaceMember.objects.get(workspace=workspace, member=delegated_admin)
        assert workspace_member.role == 15
        assert workspace_member.is_active is True
        assert workspace_member.is_instance_admin_access is False
        project_member = ProjectMember.objects.get(project=project, member=delegated_admin)
        assert project_member.is_active is False
        assert project_member.is_instance_admin_access is False

    @pytest.mark.django_db
    def test_admin_can_manage_users_and_add_them_to_any_workspace(self, api_client, managed_instance):
        admin = create_user("admin@gizmo.so")
        user = create_user("member@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="workspace", owner=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=admin, role=15)
        api_client.force_authenticate(user=admin)

        users_response = api_client.get("/api/instances/users/")
        add_response = api_client.post(
            f"/api/instances/workspaces/{workspace.id}/members/",
            {"email": user.email, "role": 15},
            format="json",
        )
        ban_response = api_client.patch(
            f"/api/instances/users/{user.id}/",
            {"is_banned": True, "banned_reason": "Policy violation"},
            format="json",
        )

        assert users_response.status_code == status.HTTP_200_OK
        assert add_response.status_code == status.HTTP_201_CREATED
        assert WorkspaceMember.objects.filter(
            workspace=workspace,
            member=user,
            role=15,
            is_active=True,
            is_instance_admin_access=False,
        ).exists()
        assert ban_response.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is False
        assert user.is_banned is True
        assert user.banned_reason == "Policy violation"

        unban_response = api_client.patch(
            f"/api/instances/users/{user.id}/",
            {"is_banned": False},
            format="json",
        )
        password_response = api_client.post(
            f"/api/instances/users/{user.id}/password/",
            {"password": "Riv3r!Cobalt-2026"},
            format="json",
        )

        assert unban_response.status_code == status.HTTP_200_OK
        assert password_response.status_code == status.HTTP_204_NO_CONTENT
        user.refresh_from_db()
        assert user.is_active is True
        assert user.is_banned is False
        assert user.check_password("Riv3r!Cobalt-2026")

    @pytest.mark.django_db
    def test_admin_can_edit_a_regular_user_account(self, api_client, managed_instance):
        admin = create_user("admin@gizmo.so")
        user = create_user("member@gizmo.so")
        InstanceAdmin.objects.create(instance=managed_instance, user=admin, role=15)
        api_client.force_authenticate(user=admin)

        response = api_client.patch(
            f"/api/instances/users/{user.id}/",
            {
                "email": "renamed@gizmo.so",
                "display_name": "Renamed member",
                "first_name": "Renamed",
                "last_name": "Member",
            },
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.email == "renamed@gizmo.so"
        assert user.display_name == "Renamed member"

    @pytest.mark.django_db
    def test_admin_cannot_change_super_admin_password_or_delete_users(self, api_client, managed_instance):
        super_admin = create_user("root@gizmo.so")
        admin = create_user("admin@gizmo.so")
        user = create_user("member@gizmo.so")
        InstanceAdmin.objects.create(instance=managed_instance, user=super_admin, role=20)
        InstanceAdmin.objects.create(instance=managed_instance, user=admin, role=15)
        api_client.force_authenticate(user=admin)

        password_response = api_client.post(
            f"/api/instances/users/{super_admin.id}/password/",
            {"password": "Riv3r!Cobalt-2026"},
            format="json",
        )
        delete_response = api_client.delete(f"/api/instances/users/{user.id}/")

        assert password_response.status_code == status.HTTP_403_FORBIDDEN
        assert delete_response.status_code == status.HTTP_403_FORBIDDEN
        assert User.objects.filter(pk=user.id).exists()

    @pytest.mark.django_db
    def test_super_admin_can_delete_regular_user_but_not_workspace_owner(self, api_client, managed_instance):
        super_admin = create_user("root@gizmo.so")
        user = create_user("member@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Owned", slug="owned", owner=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=super_admin, role=20)
        api_client.force_authenticate(user=super_admin)

        owner_response = api_client.delete(f"/api/instances/users/{owner.id}/")
        user_response = api_client.delete(f"/api/instances/users/{user.id}/")

        assert owner_response.status_code == status.HTTP_409_CONFLICT
        assert user_response.status_code == status.HTTP_204_NO_CONTENT
        assert Workspace.objects.filter(pk=workspace.id).exists()
        assert not User.objects.filter(pk=user.id).exists()

    @pytest.mark.django_db
    def test_regular_user_cannot_use_instance_management_api(self, api_client, managed_instance):
        user = create_user("user@gizmo.so")
        api_client.force_authenticate(user=user)

        assert api_client.get("/api/instances/users/").status_code == status.HTTP_403_FORBIDDEN

    @pytest.mark.django_db
    def test_explicit_member_stays_visible_after_becoming_instance_admin(self, managed_instance):
        admin = create_user("admin@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="workspace", owner=owner)
        WorkspaceMember.objects.create(workspace=workspace, member=admin, role=15)
        project = Project.objects.create(name="Project", identifier="PRJ", workspace=workspace, created_by=owner)
        ProjectMember.objects.create(project=project, workspace=workspace, member=admin, role=15)

        grant_instance_admin_access(admin)

        workspace_member = WorkspaceMember.objects.get(workspace=workspace, member=admin)
        project_member = ProjectMember.objects.get(project=project, member=admin)
        assert workspace_member.is_instance_admin_access is False
        assert workspace_member.role == 15
        assert workspace_member.is_active is True
        assert project_member.is_instance_admin_access is False
        assert project_member.role == 15

    @pytest.mark.django_db
    def test_promoting_hidden_admin_makes_them_visible_and_assignable(self, managed_instance):
        admin = create_user("admin@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="visible-admin", owner=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=admin, role=20)
        project = Project.objects.create(name="Project", identifier="VIS", workspace=workspace, created_by=owner)

        hidden = WorkspaceMember.objects.get(workspace=workspace, member=admin)
        assert hidden.is_instance_admin_access is True

        promote_explicit_workspace_membership(admin, workspace, role=15)

        workspace_member = WorkspaceMember.objects.get(workspace=workspace, member=admin)
        project_member = ProjectMember.objects.get(project=project, member=admin)
        assert workspace_member.is_instance_admin_access is False
        assert workspace_member.role == 15
        assert project_member.is_instance_admin_access is False
        assert project_member.role == 15

    @pytest.mark.django_db
    def test_project_member_list_hides_background_admins_and_keeps_explicit_ones(
        self, api_client, managed_instance
    ):
        owner = create_user("owner@gizmo.so")
        hidden_admin = create_user("hidden@gizmo.so")
        explicit_admin = create_user("explicit@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="picker-workspace", owner=owner)
        WorkspaceMember.objects.create(workspace=workspace, member=owner, role=20)
        InstanceAdmin.objects.create(instance=managed_instance, user=hidden_admin, role=20)
        InstanceAdmin.objects.create(instance=managed_instance, user=explicit_admin, role=20)
        project = Project.objects.create(name="Project", identifier="PCK", workspace=workspace, created_by=owner)
        ProjectMember.objects.create(project=project, workspace=workspace, member=owner, role=20)
        promote_explicit_workspace_membership(explicit_admin, workspace, role=20)

        api_client.force_authenticate(user=owner)
        response = api_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/members/")

        assert response.status_code == status.HTTP_200_OK
        member_ids = {str(item["member"]) for item in response.data}
        assert str(owner.id) in member_ids
        assert str(explicit_admin.id) in member_ids
        assert str(hidden_admin.id) not in member_ids

    @pytest.mark.django_db
    def test_god_mode_can_add_instance_admin_as_explicit_workspace_member(self, api_client, managed_instance):
        super_admin = create_user("root@gizmo.so")
        delegated_admin = create_user("delegated@gizmo.so")
        owner = create_user("owner@gizmo.so")
        workspace = Workspace.objects.create(name="Workspace", slug="god-add", owner=owner)
        InstanceAdmin.objects.create(instance=managed_instance, user=super_admin, role=20)
        InstanceAdmin.objects.create(instance=managed_instance, user=delegated_admin, role=15)
        api_client.force_authenticate(user=super_admin)

        response = api_client.post(
            f"/api/instances/workspaces/{workspace.id}/members/",
            {"email": delegated_admin.email, "role": 15},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        workspace_member = WorkspaceMember.objects.get(workspace=workspace, member=delegated_admin)
        assert workspace_member.is_instance_admin_access is False
        assert workspace_member.role == 15
        assert workspace_member.is_active is True
