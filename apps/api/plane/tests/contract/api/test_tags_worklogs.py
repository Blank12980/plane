# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import (
    APIToken,
    Issue,
    IssueTag,
    IssueWorkLog,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
    WorkspaceTag,
)


@pytest.fixture(autouse=True)
def no_background_tasks():
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        cache.clear()
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Hours", identifier="HR", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def issue(project):
    return Issue.objects.create(project=project, workspace=project.workspace, name="Task")


@pytest.fixture
def member(workspace, project):
    user = User.objects.create(email="member@gizmo.so", username="member", first_name="Member", display_name="member")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
    ProjectMember.objects.create(project=project, member=user, role=15)
    return user


def client_for(user, workspace, scopes=None):
    token = APIToken.objects.create(user=user, workspace=workspace, scopes=scopes or [])
    client = APIClient()
    client.credentials(HTTP_X_API_KEY=token.token)
    return client


def base(workspace):
    return f"/api/v1/workspaces/{workspace.slug}"


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkspaceTagsAPI:
    def test_admin_creates_and_lists_tags(self, api_key_client, workspace):
        created = api_key_client.post(
            f"{base(workspace)}/tags/", {"name": " Backend ", "color": "#112233"}, format="json"
        )
        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["name"] == "Backend"

        duplicate = api_key_client.post(f"{base(workspace)}/tags/", {"name": "backend"}, format="json")
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST

        listed = api_key_client.get(f"{base(workspace)}/tags/")
        assert listed.status_code == status.HTTP_200_OK
        assert [tag["name"] for tag in listed.data] == ["Backend"]

    def test_member_cannot_create_tags(self, workspace, member):
        client = client_for(member, workspace)
        response = client.post(f"{base(workspace)}/tags/", {"name": "x"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_tags_write_scope_required(self, create_user, workspace):
        client = client_for(create_user, workspace, scopes=["read"])
        response = client.post(f"{base(workspace)}/tags/", {"name": "x"}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN
        client = client_for(create_user, workspace, scopes=["read", "tags:write"])
        response = client.post(f"{base(workspace)}/tags/", {"name": "x"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED

    def test_update_and_delete_tag(self, api_key_client, workspace):
        tag = WorkspaceTag.objects.create(workspace=workspace, name="Old")
        updated = api_key_client.patch(f"{base(workspace)}/tags/{tag.id}/", {"name": "New"}, format="json")
        assert updated.status_code == status.HTTP_200_OK
        assert updated.data["name"] == "New"
        deleted = api_key_client.delete(f"{base(workspace)}/tags/{tag.id}/")
        assert deleted.status_code == status.HTTP_204_NO_CONTENT
        assert not WorkspaceTag.objects.filter(pk=tag.id).exists()


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkItemTagsAPI:
    def url(self, workspace, issue):
        return f"{base(workspace)}/projects/{issue.project_id}/work-items/{issue.id}/tags/"

    def test_member_sets_and_reads_tags(self, workspace, issue, member):
        first = WorkspaceTag.objects.create(workspace=workspace, name="A")
        second = WorkspaceTag.objects.create(workspace=workspace, name="B")
        client = client_for(member, workspace, scopes=["read", "tags:write"])

        response = client.put(self.url(workspace, issue), {"tag_ids": [str(first.id), str(second.id)]}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert sorted(response.data["tag_ids"]) == sorted([str(first.id), str(second.id)])
        assert [tag["name"] for tag in response.data["tags"]] == ["A", "B"]

        response = client.put(self.url(workspace, issue), {"tag_ids": [str(second.id)]}, format="json")
        assert response.data["tag_ids"] == [str(second.id)]
        assert IssueTag.objects.filter(issue=issue).count() == 1

        listed = client.get(self.url(workspace, issue))
        assert listed.data["tag_ids"] == [str(second.id)]

    def test_rejects_foreign_or_invalid_tags(self, api_key_client, workspace, issue, create_user):
        from plane.db.models import Workspace

        other = Workspace.objects.create(name="Other", owner=create_user, slug="other")
        foreign = WorkspaceTag.objects.create(workspace=other, name="Foreign")
        assert (
            api_key_client.put(self.url(workspace, issue), {"tag_ids": [str(foreign.id)]}, format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )
        assert (
            api_key_client.put(self.url(workspace, issue), {"tag_ids": "nope"}, format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )

    def test_issues_write_scope_is_not_enough(self, create_user, workspace, issue):
        client = client_for(create_user, workspace, scopes=["read", "issues:write"])
        assert client.put(self.url(workspace, issue), {"tag_ids": []}, format="json").status_code == 403


@pytest.mark.contract
@pytest.mark.django_db
class TestWorkLogsAPI:
    def test_string_date_schedules_the_monthly_budget_check(self, issue, member, django_capture_on_commit_callbacks):
        from datetime import date
        from unittest.mock import patch

        with patch("plane.db.signals.time_budget.check_issue_time_budgets") as check:
            with django_capture_on_commit_callbacks(execute=True):
                IssueWorkLog.objects.create(
                    issue=issue,
                    project=issue.project,
                    workspace=issue.workspace,
                    logged_by=member,
                    duration_minutes=30,
                    logged_on="2026-10-15",
                )
            check.assert_called_once_with(issue.id, date(2026, 10, 1))

    def url(self, workspace, issue):
        return f"{base(workspace)}/projects/{issue.project_id}/work-items/{issue.id}/worklogs/"

    def test_log_list_update_delete_own_time(self, workspace, issue, member):
        client = client_for(member, workspace, scopes=["read", "worklogs:write"])
        created = client.post(
            self.url(workspace, issue),
            {"duration_minutes": 45, "description": " Code review ", "logged_on": "2026-10-01"},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["logged_by"] == member.id
        assert created.data["description"] == "Code review"

        listed = client.get(self.url(workspace, issue))
        assert listed.status_code == status.HTTP_200_OK
        assert listed.data["total_minutes"] == 45
        assert len(listed.data["results"]) == 1

        detail = f"{self.url(workspace, issue)}{created.data['id']}/"
        updated = client.patch(detail, {"duration_minutes": 60}, format="json")
        assert updated.status_code == status.HTTP_200_OK
        assert updated.data["duration_minutes"] == 60

        assert client.delete(detail).status_code == status.HTTP_204_NO_CONTENT
        assert IssueWorkLog.objects.count() == 0

    def test_logged_by_cannot_be_spoofed(self, workspace, issue, member, create_user):
        client = client_for(member, workspace)
        created = client.post(
            self.url(workspace, issue),
            {"duration_minutes": 10, "logged_by": str(create_user.id)},
            format="json",
        )
        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["logged_by"] == member.id

    def test_even_admin_token_cannot_change_others_worklogs(self, workspace, issue, member, create_user):
        worklog = IssueWorkLog.objects.create(
            issue=issue, project=issue.project, workspace=workspace, logged_by=member, duration_minutes=30
        )
        admin = client_for(create_user, workspace)
        detail = f"{self.url(workspace, issue)}{worklog.id}/"
        assert admin.patch(detail, {"duration_minutes": 1}, format="json").status_code == 403
        assert admin.delete(detail).status_code == 403

    def test_invalid_duration(self, api_key_client, workspace, issue):
        response = api_key_client.post(self.url(workspace, issue), {"duration_minutes": 0}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_worklogs_scope_required(self, create_user, workspace, issue):
        client = client_for(create_user, workspace, scopes=["read", "issues:write"])
        response = client.post(self.url(workspace, issue), {"duration_minutes": 5}, format="json")
        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
@pytest.mark.django_db
class TestTimeReportAPI:
    def url(self, workspace):
        return f"{base(workspace)}/time-report/"

    @pytest.fixture
    def logs(self, workspace, project, issue, member, create_user):
        other_issue = Issue.objects.create(project=project, workspace=workspace, name="Other")
        hidden = Project.objects.create(name="Hidden", identifier="HD", workspace=workspace)
        hidden_issue = Issue.objects.create(project=hidden, workspace=workspace, name="Hidden")
        entries = [
            (issue, member, 30, "2026-10-01"),
            (issue, create_user, 60, "2026-10-02"),
            (other_issue, member, 15, "2026-10-02"),
            (hidden_issue, create_user, 500, "2026-10-02"),
        ]
        for target, user, minutes, day in entries:
            IssueWorkLog.objects.create(
                issue=target,
                project=target.project,
                workspace=workspace,
                logged_by=user,
                duration_minutes=minutes,
                logged_on=day,
            )
        return other_issue

    def test_workspace_admin_sees_all_workspace_projects(self, api_key_client, workspace, logs, member, create_user):
        response = api_key_client.get(self.url(workspace))
        assert response.status_code == status.HTTP_200_OK
        assert response.data["total_minutes"] == 605
        by_user = {row["user_id"]: row["minutes"] for row in response.data["results"]}
        assert by_user == {str(member.id): 45, str(create_user.id): 560}

    def test_member_only_sees_accessible_projects(self, workspace, logs, member):
        client = client_for(member, workspace, scopes=["read"])
        response = client.get(self.url(workspace))
        assert response.status_code == 200
        assert response.data["total_minutes"] == 105

    def test_instance_admin_sees_all_projects_without_membership(self, workspace, logs):
        from django.utils import timezone
        from plane.db.models import User
        from plane.license.models import Instance, InstanceAdmin

        admin = User.objects.create(email="instance-report@gizmo.so", username="instance-report")
        instance = Instance.objects.create(
            instance_name="MCP", instance_id="mcp-report", current_version="test", last_checked_at=timezone.now()
        )
        InstanceAdmin.objects.create(instance=instance, user=admin, role=15)
        client = client_for(admin, workspace, scopes=["read"])
        response = client.get(self.url(workspace))
        assert response.status_code == 200
        assert response.data["total_minutes"] == 605

    def test_revoked_workspace_membership_hides_report(self, workspace, logs, member):
        client = client_for(member, workspace, scopes=["read"])
        WorkspaceMember.objects.filter(workspace=workspace, member=member).update(is_active=False)
        assert client.get(self.url(workspace)).status_code == 403

    def test_group_by_issue_with_filters(self, api_key_client, workspace, issue, logs, member):
        response = api_key_client.get(
            self.url(workspace),
            {"group_by": "issue", "user_id": str(member.id), "date_from": "2026-10-01", "date_to": "2026-10-01"},
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.data["total_minutes"] == 30
        assert response.data["results"][0]["identifier"] == f"HR-{issue.sequence_id}"
        assert response.data["results"][0]["issue_id"] == str(issue.id)

    def test_group_by_day_for_me(self, workspace, logs, member):
        client = client_for(member, workspace, scopes=["read"])
        response = client.get(self.url(workspace), {"group_by": "day", "user_id": "me"})
        assert response.status_code == status.HTTP_200_OK
        assert [(row["day"], row["minutes"]) for row in response.data["results"]] == [
            ("2026-10-01", 30),
            ("2026-10-02", 15),
        ]

    def test_invalid_params(self, api_key_client, workspace):
        assert api_key_client.get(self.url(workspace), {"group_by": "x"}).status_code == 400
        assert api_key_client.get(self.url(workspace), {"date_from": "yesterday"}).status_code == 400
        assert (
            api_key_client.get(self.url(workspace), {"date_from": "2026-10-02", "date_to": "2026-10-01"}).status_code
            == 400
        )


@pytest.mark.contract
@pytest.mark.django_db
@pytest.mark.parametrize(
    "method,path,payload",
    [
        ("get", "tags/", {}),
        ("get", "time-report/", {}),
        ("get", "projects/{project}/work-items/{issue}/tags/", {}),
        ("get", "projects/{project}/work-items/{issue}/worklogs/", {}),
        ("post", "projects/{project}/work-items/{issue}/worklogs/", {"duration_minutes": 10}),
        ("put", "projects/{project}/work-items/{issue}/tags/", {"tag_ids": []}),
    ],
)
def test_mcp_api_does_not_bypass_workspace_client_role(workspace, issue, method, path, payload):
    from plane.db.models import User

    user = User.objects.create(email="mcp-client@gizmo.so", username="mcp-client")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=3)
    ProjectMember.objects.create(project=issue.project, workspace=workspace, member=user, role=15)
    client = client_for(user, workspace, scopes=["read", "worklogs:write", "tags:write"])
    url = f"{base(workspace)}/{path.format(project=issue.project_id, issue=issue.id)}"
    response = getattr(client, method)(url, payload, format="json")
    assert response.status_code == 403
