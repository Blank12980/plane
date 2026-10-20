from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0137_merge_mcp_and_client_updates"),
    ]

    operations = [
        migrations.AddField(
            model_name="moduletimebudget",
            name="include_subtasks",
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name="ProjectTimeBudget",
            fields=[
                (
                    "project",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        primary_key=True,
                        related_name="time_budget",
                        serialize=False,
                        to="db.project",
                    ),
                ),
                ("limit_minutes", models.PositiveIntegerField(blank=True, null=True)),
                ("count_module_tasks", models.BooleanField(default=True)),
                ("count_other_tasks", models.BooleanField(default=True)),
                ("include_subtasks", models.BooleanField(default=True)),
            ],
            options={
                "db_table": "project_time_budgets",
            },
        ),
        migrations.CreateModel(
            name="ProjectTimeBudgetAlert",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("month", models.DateField()),
                ("limit_minutes", models.PositiveIntegerField()),
                ("total_minutes", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "project",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="time_budget_alerts",
                        to="db.project",
                    ),
                ),
            ],
            options={
                "db_table": "project_time_budget_alerts",
            },
        ),
        migrations.AddConstraint(
            model_name="projecttimebudget",
            constraint=models.CheckConstraint(
                check=models.Q(("limit_minutes__isnull", True), ("limit_minutes__gt", 0), _connector="OR"),
                name="project_time_budget_positive",
            ),
        ),
        migrations.AddConstraint(
            model_name="projecttimebudgetalert",
            constraint=models.UniqueConstraint(fields=("project", "month"), name="project_time_budget_alert_month"),
        ),
    ]
