# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from .base import BaseSerializer
from plane.db.models import APIToken, APIActivityLog, WorkspaceMember
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
            # MCP tokens are created through the dedicated MCP endpoints so that the instance policy applies
            "source",
        ]

    def validate_scopes(self, value):
        return validate_token_scopes(value)


class APITokenReadSerializer(BaseSerializer):
    is_active = serializers.SerializerMethodField()

    class Meta:
        model = APIToken
        exclude = ("token",)

    def get_is_active(self, obj: APIToken) -> bool:
        return obj.is_active and (obj.expired_at is None or timezone.now() < obj.expired_at)


class APITokenCreateSerializer(APITokenSerializer):
    expired_at = serializers.DateTimeField(required=False, allow_null=True)
    workspace_slug = serializers.SlugField(required=False, allow_blank=True, write_only=True)

    def validate_expired_at(self, value):
        if value is not None and value <= timezone.now():
            raise serializers.ValidationError("Expiry must be in the future.")
        return value

    def validate(self, attrs):
        slug = attrs.pop("workspace_slug", None)
        if slug:
            workspace_id = (
                WorkspaceMember.objects.filter(
                    member=self.context["request"].user, workspace__slug=slug, is_active=True
                )
                .values_list("workspace_id", flat=True)
                .first()
            )
            if workspace_id is None:
                raise serializers.ValidationError({"workspace_slug": ["You are not a member of this workspace."]})
            attrs["workspace_id"] = workspace_id
        return attrs


class APIActivityLogSerializer(BaseSerializer):
    class Meta:
        model = APIActivityLog
        fields = "__all__"
