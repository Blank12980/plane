from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0138_time_budget_scopes"),
    ]

    operations = [
        migrations.AddField(
            model_name="apitoken",
            name="source",
            field=models.CharField(
                choices=[("api", "API"), ("mcp", "MCP")], db_index=True, default="api", max_length=16
            ),
        ),
    ]
