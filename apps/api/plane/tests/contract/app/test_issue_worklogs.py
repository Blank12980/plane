# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import io
import zipfile
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from openpyxl import load_workbook
from rest_framework.test import APIClient

from plane.bgtasks.export_task import issue_export_task
from plane.db.models import (
    ExporterHistory,
    Issue,
    IssueWorkLog,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.utils.porters.serializers.task_hours import HOURS_HEADERS


@pytest.fixture(autouse=True)
def no_background_cascade():
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield


def make_project_member(workspace, project, email, workspace_role, project_role):
    user = User.objects.create(
        email=email, username=email.split("@")[0], first_name="Member", last_name=email.split("@")[0]
    )
    user.set_password("test-password")
    user.save()
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=workspace_role)
    ProjectMember.objects.create(project=project, member=user, role=project_role)
    client = APIClient()
    client.force_authenticate(user=user)
    return user, client


@pytest.fixture
def issue(workspace, create_user):
    project = Project.objects.create(name="Hours", identifier="HR", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="В работе", color="#123456")
    return Issue.objects.bulk_create(
        [Issue(project=project, workspace=workspace, state=state, name="Task", sequence_id=1)]
    )[0]


@pytest.fixture
def worklogs_url(workspace, issue):
    return f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/worklogs/"


@pytest.mark.contract
@pytest.mark.django_db
def test_member_logs_lists_edits_and_deletes_time(session_client, create_user, worklogs_url):
    created = session_client.post(
        worklogs_url,
        {"duration_minutes": 90, "description": "  Разбор  ", "logged_on": "2026-10-01"},
        format="json",
    )
    assert created.status_code == 201
    assert created.data["duration_minutes"] == 90
    assert created.data["description"] == "Разбор"
    assert created.data["logged_by"] == create_user.id
    assert str(created.data["logged_by_detail"]["id"]) == str(create_user.id)

    listed = session_client.get(worklogs_url)
    assert [entry["duration_minutes"] for entry in listed.data] == [90]

    detail_url = f"{worklogs_url}{created.data['id']}/"
    updated = session_client.patch(detail_url, {"duration_minutes": 120}, format="json")
    assert updated.status_code == 200
    assert updated.data["duration_minutes"] == 120
    assert updated.data["logged_on"] == "2026-10-01"

    assert session_client.delete(detail_url).status_code == 204
    assert session_client.get(worklogs_url).data == []
    assert session_client.delete(detail_url).status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
def test_logged_time_is_validated(session_client, worklogs_url):
    future = (timezone.localdate() + timedelta(days=5)).isoformat()
    for payload in (
        {"duration_minutes": 0},
        {"duration_minutes": -5},
        {"duration_minutes": 24 * 60 + 1},
        {"duration_minutes": "abc"},
        {},
        {"duration_minutes": 30, "logged_on": future},
        {"duration_minutes": 30, "logged_on": "not-a-date"},
    ):
        assert session_client.post(worklogs_url, payload, format="json").status_code == 400, payload
    assert IssueWorkLog.objects.count() == 0

    # a full day is the upper bound and the date defaults to today
    ok = session_client.post(worklogs_url, {"duration_minutes": 24 * 60}, format="json")
    assert ok.status_code == 201
    assert ok.data["logged_on"] == timezone.localdate().isoformat()


@pytest.mark.contract
@pytest.mark.django_db
def test_members_only_change_their_own_logs_unless_admin(session_client, workspace, issue, worklogs_url):
    _, author = make_project_member(workspace, issue.project, "author@gizmo.so", 15, 15)
    _, colleague = make_project_member(workspace, issue.project, "colleague@gizmo.so", 15, 15)
    log_id = author.post(worklogs_url, {"duration_minutes": 60}, format="json").data["id"]
    detail_url = f"{worklogs_url}{log_id}/"

    assert colleague.patch(detail_url, {"duration_minutes": 5}, format="json").status_code == 403
    assert colleague.delete(detail_url).status_code == 403
    assert IssueWorkLog.objects.get(id=log_id).duration_minutes == 60

    # the project admin (the default test user) can correct anyone's entry
    assert session_client.patch(detail_url, {"duration_minutes": 45}, format="json").status_code == 200
    assert author.patch(detail_url, {"duration_minutes": 50}, format="json").status_code == 200
    assert session_client.delete(detail_url).status_code == 204


@pytest.mark.contract
@pytest.mark.django_db
def test_guests_and_outsiders_have_no_access_to_worklogs(session_client, workspace, create_user, issue, worklogs_url):
    _, guest = make_project_member(workspace, issue.project, "guest@gizmo.so", 5, 5)
    assert guest.get(worklogs_url).status_code == 403
    assert guest.post(worklogs_url, {"duration_minutes": 10}, format="json").status_code == 403

    outsider = APIClient()
    outsider.force_authenticate(user=User.objects.create(email="outsider@gizmo.so", username="outsider"))
    assert outsider.get(worklogs_url).status_code == 403
    assert outsider.post(worklogs_url, {"duration_minutes": 10}, format="json").status_code == 403
    assert IssueWorkLog.objects.count() == 0

    # an issue id from another project cannot be logged against through this project's URL
    other = Project.objects.create(name="Other", identifier="OT", workspace=workspace)
    ProjectMember.objects.create(project=other, member=create_user, role=20)
    wrong = f"/api/workspaces/{workspace.slug}/projects/{other.id}/issues/{issue.id}/worklogs/"
    assert session_client.post(wrong, {"duration_minutes": 10}, format="json").status_code == 404


@pytest.mark.contract
@pytest.mark.django_db
def test_hours_report_is_queued_with_access_check(session_client, workspace, issue):
    url = f"/api/workspaces/{workspace.slug}/export-issues/"
    with patch("plane.app.views.exporter.base.issue_export_task.delay") as delay:
        response = session_client.post(
            url,
            {"provider": "xlsx", "layout": "task_hours", "project": [str(issue.project_id)]},
            format="json",
        )
        assert response.status_code == 200
        assert delay.call_args.kwargs["layout"] == "task_hours"
        assert delay.call_args.kwargs["multiple"] is True
        assert ExporterHistory.objects.get().name == "task_hours"

        private = Project.objects.create(name="Private", identifier="PV", workspace=workspace)
        denied = session_client.post(
            url,
            {"provider": "xlsx", "layout": "task_hours", "project": [str(private.id)]},
            format="json",
        )
        assert denied.status_code == 404
        assert delay.call_count == 1


@pytest.mark.contract
@pytest.mark.django_db
def test_hours_report_lists_each_task_once_with_summed_hours(workspace, create_user, issue):
    other_user = User.objects.create(email="other@gizmo.so", username="other")
    extra = Issue.objects.bulk_create(
        [
            Issue(project=issue.project, workspace=workspace, state=issue.state, name="Untouched", sequence_id=2),
            Issue(project=issue.project, workspace=workspace, state=issue.state, name="=cmd()", sequence_id=3),
        ]
    )
    for minutes, user in ((90, create_user), (45, other_user), (15, create_user)):
        IssueWorkLog.objects.create(issue=issue, project=issue.project, logged_by=user, duration_minutes=minutes)
    IssueWorkLog.objects.create(issue=extra[1], project=issue.project, logged_by=create_user, duration_minutes=20)
    removed = IssueWorkLog.objects.create(
        issue=issue, project=issue.project, logged_by=create_user, duration_minutes=600
    )
    removed.delete()

    history = ExporterHistory.objects.create(
        workspace=workspace,
        project=[str(issue.project_id)],
        initiated_by=create_user,
        provider="xlsx",
        name="task_hours",
    )
    with patch("plane.bgtasks.export_task.upload_to_s3") as upload:
        issue_export_task(
            provider="xlsx",
            workspace_id=workspace.id,
            project_ids=[str(issue.project_id)],
            token_id=history.token,
            multiple=True,
            slug=workspace.slug,
            layout="task_hours",
        )
    upload.assert_called_once()
    with zipfile.ZipFile(upload.call_args.args[0]) as archive:
        assert archive.namelist() == [f"{workspace.slug}-{issue.project_id}-task-hours.xlsx"]
        workbook = load_workbook(io.BytesIO(archive.read(archive.namelist()[0])), read_only=True)
        rows = list(workbook.active.values)
        workbook.close()

    assert rows[0] == tuple(HOURS_HEADERS)
    assert rows[1:] == [
        ("HR-1", "Task", "В работе", 2.5),
        ("HR-2", "Untouched", "В работе", 0),
        ("HR-3", "'=cmd()", "В работе", 0.33),
    ]
    # hours are written as numbers so Excel can sum the column
    assert all(isinstance(row[3], (int, float)) for row in rows[1:])
