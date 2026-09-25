# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection

from plane.db.models import Project, State
from plane.db.models.state import DEFAULT_STATES, StateGroup


@pytest.mark.unit
class TestDefaultStates:
    def test_visible_default_task_states(self):
        visible = [state for state in DEFAULT_STATES if state["group"] != StateGroup.TRIAGE.value]

        assert [state["name"] for state in visible] == [
            "Бэклог",
            "На уточнении",
            "В работе",
            "На ревью",
            "Тестирование",
            "Готово",
        ]

        default_states = [state for state in visible if state.get("default")]
        assert len(default_states) == 1
        assert default_states[0]["name"] == "Бэклог"
        assert default_states[0]["group"] == StateGroup.BACKLOG.value

        groups_by_name = {state["name"]: state["group"] for state in visible}
        assert groups_by_name["Бэклог"] == StateGroup.BACKLOG.value
        assert groups_by_name["На уточнении"] == StateGroup.UNSTARTED.value
        assert groups_by_name["В работе"] == StateGroup.STARTED.value
        assert groups_by_name["На ревью"] == StateGroup.STARTED.value
        assert groups_by_name["Тестирование"] == StateGroup.STARTED.value
        assert groups_by_name["Готово"] == StateGroup.COMPLETED.value

    @pytest.mark.django_db
    def test_existing_project_gets_testing_state_once(self, workspace):
        project = Project.objects.create(name="Existing project", identifier="EX", workspace=workspace)
        State.objects.bulk_create(
            [
                State(
                    name=name,
                    color="#8B5CF6",
                    sequence=sequence,
                    group=group,
                    project=project,
                    workspace=workspace,
                )
                for name, sequence, group in [
                    ("На ревью", 40000, StateGroup.STARTED.value),
                    ("Готово", 45000, StateGroup.COMPLETED.value),
                ]
            ]
        )

        migration = import_module("plane.db.migrations.0130_testing_task_state")
        schema_editor = SimpleNamespace(connection=connection)
        migration.add_testing_task_state(apps, schema_editor)
        migration.add_testing_task_state(apps, schema_editor)

        testing_states = State.objects.filter(project=project, name="Тестирование")
        assert testing_states.count() == 1
        assert testing_states.get().group == StateGroup.STARTED.value
        assert list(State.objects.filter(project=project).values_list("name", flat=True)) == [
            "На ревью",
            "Тестирование",
            "Готово",
        ]
