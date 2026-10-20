# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.shortcuts import get_object_or_404

# Third party imports
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.db.models import Module, Project
from plane.utils.time_budget import project_time_budget_summary, time_budget_summary
from .base import BaseAPIView


class ProjectTimeBudgetAPIEndpoint(BaseAPIView):
    """Monthly hour limit of a project and how much of it is used (read only)."""

    @extend_schema(operation_id="get_project_time_budget", summary="Project monthly hours limit", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        project = get_object_or_404(
            Project, pk=project_id, workspace__slug=slug, archived_at__isnull=True, deleted_at__isnull=True
        )
        return Response(project_time_budget_summary(project))


class ModuleTimeBudgetAPIEndpoint(BaseAPIView):
    """Monthly hour limit of a module and how much of it is used (read only)."""

    @extend_schema(operation_id="get_module_time_budget", summary="Module monthly hours limit", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, module_id):
        module = get_object_or_404(
            Module.objects.select_related("project"),
            pk=module_id,
            project_id=project_id,
            workspace__slug=slug,
            project__archived_at__isnull=True,
            project__deleted_at__isnull=True,
        )
        return Response(time_budget_summary(module))
