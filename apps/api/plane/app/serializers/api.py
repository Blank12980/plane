# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from .base import BaseSerializer
from plane.db.models import APIToken, APIActivityLog
from plane.db.models.api import API_TOKEN_SCOPES
from rest_framework import serializers
from django.utils import timezone


def validate_token_scopes(value):
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(scope, str) for scope in value):
        raise serializers.ValidationError("Scopes must be a list of strings.")
    unknown = sorted(set(value) - set(API_TOKEN_SCOPES))
    if unknown:
        raise serializers.ValidationError(f"Unknown scopes: {', '.join(unknown)}")
    # keep a stable order without duplicates
    return [scope for scope in API_TOKEN_SCOPES if scope in value]


class APITokenSerializer(BaseSerializer):
    class Meta:
        model = APIToken
        fields = "__all__"
        read_only_fields = [
            "token",
            "expired_at",
            "created_at",
            "updated_at",
            "workspace",
            "user",
            "is_active",
            "last_used",
            "user_type",
            # Rate limit and service flag are set by instance admins only
            "allowed_rate_limit",
            "is_service",
        ]

    def validate_scopes(self, value):
        return validate_token_scopes(value)


class APITokenReadSerializer(BaseSerializer):
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = APIToken
        exclude = ("token",)

    def get_is_active(self, obj: APIToken) -> bool:
        if obj.expired_at is None:
            return True
        return timezone.now() < obj.expired_at


class APIActivityLogSerializer(BaseSerializer):
    class Meta:
        model = APIActivityLog
        fields = "__all__"
