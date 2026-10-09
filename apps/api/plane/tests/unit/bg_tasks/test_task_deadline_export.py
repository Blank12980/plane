# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import io
from datetime import date, datetime, timezone
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook

from plane.utils.porters.exporter import DataExporter
from plane.utils.porters.serializers.task_deadline import TaskDeadlineExportSerializer, DEADLINE_HEADERS


def task(deadline=None, target=None):
    return SimpleNamespace(
        name="=1+1",
        project=SimpleNamespace(identifier="TASK"),
        sequence_id=7,
        state=SimpleNamespace(name="В работе"),
        deadline_at=deadline,
        target_date=target,
    )


@pytest.mark.unit
def test_deadline_report_uses_requested_timezone_across_day_boundary():
    row = TaskDeadlineExportSerializer(
        task(datetime(2026, 10, 10, 22, 30, tzinfo=timezone.utc)),
        context={"export_timezone": "Europe/Moscow"},
    ).data
    assert row["Дата дедлайна"] == "2026-10-11"
    assert row["Время дедлайна"] == "01:30"
    assert row["Часовой пояс"] == "Europe/Moscow"
    assert row["Код"] == "TASK-7"


@pytest.mark.unit
@pytest.mark.parametrize("target,expected", [(None, ""), (date(2026, 10, 10), "2026-10-10")])
def test_date_only_and_unscheduled_tasks_are_kept(target, expected):
    row = TaskDeadlineExportSerializer(task(target=target)).data
    assert row["Дата дедлайна"] == expected
    assert row["Время дедлайна"] == ""


@pytest.mark.unit
def test_xlsx_has_deadline_headers_and_safe_task_titles():
    exporter = DataExporter(TaskDeadlineExportSerializer, format_type="xlsx", headers=DEADLINE_HEADERS)
    for tasks in ([], [task(datetime(2026, 10, 10, 18, 0, tzinfo=timezone.utc))]):
        name, content = exporter.export("deadlines", tasks)
        assert name == "deadlines.xlsx"
        workbook = load_workbook(io.BytesIO(content), read_only=True)
        assert list(workbook.active.values)[0] == tuple(DEADLINE_HEADERS)
        if tasks:
            assert workbook.active["B2"].value == "'=1+1"
            assert workbook.active["B2"].data_type == "s"
            assert workbook.active["E2"].value == "18:00"
        workbook.close()
