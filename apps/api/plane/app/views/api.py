# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
from uuid import uuid4
from typing import Optional

# Third party
from rest_framework.response import Response
from rest_framework.request import Request
from rest_framework import status

# Module import
from .base import BaseAPIView
from plane.db.models import APIToken, WorkspaceMember
from plane.app.serializers import APITokenSerializer, APITokenReadSerializer
from plane.app.serializers.api import validate_token_scopes
from rest_framework import serializers


class ApiTokenEndpoint(BaseAPIView):
    def post(self, request: Request) -> Response:
        label = request.data.get("label", str(uuid4().hex))
        description = request.data.get("description", "")
        expired_at = request.data.get("expired_at", None)

        # Check the user type
        user_type = 1 if request.user.is_bot else 0

        # Optional restrictions: scopes (empty = full access) and workspace binding
        try:
            scopes = validate_token_scopes(request.data.get("scopes", []))
        except serializers.ValidationError as e:
            return Response({"scopes": e.detail}, status=status.HTTP_400_BAD_REQUEST)

        workspace_id = None
        workspace_slug = request.data.get("workspace_slug")
        if workspace_slug:
            workspace_id = (
                WorkspaceMember.objects.filter(member=request.user, workspace__slug=workspace_slug, is_active=True)
                .values_list("workspace_id", flat=True)
                .first()
            )
            if workspace_id is None:
                return Response(
                    {"workspace_slug": ["You are not a member of this workspace."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        api_token = APIToken.objects.create(
            label=label,
            description=description,
            user=request.user,
            user_type=user_type,
            expired_at=expired_at,
            scopes=scopes,
            workspace_id=workspace_id,
        )

        serializer = APITokenSerializer(api_token)
        # Token will be only visible while creating
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    def get(self, request: Request, pk: Optional[str] = None) -> Response:
        if pk is None:
            api_tokens = APIToken.objects.filter(user=request.user, is_service=False)
            serializer = APITokenReadSerializer(api_tokens, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            api_tokens = APIToken.objects.get(user=request.user, pk=pk)
            serializer = APITokenReadSerializer(api_tokens)
            return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request: Request, pk: str) -> Response:
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        api_token.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request: Request, pk: str) -> Response:
        api_token = APIToken.objects.get(user=request.user, pk=pk, is_service=False)
        serializer = APITokenSerializer(api_token, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
