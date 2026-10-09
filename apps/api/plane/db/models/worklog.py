# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models
from django.utils import timezone

# Module imports
from .project import ProjectBaseModel

# A single entry cannot exceed a calendar day.
MAX_WORKLOG_MINUTES = 24 * 60


class IssueWorkLog(ProjectBaseModel):
    """Time a member spent on a work item, stored in minutes."""

    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_worklogs")
    logged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="issue_worklogs",
    )
    duration_minutes = models.PositiveIntegerField()
    description = models.TextField(blank=True)
    logged_on = models.DateField(default=timezone.localdate)

    class Meta:
        verbose_name = "Issue Work Log"
        verbose_name_plural = "Issue Work Logs"
        db_table = "issue_worklogs"
        ordering = ("-logged_on", "-created_at")
        indexes = [
            models.Index(fields=["issue", "logged_on"], name="issue_worklog_issue_date_idx"),
        ]

    def __str__(self):
        return f"{self.issue_id} {self.logged_by_id} {self.duration_minutes}m"
