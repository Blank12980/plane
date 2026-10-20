"""Monthly hour limits ("time budgets") for modules and projects.

A module budget counts everything below the module: the work items that are linked to it and, optionally, their
sub-work-items. A project budget counts everything below the project, split in two parts that are switched on
independently: the work items that live in modules and the specific work items that are not part of any module.

Every limit is reported once per calendar month (in the project's time zone) to the project members and the workspace
admins.
"""

from datetime import date
from zoneinfo import ZoneInfo

from django.db import transaction
from django.db.models import Q, Sum
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueWorkLog,
    Module,
    ModuleIssue,
    Notification,
    Project,
    ProjectMember,
    WorkspaceMember,
)
from plane.db.models.module_time_budget import ModuleTimeBudget, ModuleTimeBudgetAlert
from plane.db.models.project_time_budget import ProjectTimeBudget, ProjectTimeBudgetAlert

# How many levels of nested sub-work-items are counted below a work item.
MAX_SUBTASK_DEPTH = 5


# --------------------------------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------------------------------
def project_month(project):
    return timezone.localdate(timezone=ZoneInfo(project.timezone)).replace(day=1)


def module_month(module):
    return project_month(module.project)


def _month_end(month):
    return date(month.year + (month.month == 12), month.month % 12 + 1, 1)


def _month_worklogs(project_id, month):
    return IssueWorkLog.objects.filter(
        project_id=project_id,
        issue__deleted_at__isnull=True,
        logged_on__gte=month,
        logged_on__lt=_month_end(month),
    )


def _scope_filter(base_issue_ids, include_subtasks):
    """Q object selecting worklogs of the given work items and, optionally, of everything nested below them.

    The levels are OR-ed together in one condition (instead of summing level by level), so a work item that is both
    linked to the module and a child of another linked work item is never counted twice.
    """
    condition = Q(issue_id__in=base_issue_ids)
    if include_subtasks:
        level = Issue.objects.filter(pk__in=base_issue_ids).values("pk")
        for _ in range(MAX_SUBTASK_DEPTH):
            level = Issue.objects.filter(parent_id__in=level).values("pk")
            condition |= Q(issue_id__in=level)
    return condition


def _sum_minutes(queryset):
    return queryset.aggregate(total=Sum("duration_minutes"))["total"] or 0


def _module_issue_ids(module):
    # A subquery avoids multiplying time when an issue has several module links.
    return ModuleIssue.objects.filter(module=module, project_id=module.project_id).values("issue_id")


def _project_module_issue_ids(project_id):
    return ModuleIssue.objects.filter(project_id=project_id, module__deleted_at__isnull=True).values("issue_id")


# --------------------------------------------------------------------------------------------------------------------
# totals
# --------------------------------------------------------------------------------------------------------------------
def monthly_minutes(module, month, include_subtasks=None):
    if include_subtasks is None:
        include_subtasks = (
            ModuleTimeBudget.objects.filter(module=module).values_list("include_subtasks", flat=True).first()
        )
        include_subtasks = True if include_subtasks is None else include_subtasks
    worklogs = _month_worklogs(module.project_id, month)
    return _sum_minutes(worklogs.filter(_scope_filter(_module_issue_ids(module), include_subtasks)))


def project_monthly_minutes(project, month, budget=None):
    """Return (counted, module_part, other_part) minutes for the project in the month."""
    budget = budget or ProjectTimeBudget.objects.filter(project=project).first()
    count_modules = True if budget is None else budget.count_module_tasks
    count_other = True if budget is None else budget.count_other_tasks
    include_subtasks = True if budget is None else budget.include_subtasks

    worklogs = _month_worklogs(project.id, month)
    everything = _sum_minutes(worklogs)
    in_modules = _sum_minutes(worklogs.filter(_scope_filter(_project_module_issue_ids(project.id), include_subtasks)))
    other = everything - in_modules
    counted = (in_modules if count_modules else 0) + (other if count_other else 0)
    return counted, in_modules, other


def time_budget_summary(module):
    month = module_month(module)
    budget = ModuleTimeBudget.objects.filter(module=module).first()
    limit = budget.limit_minutes if budget else None
    include_subtasks = budget.include_subtasks if budget else True
    total = monthly_minutes(module, month, include_subtasks)
    return {
        "month": month.isoformat(),
        "limit_minutes": limit,
        "include_subtasks": include_subtasks,
        "total_minutes": total,
        "reached": limit is not None and total >= limit,
    }


def project_time_budget_summary(project):
    month = project_month(project)
    budget = ProjectTimeBudget.objects.filter(project=project).first()
    limit = budget.limit_minutes if budget else None
    total, module_minutes, other_minutes = project_monthly_minutes(project, month, budget)
    return {
        "month": month.isoformat(),
        "limit_minutes": limit,
        "count_module_tasks": budget.count_module_tasks if budget else True,
        "count_other_tasks": budget.count_other_tasks if budget else True,
        "include_subtasks": budget.include_subtasks if budget else True,
        "total_minutes": total,
        "module_minutes": module_minutes,
        "other_minutes": other_minutes,
        "reached": limit is not None and total >= limit,
    }


# --------------------------------------------------------------------------------------------------------------------
# notifications
# --------------------------------------------------------------------------------------------------------------------
def _recipient_ids(project_id, workspace_id):
    project_members = ProjectMember.objects.filter(
        project_id=project_id,
        is_active=True,
        role__gte=15,
        is_instance_admin_access=False,
    ).values("member_id")
    return list(
        WorkspaceMember.objects.filter(
            Q(member_id__in=project_members) | Q(role=20),
            workspace_id=workspace_id,
            is_active=True,
            role__gte=15,
            member__is_active=True,
        )
        .values_list("member_id", flat=True)
        .distinct()
    )


def _notify(*, project, entity_name, entity_id, sender, title, data):
    Notification.objects.bulk_create(
        [
            Notification(
                workspace_id=project.workspace_id,
                project_id=project.id,
                receiver_id=recipient,
                entity_name=entity_name,
                entity_identifier=entity_id,
                sender=sender,
                title=title,
                data=data,
            )
            for recipient in _recipient_ids(project.id, project.workspace_id)
        ]
    )


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
    total = monthly_minutes(module, month, budget.include_subtasks)
    if total < budget.limit_minutes:
        return
    alert, created = ModuleTimeBudgetAlert.objects.get_or_create(
        module=module,
        month=month,
        defaults={"limit_minutes": budget.limit_minutes, "total_minutes": total},
    )
    if not created:
        return
    _notify(
        project=module.project,
        entity_name="module",
        entity_id=module.id,
        sender="in_app:module:time_budget",
        title=f"Достигнут месячный лимит часов модуля «{module.name}»",
        data={
            "module": {"id": str(module.id), "name": module.name},
            "time_budget": {
                "month": month.isoformat(),
                "limit_minutes": alert.limit_minutes,
                "total_minutes": total,
            },
        },
    )


@transaction.atomic
def check_project_time_budget(project_id, month=None):
    budget = (
        ProjectTimeBudget.objects.select_for_update(of=("self",))
        .select_related("project__workspace")
        .filter(
            project_id=project_id,
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
        )
        .first()
    )
    if budget is None or budget.limit_minutes is None:
        return
    project = budget.project
    month = (month or project_month(project)).replace(day=1)
    total, _, _ = project_monthly_minutes(project, month, budget)
    if total < budget.limit_minutes:
        return
    alert, created = ProjectTimeBudgetAlert.objects.get_or_create(
        project=project,
        month=month,
        defaults={"limit_minutes": budget.limit_minutes, "total_minutes": total},
    )
    if not created:
        return
    _notify(
        project=project,
        entity_name="project",
        entity_id=project.id,
        sender="in_app:project:time_budget",
        title=f"Достигнут месячный лимит часов проекта «{project.name}»",
        data={
            "project": {"id": str(project.id), "name": project.name},
            "time_budget": {
                "month": month.isoformat(),
                "limit_minutes": alert.limit_minutes,
                "total_minutes": total,
            },
        },
    )


def _issue_and_ancestor_ids(issue_id):
    ids, current = [issue_id], issue_id
    for _ in range(MAX_SUBTASK_DEPTH):
        current = Issue.objects.filter(pk=current).values_list("parent_id", flat=True).first()
        if not current or current in ids:
            break
        ids.append(current)
    return ids


def check_issue_time_budgets(issue_id, month):
    """Check every limit the logged time can count towards: the modules of the work item and of its ancestors, and the
    project."""
    project_id = Issue.objects.filter(pk=issue_id).values_list("project_id", flat=True).first()
    if project_id is None:
        return
    module_ids = ModuleIssue.objects.filter(issue_id__in=_issue_and_ancestor_ids(issue_id)).values_list(
        "module_id", flat=True
    )
    for module_id in set(module_ids):
        check_module_time_budget(module_id, month)
    check_project_time_budget(project_id, month)


def check_linked_module_time_budgets(module_ids):
    """Also check existing time when tasks are attached using bulk_create."""
    project_ids = set()
    for module in Module.objects.filter(pk__in=module_ids).select_related("project"):
        check_module_time_budget(module.id, module_month(module))
        project_ids.add(module.project_id)
    # moving work items into or out of a module changes the split of the project total
    for project in Project.objects.filter(pk__in=project_ids):
        check_project_time_budget(project.id, project_month(project))
