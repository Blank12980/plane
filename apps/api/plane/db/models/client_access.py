# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.conf import settings
from django.db import models

from .project import ProjectBaseModel


class ClientAccessGrant(ProjectBaseModel):
    """An administrator's explicit read grant to one work item or page."""

    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="client_access_grants")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, null=True, blank=True, related_name="client_grants")
    page = models.ForeignKey("db.Page", on_delete=models.CASCADE, null=True, blank=True, related_name="client_grants")

    class Meta:
        db_table = "client_access_grants"
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(issue__isnull=False, page__isnull=True) | models.Q(issue__isnull=True, page__isnull=False)
                ),
                name="client_grant_one_resource",
            ),
            models.UniqueConstraint(
                fields=["client", "project", "issue"],
                condition=models.Q(deleted_at__isnull=True, issue__isnull=False),
                name="client_grant_unique_issue",
            ),
            models.UniqueConstraint(
                fields=["client", "project", "page"],
                condition=models.Q(deleted_at__isnull=True, page__isnull=False),
                name="client_grant_unique_page",
            ),
        ]


class ProjectClient(ProjectBaseModel):
    """A client that was added to a project.

    Being in a project gives a client no access by itself: they still see only the work items and pages an
    administrator opens for them (``ClientAccessGrant``). The link decides in which project's "Clients" settings the
    client is listed, so that every project administrator manages their own clients.
    """

    client = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_client_links")

    class Meta:
        db_table = "project_clients"
        constraints = [
            models.UniqueConstraint(
                fields=["client", "project"],
                condition=models.Q(deleted_at__isnull=True),
                name="project_client_unique_client_project",
            )
        ]
