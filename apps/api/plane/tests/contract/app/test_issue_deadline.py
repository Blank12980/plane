# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import io
import json
import zipfile
from contextlib import ExitStack
from datetime import date, datetime, timezone
from unittest.mock import patch

import pytest
from openpyxl import load_workbook

from plane.bgtasks.export_task import issue_export_task
from plane.db.models import ExporterHistory, Issue, Project, ProjectMember, State
from plane.utils.porters.serializers.task_deadline import DEADLINE_HEADERS


@pytest.fixture
def deadline_issue(workspace, create_user):
    create_user.user_timezone = "Europe/Moscow"
    create_user.save()
    project = Project.objects.create(name="Deadlines", identifier="DL", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="В работе", color="#123456")
    return Issue.objects.bulk_create(
        [
            Issue(project=project, workspace=workspace, state=state, name="Task", sequence_id=1),
        ]
    )[0]


@pytest.fixture
def deadline_tasks():
    with ExitStack() as stack:
        activity = stack.enter_context(patch("plane.app.views.issue.base.issue_activity.delay"))
        stack.enter_context(patch("plane.app.views.issue.base.model_activity.delay"))
        stack.enter_context(patch("plane.app.views.issue.base.issue_description_version_task.delay"))
        yield activity


@pytest.mark.contract
@pytest.mark.django_db
def test_deadline_persists_and_date_only_edits_clear_time(session_client, workspace, deadline_issue, deadline_tasks):
    issue = deadline_issue
    url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/"
    response = session_client.patch(url, {"deadline_at": "2026-10-10T18:30:00"}, format="json")
    assert response.status_code == 204
    issue.refresh_from_db()
    assert issue.target_date == date(2026, 10, 10)
    assert issue.deadline_at == datetime(2026, 10, 10, 15, 30, tzinfo=timezone.utc)
    requested = json.loads(deadline_tasks.call_args.kwargs["requested_data"])
    assert requested["deadline_at"].endswith("+03:00")
    assert session_client.get(url).data["deadline_at"] is not None

    assert session_client.patch(url, {"deadline_at": None}, format="json").status_code == 204
    issue.refresh_from_db()
    assert issue.deadline_at is None
    assert issue.target_date == date(2026, 10, 10)

    assert session_client.patch(url, {"deadline_at": "2026-10-10T18:30:00"}, format="json").status_code == 204
    assert session_client.patch(url, {"target_date": "2026-10-11"}, format="json").status_code == 204
    issue.refresh_from_db()
    assert issue.target_date == date(2026, 10, 11)
    assert issue.deadline_at is None


@pytest.mark.contract
@pytest.mark.django_db
def test_deadline_rejects_invalid_time_and_cross_project_access(
    session_client, workspace, deadline_issue, deadline_tasks
):
    issue = deadline_issue
    url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issues/{issue.id}/"
    assert session_client.patch(url, {"deadline_at": "2026-10-10T25:00:00"}, format="json").status_code == 400
    other = Project.objects.create(name="Private", identifier="PVT", workspace=workspace)
    forbidden_url = f"/api/workspaces/{workspace.slug}/projects/{other.id}/issues/{issue.id}/"
    assert session_client.patch(forbidden_url, {"deadline_at": "2026-10-10T18:00:00"}, format="json").status_code in [
        403,
        404,
    ]
    deadline_tasks.assert_not_called()


@pytest.mark.contract
@pytest.mark.django_db
def test_calendar_date_edit_clears_deadline_only_inside_project(
    session_client, workspace, create_user, deadline_issue, deadline_tasks
):
    issue = deadline_issue
    Issue.objects.filter(id=issue.id).update(
        target_date=date(2026, 10, 10), deadline_at=datetime(2026, 10, 10, 15, 0, tzinfo=timezone.utc)
    )
    other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace)
    ProjectMember.objects.create(project=other, member=create_user, role=20)
    forbidden_url = f"/api/workspaces/{workspace.slug}/projects/{other.id}/issue-dates/"
    response = session_client.post(
        forbidden_url,
        {
            "updates": [{"id": str(issue.id), "target_date": "2026-10-11"}],
        },
        format="json",
    )
    assert response.status_code == 200
    issue.refresh_from_db()
    assert issue.deadline_at is not None
    deadline_tasks.assert_not_called()

    url = f"/api/workspaces/{workspace.slug}/projects/{issue.project_id}/issue-dates/"
    assert (
        session_client.post(
            url,
            {
                "updates": [{"id": str(issue.id), "target_date": "2026-10-11"}],
            },
            format="json",
        ).status_code
        == 200
    )
    issue.refresh_from_db()
    assert issue.target_date == date(2026, 10, 11)
    assert issue.deadline_at is None
    assert "deadline_at" in json.loads(deadline_tasks.call_args.kwargs["requested_data"])


@pytest.mark.contract
@pytest.mark.django_db
def test_deadline_report_queues_xlsx_with_access_check(session_client, workspace, deadline_issue):
    url = f"/api/workspaces/{workspace.slug}/export-issues/"
    with patch("plane.app.views.exporter.base.issue_export_task.delay") as delay:
        response = session_client.post(
            url,
            {
                "provider": "xlsx",
                "layout": "task_deadline",
                "project": [str(deadline_issue.project_id)],
            },
            format="json",
        )
        assert response.status_code == 200
        assert delay.call_args.kwargs["export_timezone"] == "Europe/Moscow"
        assert delay.call_args.kwargs["multiple"] is True
        assert ExporterHistory.objects.get().name == "task_deadline"
        other = Project.objects.create(name="Private", identifier="PVT", workspace=workspace)
        denied = session_client.post(
            url,
            {
                "provider": "xlsx",
                "layout": "task_deadline",
                "project": [str(other.id)],
            },
            format="json",
        )
        assert denied.status_code == 404
        assert delay.call_count == 1


@pytest.mark.contract
@pytest.mark.django_db
def test_deadline_worker_exports_every_task_once(workspace, create_user, deadline_issue):
    issue = deadline_issue
    Issue.objects.filter(id=issue.id).update(deadline_at=datetime(2026, 10, 10, 22, 30, tzinfo=timezone.utc))
    Issue.objects.bulk_create(
        [
            Issue(project=issue.project, workspace=workspace, state=issue.state, name="No deadline", sequence_id=2),
        ]
    )
    history = ExporterHistory.objects.create(
        workspace=workspace,
        project=[str(issue.project_id)],
        initiated_by=create_user,
        provider="xlsx",
        name="task_deadline",
    )
    with patch("plane.bgtasks.export_task.upload_to_s3") as upload:
        issue_export_task(
            provider="xlsx",
            workspace_id=workspace.id,
            project_ids=[str(issue.project_id)],
            token_id=history.token,
            multiple=False,
            slug=workspace.slug,
            layout="task_deadline",
            export_timezone="Europe/Moscow",
        )
    upload.assert_called_once()
    with zipfile.ZipFile(upload.call_args.args[0]) as archive:
        assert archive.namelist() == [f"{workspace.slug}-{issue.project_id}-task-deadline.xlsx"]
        workbook = load_workbook(io.BytesIO(archive.read(archive.namelist()[0])), read_only=True)
        rows = list(workbook.active.values)
        assert rows[0] == tuple(DEADLINE_HEADERS)
        assert rows[1][3:6] == ("2026-10-11", "01:30", "Europe/Moscow")
        assert rows[2][1] == "No deadline"
        assert len(rows) == 3
        workbook.close()
