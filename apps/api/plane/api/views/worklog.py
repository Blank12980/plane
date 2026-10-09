# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid
from datetime import date

# Django imports
from django.db.models import Count, F, Sum
from django.db.models.functions import Concat
from django.db.models import CharField, Value

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema

# Module imports
from plane.app.permissions import allow_permission, ROLE
from plane.app.serializers import IssueWorkLogSerializer
from plane.db.models import Issue, IssueWorkLog, ProjectMember
from .base import BaseAPIView

TIME_REPORT_GROUPS = ("user", "issue", "project", "day")
TIME_REPORT_MAX_ROWS = 1000


class WorkItemWorkLogAPIEndpoint(BaseAPIView):
    """Time spent on a work item.

    Through the public API every token acts strictly on its own entries: it can log time only as
    its own user and change or delete only its own work logs (admins correct others in the app).
    """

    token_scope_resource = "worklogs"

    def get_queryset(self, slug, project_id, issue_id):
        return IssueWorkLog.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
            issue_id=issue_id,
        ).select_related("logged_by")

    def get_issue(self, slug, project_id, issue_id):
        return Issue.issue_objects.filter(pk=issue_id, project_id=project_id, workspace__slug=slug).first()

    @extend_schema(operation_id="list_work_item_worklogs", summary="List work logs of a work item", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def get(self, request, slug, project_id, issue_id):
        if self.get_issue(slug, project_id, issue_id) is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        worklogs = self.get_queryset(slug, project_id, issue_id)
        data = IssueWorkLogSerializer(worklogs, many=True).data
        total = sum(entry["duration_minutes"] for entry in data)
        return Response({"total_minutes": total, "results": data}, status=status.HTTP_200_OK)

    @extend_schema(operation_id="create_work_item_worklog", summary="Log time on a work item", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, issue_id):
        issue = self.get_issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Work item not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = IssueWorkLogSerializer(data=request.data)
        if serializer.is_valid():
            # logged_by is read-only: time is always logged for the token's own user
            serializer.save(issue=issue, project_id=project_id, logged_by=request.user)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def get_own_worklog(self, request, slug, project_id, issue_id, pk):
        worklog = self.get_queryset(slug, project_id, issue_id).filter(pk=pk).first()
        if worklog is None:
            return None, Response({"error": "Work log not found."}, status=status.HTTP_404_NOT_FOUND)
        if worklog.logged_by_id != request.user.id:
            return None, Response(
                {"error": "You can only change your own work logs."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return worklog, None

    @extend_schema(operation_id="update_work_item_worklog", summary="Update own work log", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, issue_id, pk):
        worklog, error = self.get_own_worklog(request, slug, project_id, issue_id, pk)
        if error is not None:
            return error
        serializer = IssueWorkLogSerializer(worklog, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(operation_id="delete_work_item_worklog", summary="Delete own work log", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, issue_id, pk):
        worklog, error = self.get_own_worklog(request, slug, project_id, issue_id, pk)
        if error is not None:
            return error
        worklog.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def _parse_date(value, name):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{name} must be a date in YYYY-MM-DD format.")


def _parse_uuid(value, name):
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise ValueError(f"{name} must be a valid id.")


class TimeReportAPIEndpoint(BaseAPIView):
    """Aggregated logged time across the projects where the caller is an admin or member.

    Query params: ``date_from``, ``date_to`` (YYYY-MM-DD, inclusive), ``project_id``, ``issue_id``,
    ``user_id`` (or ``me``) and ``group_by`` (user | issue | project | day, default user).
    """

    @extend_schema(operation_id="get_time_report", summary="Aggregated time report", tags=["Worklogs"])
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def get(self, request, slug):
        group_by = request.GET.get("group_by", "user")
        if group_by not in TIME_REPORT_GROUPS:
            return Response(
                {"error": f"group_by must be one of: {', '.join(TIME_REPORT_GROUPS)}."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            date_from = _parse_date(request.GET.get("date_from"), "date_from")
            date_to = _parse_date(request.GET.get("date_to"), "date_to")
            project_id = _parse_uuid(request.GET.get("project_id"), "project_id")
            issue_id = _parse_uuid(request.GET.get("issue_id"), "issue_id")
            raw_user = request.GET.get("user_id")
            user_id = request.user.id if raw_user == "me" else _parse_uuid(raw_user, "user_id")
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        if date_from and date_to and date_from > date_to:
            return Response({"error": "date_from must not be after date_to."}, status=status.HTTP_400_BAD_REQUEST)

        visible_projects = ProjectMember.objects.filter(
            workspace__slug=slug,
            member=request.user,
            is_active=True,
            role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
        ).values_list("project_id", flat=True)

        worklogs = IssueWorkLog.objects.filter(
            workspace__slug=slug,
            project_id__in=visible_projects,
            issue__deleted_at__isnull=True,
        )
        if date_from:
            worklogs = worklogs.filter(logged_on__gte=date_from)
        if date_to:
            worklogs = worklogs.filter(logged_on__lte=date_to)
        if project_id:
            worklogs = worklogs.filter(project_id=project_id)
        if issue_id:
            worklogs = worklogs.filter(issue_id=issue_id)
        if user_id:
            worklogs = worklogs.filter(logged_by_id=user_id)

        totals = worklogs.aggregate(total_minutes=Sum("duration_minutes"), entries=Count("id"))

        if group_by == "user":
            rows = worklogs.values(
                user_id=F("logged_by_id"),
                display_name=F("logged_by__display_name"),
                email=F("logged_by__email"),
            ).order_by("display_name")
        elif group_by == "issue":
            rows = worklogs.values(
                issue_id_value=F("issue_id"),
                project_id_value=F("project_id"),
                name=F("issue__name"),
                identifier=Concat(
                    F("project__identifier"), Value("-"), F("issue__sequence_id"), output_field=CharField()
                ),
            ).order_by("identifier")
        elif group_by == "project":
            rows = worklogs.values(
                project_id_value=F("project_id"),
                name=F("project__name"),
                identifier=F("project__identifier"),
            ).order_by("identifier")
        else:
            rows = worklogs.values(day=F("logged_on")).order_by("day")

        rows = rows.annotate(minutes=Sum("duration_minutes"), entries=Count("id"))[:TIME_REPORT_MAX_ROWS]

        results = []
        for row in rows:
            row = dict(row)
            if "issue_id_value" in row:
                row["issue_id"] = row.pop("issue_id_value")
            if "project_id_value" in row:
                row["project_id"] = row.pop("project_id_value")
            for key, value in list(row.items()):
                if isinstance(value, (uuid.UUID, date)):
                    row[key] = str(value)
            results.append(row)

        return Response(
            {
                "group_by": group_by,
                "filters": {
                    "date_from": str(date_from) if date_from else None,
                    "date_to": str(date_to) if date_to else None,
                    "project_id": str(project_id) if project_id else None,
                    "issue_id": str(issue_id) if issue_id else None,
                    "user_id": str(user_id) if user_id else None,
                },
                "total_minutes": totals["total_minutes"] or 0,
                "entries": totals["entries"] or 0,
                "results": results,
            },
            status=status.HTTP_200_OK,
        )
