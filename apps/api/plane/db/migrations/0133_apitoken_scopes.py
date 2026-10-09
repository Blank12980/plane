# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models

import plane.db.models.api


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0132_issue_worklogs_and_workspace_tags"),
    ]

    operations = [
        migrations.AddField(
            model_name="apitoken",
            name="scopes",
            field=models.JSONField(blank=True, default=plane.db.models.api.default_token_scopes),
        ),
    ]
