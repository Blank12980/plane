from datetime import date
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from plane.db.models import IssueWorkLog, Module, ModuleIssue, Notification, ProjectMember, WorkspaceMember
from plane.db.models.module_time_budget import ModuleTimeBudget, ModuleTimeBudgetAlert


def module_month(module):
    return timezone.localdate(timezone=ZoneInfo(module.project.timezone)).replace(day=1)


def monthly_minutes(module, month):
    end = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    # A subquery avoids multiplying time when an issue has several module links.
    issues = ModuleIssue.objects.filter(module=module, project_id=module.project_id).values("issue_id")
    return (
        IssueWorkLog.objects.filter(
            project_id=module.project_id,
            issue_id__in=issues,
            issue__deleted_at__isnull=True,
            logged_on__gte=month,
            logged_on__lt=end,
        ).aggregate(total=Sum("duration_minutes"))["total"]
        or 0
    )


def time_budget_summary(module):
    month = module_month(module)
    limit = ModuleTimeBudget.objects.filter(module=module).values_list("limit_minutes", flat=True).first()
    total = monthly_minutes(module, month)
    return {
        "month": month.isoformat(),
        "limit_minutes": limit,
        "total_minutes": total,
        "reached": limit is not None and total >= limit,
    }


@transaction.atomic
def check_module_time_budget(module_id, month=None):
    # Serialize concurrent entries and claim the alert in the same transaction as its notifications.
    budget = (
        ModuleTimeBudget.objects.select_for_update(of=("self",))
        .select_related("module__project__workspace")
        .filter(
            module_id=module_id,
            module__deleted_at__isnull=True,
            module__archived_at__isnull=True,
            module__project__deleted_at__isnull=True,
            module__project__archived_at__isnull=True,
        )
        .first()
    )
    if budget is None or budget.limit_minutes is None:
        return
    module = budget.module
    month = (month or module_month(module)).replace(day=1)
    total = monthly_minutes(module, month)
    if total < budget.limit_minutes:
        return
    alert, created = ModuleTimeBudgetAlert.objects.get_or_create(
        module=module,
        month=month,
        defaults={"limit_minutes": budget.limit_minutes, "total_minutes": total},
    )
    if not created:
        return
    project_members = ProjectMember.objects.filter(
        project_id=module.project_id,
        is_active=True,
        role__gte=15,
        is_instance_admin_access=False,
    ).values("member_id")
    recipients = (
        WorkspaceMember.objects.filter(
            Q(member_id__in=project_members) | Q(role=20),
            workspace_id=module.workspace_id,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        )
        .values_list("member_id", flat=True)
        .distinct()
    )
    title = f"Достигнут месячный лимит часов модуля «{module.name}»"
    Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=module.workspace_id,
                project_id=module.project_id,
                receiver_id=recipient,
                entity_name="module",
                entity_identifier=module.id,
                sender="in_app:module:time_budget",
                title=title,
                data={
                    "module": {"id": str(module.id), "name": module.name},
                    "time_budget": {
                        "month": month.isoformat(),
                        "limit_minutes": alert.limit_minutes,
                        "total_minutes": total,
                    },
                },
            )
            for recipient in recipients
        ]
    )


def check_issue_time_budgets(issue_id, month):
    modules = ModuleIssue.objects.filter(issue_id=issue_id).values_list("module_id", flat=True)
    for module_id in modules.distinct():
        check_module_time_budget(module_id, month)


def check_linked_module_time_budgets(module_ids):
    """Also check existing time when tasks are attached using bulk_create."""
    for module in Module.objects.filter(pk__in=module_ids).select_related("project"):
        month = module_month(module)
        check_module_time_budget(module.id, month)
