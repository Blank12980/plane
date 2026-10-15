# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django import template
from django.conf import settings


register = template.Library()


@register.simple_tag
def gizmo_logo_url(variant="dark"):
    """Use this instance's artwork in emails, including background tasks."""
    base_url = getattr(settings, "WEB_URL", None) or getattr(settings, "APP_BASE_URL", None) or ""
    filename = "gizmo-white.png" if variant == "white" else "gizmo-dark.png"
    return f"{base_url.rstrip('/')}/static/logos/{filename}"
