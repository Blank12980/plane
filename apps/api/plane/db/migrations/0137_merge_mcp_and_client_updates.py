# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0134_merge_apitoken_scopes_revoke_admin_access"),
        ("db", "0136_module_time_budgets_comment_threads"),
    ]

    operations = []
