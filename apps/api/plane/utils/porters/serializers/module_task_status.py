# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework import serializers


class ModuleTaskStatusExportSerializer(serializers.Serializer):
    """One row per work item, including items without a module."""

    def to_representation(self, instance):
        module_names = sorted(
            {relation.module.name for relation in instance.export_modules},
            key=str.casefold,
        )
        return {
            "Модуль": ", ".join(module_names),
            "Задача": instance.name,
            "Статус": instance.state.name if instance.state else "",
        }
