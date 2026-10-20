from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Module
from plane.db.models.module_time_budget import ModuleTimeBudget
from plane.utils.time_budget import check_module_time_budget, time_budget_summary


class TimeBudgetSerializer(serializers.Serializer):
    limit_minutes = serializers.IntegerField(min_value=1, max_value=2147483647, allow_null=True, required=False)
    # Whether the time logged on sub-work-items of the module's work items counts as well.
    include_subtasks = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Provide limit_minutes and/or include_subtasks.")
        return attrs


class ModuleTimeBudgetEndpoint(BaseAPIView):
    def get_module(self, slug, project_id, module_id):
        return get_object_or_404(
            Module.objects.select_related("project"),
            workspace__slug=slug,
            project_id=project_id,
            pk=module_id,
            project__archived_at__isnull=True,
            project__deleted_at__isnull=True,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, module_id):
        return Response(time_budget_summary(self.get_module(slug, project_id, module_id)))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, module_id):
        module = self.get_module(slug, project_id, module_id)
        if module.archived_at:
            raise serializers.ValidationError("Archived module cannot be updated.")
        serializer = TimeBudgetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            ModuleTimeBudget.objects.update_or_create(module=module, defaults=serializer.validated_data)
            check_module_time_budget(module.id)
        return Response(time_budget_summary(module))
