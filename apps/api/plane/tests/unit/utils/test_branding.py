# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.template import Context, Engine
from django.test import override_settings


def test_email_branding_uses_this_instance_artwork():
    engine = Engine(libraries={"branding": "plane.db.templatetags.branding"})
    template = engine.from_string("{% load branding %}<img src=\"{% gizmo_logo_url 'white' %}\">")
    with override_settings(WEB_URL="https://gizmo.example/", APP_BASE_URL=None):
        assert template.render(Context()) == '<img src="https://gizmo.example/static/logos/gizmo-white.png">'


def test_email_branding_supports_app_base_url():
    from plane.db.templatetags.branding import gizmo_logo_url

    with override_settings(WEB_URL=None, APP_BASE_URL="https://app.example"):
        assert gizmo_logo_url() == "https://app.example/static/logos/gizmo-dark.png"
