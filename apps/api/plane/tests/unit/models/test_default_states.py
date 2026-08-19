# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

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
        assert groups_by_name["Готово"] == StateGroup.COMPLETED.value
