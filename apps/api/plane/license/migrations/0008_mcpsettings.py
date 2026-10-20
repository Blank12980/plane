from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

import plane.license.models.mcp


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("license", "0007_instanceadmin_roles"),
    ]

    operations = [
        migrations.CreateModel(
            name="McpSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("allow_user_tokens", models.BooleanField(default=True)),
                ("allowed_scopes", models.JSONField(default=plane.license.models.mcp.default_mcp_allowed_scopes)),
                ("max_token_days", models.PositiveIntegerField(default=365)),
                ("default_rate_limit", models.CharField(default="120/min", max_length=32)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="+",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "verbose_name": "MCP settings",
                "verbose_name_plural": "MCP settings",
                "db_table": "mcp_settings",
            },
        ),
    ]
