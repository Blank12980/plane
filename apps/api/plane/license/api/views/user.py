# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from zxcvbn import zxcvbn

from plane.db.models import User, Workspace
from plane.license.api.permissions import InstanceAdminPermission, InstanceSuperAdminPermission
from plane.license.api.serializers import InstanceUserSerializer
from plane.license.models import InstanceAdmin, INSTANCE_SUPER_ADMIN_ROLE

from .base import BaseAPIView


class InstanceUserEndpoint(BaseAPIView):
    def get_permissions(self):
        if self.request.method == "DELETE":
            return [InstanceSuperAdminPermission()]
        return [InstanceAdminPermission()]

    def get_queryset(self):
        instance_admins = InstanceAdmin.objects.filter(
            user_id=OuterRef("id"),
            deleted_at__isnull=True,
        )
        return (
            User.objects.filter(is_bot=False)
            .annotate(
                workspace_count=Count(
                    "member_workspace",
                    filter=Q(
                        member_workspace__is_active=True,
                        member_workspace__is_instance_admin_access=False,
                    ),
                    distinct=True,
                ),
                instance_admin_id=Subquery(instance_admins.values("id")[:1]),
                instance_admin_role=Subquery(instance_admins.values("role")[:1]),
            )
            .order_by("-created_at")
        )

    def get(self, request, pk=None):
        users = self.get_queryset()
        search = request.query_params.get("search", "").strip()
        if search:
            users = users.filter(
                Q(email__icontains=search)
                | Q(display_name__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
            )

        if pk is not None:
            user = users.filter(pk=pk).first()
            if user is None:
                return Response(status=status.HTTP_404_NOT_FOUND)
            return Response(InstanceUserSerializer(user).data, status=status.HTTP_200_OK)

        return self.paginate(
            request=request,
            queryset=users,
            on_results=lambda results: InstanceUserSerializer(results, many=True).data,
            default_per_page=25,
            max_per_page=100,
        )

    def patch(self, request, pk):
        user = User.objects.filter(pk=pk, is_bot=False).first()
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        target_admin = InstanceAdmin.objects.filter(user=user).first()
        requester_is_super = InstanceAdmin.objects.filter(
            user=request.user,
            role__gte=INSTANCE_SUPER_ADMIN_ROLE,
        ).exists()

        profile_fields = ("display_name", "first_name", "last_name")
        requested_profile_fields = [field for field in profile_fields if field in request.data]
        email_requested = "email" in request.data
        status_requested = "is_banned" in request.data or "is_active" in request.data
        if not requested_profile_fields and not email_requested and not status_requested:
            return Response(
                {"error": "No supported account fields were provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if target_admin is not None and (requested_profile_fields or email_requested) and not requester_is_super:
            return Response(
                {"error": "Only a super admin can edit another instance administrator"},
                status=status.HTTP_403_FORBIDDEN,
            )

        update_fields = []
        for field in requested_profile_fields:
            value = request.data.get(field)
            if not isinstance(value, str):
                return Response(
                    {"error": f"{field} must be a string"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(value) > 255:
                return Response(
                    {"error": f"{field} must not exceed 255 characters"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            setattr(user, field, value.strip())
            update_fields.append(field)

        if email_requested:
            email = request.data.get("email")
            if not isinstance(email, str) or not email.strip():
                return Response({"error": "A valid email is required"}, status=status.HTTP_400_BAD_REQUEST)
            email = email.strip().lower()
            try:
                validate_email(email)
            except ValidationError:
                return Response({"error": "A valid email is required"}, status=status.HTTP_400_BAD_REQUEST)
            if User.objects.exclude(pk=user.pk).filter(email__iexact=email).exists():
                return Response(
                    {"error": "A user with this email already exists"},
                    status=status.HTTP_409_CONFLICT,
                )
            user.email = email
            update_fields.append("email")

        if status_requested:
            is_banned = request.data.get("is_banned")
            if is_banned is None and "is_active" in request.data:
                is_active = request.data.get("is_active")
                if not isinstance(is_active, bool):
                    return Response(
                        {"error": "is_active must be a boolean"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                is_banned = not is_active
            if not isinstance(is_banned, bool):
                return Response(
                    {"error": "is_banned must be a boolean"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if user == request.user and is_banned:
                return Response(
                    {"error": "You cannot ban your own account"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if target_admin is not None and is_banned:
                return Response(
                    {"error": "Remove the instance admin role before banning this user"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            if target_admin is not None and not requester_is_super:
                return Response(
                    {"error": "Only a super admin can change another instance administrator"},
                    status=status.HTTP_403_FORBIDDEN,
                )

            banned_reason = request.data.get("banned_reason", "")
            if not isinstance(banned_reason, str):
                return Response(
                    {"error": "banned_reason must be a string"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if len(banned_reason) > 2000:
                return Response(
                    {"error": "banned_reason must not exceed 2000 characters"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            user.is_banned = is_banned
            user.is_active = not is_banned
            user.banned_at = timezone.now() if is_banned else None
            user.banned_reason = banned_reason.strip() if is_banned else ""
            user.token_updated_at = timezone.now()
            update_fields.extend(
                [
                    "is_banned",
                    "is_active",
                    "banned_at",
                    "banned_reason",
                    "token_updated_at",
                    "token",
                ]
            )

        user.save(update_fields=[*update_fields, "updated_at"])
        annotated_user = self.get_queryset().get(pk=user.pk)
        return Response(InstanceUserSerializer(annotated_user).data, status=status.HTTP_200_OK)

    def delete(self, request, pk):
        user = User.objects.filter(pk=pk, is_bot=False).first()
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)
        if user == request.user:
            return Response(
                {"error": "You cannot delete your own account"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if InstanceAdmin.objects.filter(user=user).exists():
            return Response(
                {"error": "Remove the instance admin role before deleting this user"},
                status=status.HTTP_409_CONFLICT,
            )
        if Workspace.objects.filter(owner=user).exists():
            return Response(
                {"error": "Transfer or delete the user's owned workspaces first"},
                status=status.HTTP_409_CONFLICT,
            )

        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class InstanceUserPasswordEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    def post(self, request, pk):
        user = User.objects.filter(pk=pk, is_bot=False).first()
        if user is None:
            return Response(status=status.HTTP_404_NOT_FOUND)

        target_admin = InstanceAdmin.objects.filter(user=user).first()
        requester_is_super = InstanceAdmin.objects.filter(
            user=request.user,
            role__gte=INSTANCE_SUPER_ADMIN_ROLE,
        ).exists()
        if target_admin is not None and not requester_is_super:
            return Response(
                {"error": "Only a super admin can change an instance administrator's password"},
                status=status.HTTP_403_FORBIDDEN,
            )

        password = request.data.get("password")
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            return Response(
                {"error": "Password must contain between 8 and 128 characters"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if zxcvbn(password)["score"] < 3:
            return Response(
                {"error": "Password is too weak"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(password)
        user.is_password_autoset = False
        user.is_password_reset_required = False
        user.token_updated_at = timezone.now()
        user.save()
        return Response(status=status.HTTP_204_NO_CONTENT)
