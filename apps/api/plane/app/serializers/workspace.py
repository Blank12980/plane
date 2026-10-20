# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import serializers

# Module imports
from .base import BaseSerializer, DynamicBaseSerializer
from .user import UserLiteSerializer, UserAdminLiteSerializer


from plane.db.models import (
    Workspace,
    WorkspaceMember,
    WorkspaceMemberInvite,
    WorkspaceTheme,
    WorkspaceUserProperties,
    WorkspaceUserLink,
    UserRecentVisit,
    Issue,
    Page,
    Project,
    ProjectMember,
    WorkspaceHomePreference,
    Sticky,
    WorkspaceUserPreference,
)
from plane.utils.constants import RESTRICTED_WORKSPACE_SLUGS
from plane.utils.url import contains_url
from plane.utils.content_validator import (
    validate_html_content,
    validate_binary_data,
)

# Django imports
from django.core.validators import URLValidator
from django.core.exceptions import ValidationError
import re


class WorkSpaceSerializer(DynamicBaseSerializer):
    total_members = serializers.IntegerField(read_only=True)
    logo_url = serializers.CharField(read_only=True)
    role = serializers.IntegerField(read_only=True)

    def validate_name(self, value):
        # Check if the name contains a URL
        if contains_url(value):
            raise serializers.ValidationError("Name must not contain URLs")
        return value

    def validate_slug(self, value):
        # Check if the slug is restricted
        if value in RESTRICTED_WORKSPACE_SLUGS:
            raise serializers.ValidationError("Slug is not valid")
        # Slug should only contain alphanumeric characters, hyphens, and underscores
        if not re.match(r"^[a-zA-Z0-9_-]+$", value):
            raise serializers.ValidationError(
                "Slug can only contain letters, numbers, hyphens (-), and underscores (_)"
            )
        return value

    class Meta:
        model = Workspace
        fields = "__all__"
        read_only_fields = [
            "id",
            "created_by",
            "updated_by",
            "created_at",
            "updated_at",
            "owner",
            "logo_url",
        ]


class WorkspaceLiteSerializer(BaseSerializer):
    class Meta:
        model = Workspace
        fields = ["name", "slug", "id", "logo_url"]
        read_only_fields = fields


class WorkSpaceMemberSerializer(DynamicBaseSerializer):
    member = UserLiteSerializer(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberMeSerializer(BaseSerializer):
    draft_issue_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkspaceMemberAdminSerializer(DynamicBaseSerializer):
    member = UserAdminLiteSerializer(read_only=True)

    class Meta:
        model = WorkspaceMember
        fields = "__all__"


class WorkSpaceMemberInviteSerializer(BaseSerializer):
    workspace = WorkspaceLiteSerializer(read_only=True)
    invite_link = serializers.SerializerMethodField()

    def get_invite_link(self, obj):
        return f"/workspace-invitations/?invitation_id={obj.id}&slug={obj.workspace.slug}&token={obj.token}"

    class Meta:
        model = WorkspaceMemberInvite
        fields = "__all__"
        read_only_fields = [
            "id",
            "email",
            "token",
            "workspace",
            "message",
            "responded_at",
            "created_at",
            "updated_at",
            "invite_link",
        ]


class WorkspaceThemeSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceTheme
        fields = "__all__"
        read_only_fields = ["workspace", "actor"]


class WorkspaceUserPropertiesSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceUserProperties
        fields = "__all__"
        read_only_fields = ["workspace", "user"]


class WorkspaceUserLinkSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceUserLink
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]

    def to_internal_value(self, data):
        url = data.get("url", "")
        if url and not url.startswith(("http://", "https://")):
            data["url"] = "http://" + url

        return super().to_internal_value(data)

    def validate_url(self, value):
        url_validator = URLValidator()
        try:
            url_validator(value)
        except ValidationError:
            raise serializers.ValidationError({"error": "Invalid URL format."})

        return value

    def create(self, validated_data):
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url,
            workspace_id=validated_data.get("workspace_id"),
            owner_id=validated_data.get("owner_id"),
        )

        if workspace_user_link.exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Filtering the WorkspaceUserLink with the given url to check if the link already exists.

        url = validated_data.get("url")

        workspace_user_link = WorkspaceUserLink.objects.filter(
            url=url, workspace_id=instance.workspace_id, owner=instance.owner
        )

        if workspace_user_link.exclude(pk=instance.id).exists():
            raise serializers.ValidationError({"error": "URL already exists for this workspace and owner"})

        return super().update(instance, validated_data)


class IssueRecentVisitSerializer(serializers.ModelSerializer):
    project_identifier = serializers.SerializerMethodField()
    assignees = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = [
            "id",
            "name",
            "state",
            "priority",
            "assignees",
            "type",
            "sequence_id",
            "project_id",
            "project_identifier",
        ]

    def get_project_identifier(self, obj):
        project = obj.project
        return project.identifier if project else None

    def get_assignees(self, obj):
        return list(obj.assignees.filter(issue_assignee__deleted_at__isnull=True).values_list("id", flat=True))


class ProjectRecentVisitSerializer(serializers.ModelSerializer):
    project_members = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "name", "logo_props", "project_members", "identifier"]

    def get_project_members(self, obj):
        members = ProjectMember.objects.filter(project_id=obj.id, member__is_bot=False, is_active=True).values_list(
            "member", flat=True
        )

        return members


class PageRecentVisitSerializer(serializers.ModelSerializer):
    project_id = serializers.SerializerMethodField()
    project_identifier = serializers.SerializerMethodField()

    class Meta:
        model = Page
        fields = [
            "id",
            "name",
            "logo_props",
            "project_id",
            "owned_by",
            "project_identifier",
        ]

    def get_project_id(self, obj):
        return obj.project_id if hasattr(obj, "project_id") else obj.projects.values_list("id", flat=True).first()

    def get_project_identifier(self, obj):
        project = obj.projects.first()

        return project.identifier if project else None


def get_entity_model_and_serializer(entity_type):
    entity_map = {
        "issue": (Issue, IssueRecentVisitSerializer),
        "page": (Page, PageRecentVisitSerializer),
        "project": (Project, ProjectRecentVisitSerializer),
    }
    return entity_map.get(entity_type, (None, None))


class WorkspaceRecentVisitSerializer(BaseSerializer):
    entity_data = serializers.SerializerMethodField()

    class Meta:
        model = UserRecentVisit
        fields = ["id", "entity_name", "entity_identifier", "entity_data", "visited_at"]
        read_only_fields = ["workspace", "owner", "created_by", "updated_by"]

    def get_entity_data(self, obj):
        entity_name = obj.entity_name
        entity_identifier = obj.entity_identifier

        entity_model, entity_serializer = get_entity_model_and_serializer(entity_name)

        if entity_model and entity_serializer:
            try:
                entity = entity_model.objects.get(pk=entity_identifier)

                return entity_serializer(entity).data
            except entity_model.DoesNotExist:
                return None
        return None


CURRENT_TASKS_SORT_FIELDS = ("readiness", "priority", "due_date", "updated_at", "project")


class WorkspaceHomePreferenceSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceHomePreference
        fields = ["key", "is_enabled", "sort_order", "config"]
        read_only_fields = ["workspace", "created_by", "updated_by"]

    def validate_config(self, value):
        """Widget settings. Only the "current tasks" widget has any: how the list is sorted and what it shows."""
        if not isinstance(value, dict):
            raise serializers.ValidationError("Config must be an object.")
        key = self.instance.key if self.instance else None
        if key != "current_tasks":
            if value:
                raise serializers.ValidationError("This widget has no settings.")
            return value

        unknown = set(value) - {"sort", "show_completed", "limit"}
        if unknown:
            raise serializers.ValidationError(f"Unknown settings: {', '.join(sorted(unknown))}.")
        cleaned = {}
        if "sort" in value:
            rules = value["sort"]
            if not isinstance(rules, list) or len(rules) > len(CURRENT_TASKS_SORT_FIELDS):
                raise serializers.ValidationError({"sort": "Sort must be a short list of rules."})
            seen_fields = set()
            cleaned_rules = []
            for rule in rules:
                field = rule.get("field") if isinstance(rule, dict) else None
                direction = rule.get("direction") if isinstance(rule, dict) else None
                if field not in CURRENT_TASKS_SORT_FIELDS or direction not in ("asc", "desc") or field in seen_fields:
                    raise serializers.ValidationError({"sort": "Each rule needs a unique field and a direction."})
                seen_fields.add(field)
                cleaned_rules.append({"field": field, "direction": direction})
            cleaned["sort"] = cleaned_rules
        if "show_completed" in value:
            if not isinstance(value["show_completed"], bool):
                raise serializers.ValidationError({"show_completed": "Must be true or false."})
            cleaned["show_completed"] = value["show_completed"]
        if "limit" in value:
            limit = value["limit"]
            if isinstance(limit, bool) or not isinstance(limit, int) or not 3 <= limit <= 100:
                raise serializers.ValidationError({"limit": "Must be a number between 3 and 100."})
            cleaned["limit"] = limit
        return cleaned


class StickySerializer(BaseSerializer):
    class Meta:
        model = Sticky
        fields = "__all__"
        read_only_fields = ["workspace", "owner"]
        extra_kwargs = {"name": {"required": False}}

    def validate(self, data):
        # Validate description content for security
        if "description_html" in data and data["description_html"]:
            is_valid, error_msg, sanitized_html = validate_html_content(data["description_html"])
            if not is_valid:
                raise serializers.ValidationError({"error": "html content is not valid"})
            # Update the data with sanitized HTML if available
            if sanitized_html is not None:
                data["description_html"] = sanitized_html

        if "description_binary" in data and data["description_binary"]:
            is_valid, error_msg = validate_binary_data(data["description_binary"])
            if not is_valid:
                raise serializers.ValidationError({"description_binary": "Invalid binary data"})

        return data


class WorkspaceUserPreferenceSerializer(BaseSerializer):
    class Meta:
        model = WorkspaceUserPreference
        fields = ["key", "is_pinned", "sort_order"]
        read_only_fields = ["workspace", "created_by", "updated_by"]
