from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project
from plane.db.models.project_time_budget import ProjectTimeBudget
from plane.utils.time_budget import check_project_time_budget, project_time_budget_summary


class ProjectTimeBudgetSerializer(serializers.Serializer):
    limit_minutes = serializers.IntegerField(min_value=1, max_value=2147483647, allow_null=True, required=False)
    # Which parts of the project count: work items in modules and the specific work items outside of any module.
    count_module_tasks = serializers.BooleanField(required=False)
    count_other_tasks = serializers.BooleanField(required=False)
    include_subtasks = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Nothing to update.")
        if attrs.get("limit_minutes") is not None and (
            attrs.get("count_module_tasks") is False and attrs.get("count_other_tasks") is False
        ):
            raise serializers.ValidationError("Count at least one of: work items in modules, other work items.")
        return attrs


class ProjectTimeBudgetEndpoint(BaseAPIView):
    def get_project(self, slug, project_id):
        return get_object_or_404(
            Project,
            workspace__slug=slug,
            pk=project_id,
            archived_at__isnull=True,
            deleted_at__isnull=True,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id):
        return Response(project_time_budget_summary(self.get_project(slug, project_id)))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id):
        project = self.get_project(slug, project_id)
        serializer = ProjectTimeBudgetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            current = ProjectTimeBudget.objects.filter(project=project).first()
            count_modules = data.get("count_module_tasks", current.count_module_tasks if current else True)
            count_other = data.get("count_other_tasks", current.count_other_tasks if current else True)
            if not count_modules and not count_other:
                raise serializers.ValidationError("Count at least one of: work items in modules, other work items.")
            ProjectTimeBudget.objects.update_or_create(project=project, defaults=data)
            check_project_time_budget(project.id)
        return Response(project_time_budget_summary(project))
