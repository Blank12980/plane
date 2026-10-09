# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework import serializers


DEADLINE_HEADERS = ["Код", "Задача", "Статус", "Дата дедлайна", "Время дедлайна", "Часовой пояс"]


class TaskDeadlineExportSerializer(serializers.Serializer):
    """One row per task, with deadlines in the exporting user's timezone."""

    def to_representation(self, instance):
        zone = self.context.get("export_timezone", "UTC")
        deadline = timezone.localtime(instance.deadline_at, ZoneInfo(zone)) if instance.deadline_at else None
        return {
            "Код": f"{instance.project.identifier}-{instance.sequence_id}",
            "Задача": instance.name,
            "Статус": instance.state.name if instance.state else "",
            "Дата дедлайна": deadline.strftime("%Y-%m-%d")
            if deadline
            else (instance.target_date.isoformat() if instance.target_date else ""),
            "Время дедлайна": deadline.strftime("%H:%M") if deadline else "",
            "Часовой пояс": zone if deadline else "",
        }
