# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers


HOURS_HEADERS = ["Код", "Задача", "Статус", "Часы"]


class TaskHoursExportSerializer(serializers.Serializer):
    """One row per task with the total time logged on it, in hours."""

    def to_representation(self, instance):
        # `logged_minutes` is annotated by the export task; `Часы` stays numeric so Excel can sum it.
        minutes = getattr(instance, "logged_minutes", 0) or 0
        return {
            "Код": f"{instance.project.identifier}-{instance.sequence_id}",
            "Задача": instance.name,
            "Статус": instance.state.name if instance.state else "",
            "Часы": round(minutes / 60, 2),
        }
