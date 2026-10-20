# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db import transaction
from django.db.models import Exists, F, OuterRef, Q

from plane.db.models import ClientAccessGrant, ProjectMember, ProjectPage


def client_grants(user, slug=None):
    grants = ClientAccessGrant.objects.filter(
        client=user,
        workspace__deleted_at__isnull=True,
        project__deleted_at__isnull=True,
        client__member_workspace__workspace_id=F("workspace_id"),
        client__member_workspace__role=3,
        client__member_workspace__is_active=True,
        client__member_workspace__deleted_at__isnull=True,
        client__member_workspace__is_instance_admin_access=False,
    ).filter(
        Q(
            issue__isnull=False,
            issue__deleted_at__isnull=True,
            issue__is_draft=False,
            issue__project_id=F("project_id"),
            issue__workspace_id=F("workspace_id"),
        )
        | Q(page__isnull=False, page__deleted_at__isnull=True, page__workspace_id=F("workspace_id"))
    )
    if slug:
        grants = grants.filter(workspace__slug=slug)
    # Page links are independently removable, including when a page is moved.
    linked_pages = ProjectPage.objects.filter(
        page_id=OuterRef("page_id"), project_id=OuterRef("project_id"), deleted_at__isnull=True
    )
    return grants.alias(_page_linked=Exists(linked_pages)).filter(Q(issue__isnull=False) | Q(_page_linked=True))


@transaction.atomic
def make_workspace_client(membership):
    """Give a workspace member the Client role.

    A client has no access to project content except what an administrator shares, so the previous project
    memberships are switched off, exactly like when the role is changed in the workspace members list.
    """
    ClientAccessGrant.objects.filter(workspace_id=membership.workspace_id, client_id=membership.member_id).delete()
    ProjectMember.objects.filter(
        workspace_id=membership.workspace_id, member_id=membership.member_id, is_instance_admin_access=False
    ).update(is_active=False, role=3)
    membership.role = 3
    membership.save(update_fields=["role", "updated_at"])
    return membership
