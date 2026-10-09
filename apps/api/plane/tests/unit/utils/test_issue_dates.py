# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date, datetime, timezone as datetime_timezone
from types import SimpleNamespace

import pytest
from django.utils import timezone
from rest_framework import serializers

from plane.utils.issue_dates import validate_issue_dates


class DeadlineSerializer(serializers.Serializer):
    target_date = serializers.DateField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False, allow_null=True)
    deadline_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate(self, data):
        return validate_issue_dates(data, self.instance)


@pytest.mark.unit
def test_deadline_uses_profile_timezone_and_updates_calendar_date():
    with timezone.override("Europe/Moscow"):
        serializer = DeadlineSerializer(data={"deadline_at": "2026-10-10T18:30:00"})
        assert serializer.is_valid(), serializer.errors
        value = serializer.validated_data["deadline_at"]
        assert value.astimezone(datetime_timezone.utc) == datetime(2026, 10, 10, 15, 30, tzinfo=datetime_timezone.utc)
        assert serializer.validated_data["target_date"] == date(2026, 10, 10)


@pytest.mark.unit
@pytest.mark.parametrize("value", ["invalid", "2026-10-10T25:00:00"])
def test_invalid_deadline_is_rejected(value):
    serializer = DeadlineSerializer(data={"deadline_at": value})
    assert not serializer.is_valid()
    assert "deadline_at" in serializer.errors


@pytest.mark.unit
def test_dst_gap_is_rejected():
    with timezone.override("America/New_York"):
        serializer = DeadlineSerializer(data={"deadline_at": "2026-03-08T02:30:00"})
        assert not serializer.is_valid()


@pytest.mark.unit
@pytest.mark.parametrize("new_date", [date(2026, 10, 11), None])
def test_date_only_edit_removes_old_time(new_date):
    instance = SimpleNamespace(start_date=None, target_date=date(2026, 10, 10))
    data = validate_issue_dates({"target_date": new_date}, instance)
    assert data["deadline_at"] is None


@pytest.mark.unit
def test_removing_time_preserves_due_date():
    instance = SimpleNamespace(start_date=None, target_date=date(2026, 10, 10))
    assert validate_issue_dates({"deadline_at": None}, instance) == {"deadline_at": None}


@pytest.mark.unit
def test_partial_update_checks_existing_start_date():
    instance = SimpleNamespace(start_date=date(2026, 10, 11), target_date=None)
    serializer = DeadlineSerializer(instance, data={"deadline_at": "2026-10-10T18:00:00Z"}, partial=True)
    assert not serializer.is_valid()
    assert "target_date" in serializer.errors


@pytest.mark.unit
def test_conflicting_calendar_date_is_rejected():
    with timezone.override("UTC"):
        serializer = DeadlineSerializer(data={"target_date": "2026-10-11", "deadline_at": "2026-10-10T18:00:00Z"})
        assert not serializer.is_valid()
        assert "deadline_at" in serializer.errors


@pytest.mark.unit
def test_unrelated_edits_do_not_change_deadline():
    assert validate_issue_dates({}) == {}
