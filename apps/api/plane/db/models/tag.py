# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower

# Module imports
from .base import BaseModel
from .project import ProjectBaseModel


class WorkspaceTag(BaseModel):
    """A tag defined once in workspace settings and usable by work items of every project."""

    workspace = models.ForeignKey("db.Workspace", on_delete=models.CASCADE, related_name="workspace_tags")
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=255, blank=True)
    image_asset = models.ForeignKey(
        "db.FileAsset",
        on_delete=models.SET_NULL,
        related_name="tag_images",
        null=True,
        blank=True,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("name"),
                "workspace",
                condition=Q(deleted_at__isnull=True),
                name="workspace_tag_unique_name_when_not_deleted",
            ),
        ]
        verbose_name = "Workspace Tag"
        verbose_name_plural = "Workspace Tags"
        db_table = "workspace_tags"
        ordering = ("name",)

    @property
    def image_url(self):
        return self.image_asset.asset_url if self.image_asset_id else None

    def __str__(self):
        return str(self.name)


class IssueTag(ProjectBaseModel):
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="issue_tags")
    tag = models.ForeignKey("db.WorkspaceTag", on_delete=models.CASCADE, related_name="tag_issues")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["issue", "tag"],
                condition=Q(deleted_at__isnull=True),
                name="issue_tag_unique_when_not_deleted",
            ),
        ]
        verbose_name = "Issue Tag"
        verbose_name_plural = "Issue Tags"
        db_table = "issue_tags"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.issue_id} {self.tag_id}"
