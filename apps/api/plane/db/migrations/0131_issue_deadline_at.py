# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("db", "0130_testing_task_state")]

    operations = [
        migrations.AddField(
            model_name="issue",
            name="deadline_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="issueversion",
            name="deadline_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
