# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from datetime import timedelta

# Django imports
from django.utils import timezone

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer
from .user import UserLiteSerializer
from plane.db.models import IssueWorkLog
from plane.db.models.worklog import MAX_WORKLOG_MINUTES


class IssueWorkLogSerializer(BaseSerializer):
    logged_by_detail = UserLiteSerializer(read_only=True, source="logged_by")

    class Meta:
        model = IssueWorkLog
        fields = [
            "id",
            "issue",
            "project",
            "workspace",
            "logged_by",
            "logged_by_detail",
            "duration_minutes",
            "description",
            "logged_on",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "issue",
            "project",
            "workspace",
            "logged_by",
            "created_at",
            "updated_at",
        ]

    def validate_duration_minutes(self, value):
        if value < 1 or value > MAX_WORKLOG_MINUTES:
            raise serializers.ValidationError("Logged time must be between 1 minute and 24 hours.")
        return value

    def validate_logged_on(self, value):
        # One day of slack covers users whose local date is ahead of the server's.
        if value > timezone.localdate() + timedelta(days=1):
            raise serializers.ValidationError("Time cannot be logged for a future date.")
        return value

    def validate_description(self, value):
        return value.strip()
