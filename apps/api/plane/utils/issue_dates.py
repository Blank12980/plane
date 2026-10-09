# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timezone as datetime_timezone

from django.utils import timezone
from rest_framework import serializers


def validate_issue_dates(data, instance=None):
    """Keep the calendar date and the optional precise deadline consistent."""
    if data.get("deadline_at") is not None:
        deadline = data["deadline_at"]
        roundtrip = deadline.astimezone(datetime_timezone.utc).astimezone(deadline.tzinfo)
        if roundtrip.replace(tzinfo=None) != deadline.replace(tzinfo=None):
            raise serializers.ValidationError({"deadline_at": "This local time does not exist in your timezone."})
        deadline_date = timezone.localtime(data["deadline_at"]).date()
        if "target_date" in data and data["target_date"] != deadline_date:
            raise serializers.ValidationError({"deadline_at": "Deadline must match the target date."})
        data["target_date"] = deadline_date
    elif "target_date" in data:
        # Date-only edits, including calendar drag operations, remove the old time.
        data["deadline_at"] = None

    start = data.get("start_date", getattr(instance, "start_date", None))
    target = data.get("target_date", getattr(instance, "target_date", None))
    if start is not None and target is not None and start > target:
        raise serializers.ValidationError({"target_date": "Start date cannot exceed target date."})
    return data
