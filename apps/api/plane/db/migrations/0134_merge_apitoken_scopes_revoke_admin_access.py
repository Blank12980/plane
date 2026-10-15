# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0133_apitoken_scopes"),
        ("db", "0133_revoke_stale_instance_admin_access"),
    ]

    operations = []
