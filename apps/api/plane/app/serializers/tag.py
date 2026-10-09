# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import re

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from plane.db.models import WorkspaceTag

HEX_COLOR_PATTERN = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


class WorkspaceTagSerializer(BaseSerializer):
    image_url = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = WorkspaceTag
        fields = [
            "id",
            "workspace",
            "name",
            "color",
            "image_asset",
            "image_url",
            "created_at",
            "updated_at",
        ]
        # The image is attached through the asset endpoint (entity type TAG_IMAGE).
        read_only_fields = ["workspace", "image_asset", "image_url", "created_at", "updated_at"]

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("Tag name cannot be empty.")

        duplicates = WorkspaceTag.objects.filter(
            workspace__slug=self.context["slug"],
            name__iexact=name,
        )
        if self.instance is not None:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError("A tag with this name already exists in the workspace.")
        return name

    def validate_color(self, value):
        color = value.strip()
        if color and not HEX_COLOR_PATTERN.match(color):
            raise serializers.ValidationError("Color must be a hex value like #1a2b3c.")
        return color
