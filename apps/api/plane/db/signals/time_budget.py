from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from plane.db.models import IssueWorkLog, ModuleIssue
from plane.utils.time_budget import check_issue_time_budgets, check_linked_module_time_budgets


@receiver(post_save, sender=IssueWorkLog, dispatch_uid="worklog_time_budget")
def worklog_saved(sender, instance, raw=False, **kwargs):
    if not raw and instance.deleted_at is None:
        # Model saves accept ISO strings too; signals run before a DB reload.
        logged_on = sender._meta.get_field("logged_on").to_python(instance.logged_on)
        issue_id, month = instance.issue_id, logged_on.replace(day=1)
        transaction.on_commit(lambda: check_issue_time_budgets(issue_id, month), robust=True)


@receiver(post_save, sender=ModuleIssue, dispatch_uid="module_link_time_budget")
def module_link_saved(sender, instance, raw=False, **kwargs):
    if not raw and instance.deleted_at is None:
        module_id = instance.module_id
        transaction.on_commit(lambda: check_linked_module_time_budgets([module_id]), robust=True)
