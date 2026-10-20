import uuid

from django.db import models


class ModuleTimeBudget(models.Model):
    module = models.OneToOneField("db.Module", on_delete=models.CASCADE, primary_key=True, related_name="time_budget")
    limit_minutes = models.PositiveIntegerField(null=True, blank=True)
    # Count the time logged on sub-work-items of the module's work items as well ("everything below the module").
    include_subtasks = models.BooleanField(default=True)

    class Meta:
        db_table = "module_time_budgets"
        constraints = [
            models.CheckConstraint(
                check=models.Q(limit_minutes__isnull=True) | models.Q(limit_minutes__gt=0),
                name="module_time_budget_positive",
            )
        ]


class ModuleTimeBudgetAlert(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    module = models.ForeignKey("db.Module", on_delete=models.CASCADE, related_name="time_budget_alerts")
    month = models.DateField()
    limit_minutes = models.PositiveIntegerField()
    total_minutes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "module_time_budget_alerts"
        constraints = [models.UniqueConstraint(fields=["module", "month"], name="module_time_budget_alert_month")]
