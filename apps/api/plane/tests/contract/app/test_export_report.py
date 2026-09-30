# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import patch

import pytest

from plane.db.models import ExporterHistory, Project, ProjectMember


@pytest.mark.contract
@pytest.mark.django_db
def test_report_request_queues_one_file_per_accessible_project(session_client, workspace, create_user):
    project = Project.objects.create(name="Export project", identifier="EXP", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    inaccessible = Project.objects.create(name="Other project", identifier="OTH", workspace=workspace)
    url = f"/api/workspaces/{workspace.slug}/export-issues/"

    with patch("plane.app.views.exporter.base.issue_export_task.delay") as delay:
        response = session_client.post(
            url,
            {"provider": "csv", "project": [str(project.id)], "layout": "module_task_status", "multiple": False},
            format="json",
        )

        assert response.status_code == 200
        assert delay.call_args.kwargs["layout"] == "module_task_status"
        assert delay.call_args.kwargs["multiple"] is True
        assert delay.call_args.kwargs["project_ids"] == [str(project.id)]
        assert ExporterHistory.objects.get().name == "module_task_status"

        forbidden = session_client.post(
            url,
            {"provider": "csv", "project": [str(inaccessible.id)], "layout": "module_task_status"},
            format="json",
        )
        assert forbidden.status_code == 404
        assert delay.call_count == 1
