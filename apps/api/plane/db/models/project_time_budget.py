import uuid

from django.db import models


class ProjectTimeBudget(models.Model):
    """Monthly hour limit of a whole project.

    The project total is made of two parts that can be switched on independently:
    work items that belong to a module (with their sub-work-items) and the specific work items that are not in any
    module.
    """

    project = models.OneToOneField("db.Project", on_delete=models.CASCADE, primary_key=True, related_name="time_budget")
    limit_minutes = models.PositiveIntegerField(null=True, blank=True)
    count_module_tasks = models.BooleanField(default=True)
    count_other_tasks = models.BooleanField(default=True)
    include_subtasks = models.BooleanField(default=True)

    class Meta:
        db_table = "project_time_budgets"
        constraints = [
            models.CheckConstraint(
                check=models.Q(limit_minutes__isnull=True) | models.Q(limit_minutes__gt=0),
                name="project_time_budget_positive",
            )
        ]


class ProjectTimeBudgetAlert(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey("db.Project", on_delete=models.CASCADE, related_name="time_budget_alerts")
    month = models.DateField()
    limit_minutes = models.PositiveIntegerField()
    total_minutes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "project_time_budget_alerts"
        constraints = [models.UniqueConstraint(fields=["project", "month"], name="project_time_budget_alert_month")]
