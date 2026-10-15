# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Token level restrictions for the public API.

These checks run *before* the regular role based permission classes of a view and can only
narrow access down: a token never gets more than its user's role allows.
"""

# Third party imports
from rest_framework.permissions import SAFE_METHODS, BasePermission

# Module imports
from plane.db.models import Workspace


# Maps public API views to the resource whose ``<resource>:write`` scope is needed for
# unsafe methods. Views can also declare ``token_scope_resource`` themselves.
VIEW_SCOPE_RESOURCES = {
    "IssueListCreateAPIEndpoint": "issues",
    "IssueDetailAPIEndpoint": "issues",
    "LabelListCreateAPIEndpoint": "issues",
    "LabelDetailAPIEndpoint": "issues",
    "IssueLinkListCreateAPIEndpoint": "issues",
    "IssueLinkDetailAPIEndpoint": "issues",
    "IssueAttachmentListCreateAPIEndpoint": "issues",
    "IssueAttachmentDetailAPIEndpoint": "issues",
    "IssueCommentListCreateAPIEndpoint": "comments",
    "IssueCommentDetailAPIEndpoint": "comments",
    "CycleListCreateAPIEndpoint": "cycles",
    "CycleDetailAPIEndpoint": "cycles",
    "CycleArchiveUnarchiveAPIEndpoint": "cycles",
    "CycleIssueListCreateAPIEndpoint": "cycles",
    "CycleIssueDetailAPIEndpoint": "cycles",
    "TransferCycleIssueAPIEndpoint": "cycles",
    "ModuleListCreateAPIEndpoint": "modules",
    "ModuleDetailAPIEndpoint": "modules",
    "ModuleArchiveUnarchiveAPIEndpoint": "modules",
    "ModuleIssueListCreateAPIEndpoint": "modules",
    "ModuleIssueDetailAPIEndpoint": "modules",
    "IntakeIssueListCreateAPIEndpoint": "intake",
    "IntakeIssueDetailAPIEndpoint": "intake",
}

# Deleting a work item itself is a separate, explicit scope.
DELETE_SCOPES = {
    "IssueDetailAPIEndpoint": "issues:delete",
}


def get_request_token(request):
    return getattr(request, "api_token", None)


def required_scope(request, view):
    """Return the scope needed for this request or ``None`` if no scope allows it."""
    explicit = getattr(view, "token_scopes", None)
    if explicit and request.method in explicit:
        return explicit[request.method]

    if request.method in SAFE_METHODS:
        return "read"

    name = type(view).__name__
    if request.method == "DELETE" and name in DELETE_SCOPES:
        return DELETE_SCOPES[name]

    resource = getattr(view, "token_scope_resource", None) or VIEW_SCOPE_RESOURCES.get(name)
    if resource is None:
        # Projects, states, members, invites, stickies... stay with unscoped (legacy) tokens.
        return None
    return f"{resource}:write"


class TokenWorkspacePermission(BasePermission):
    """A token bound to a workspace can only be used inside that workspace."""

    message = "This API token is not allowed to access this workspace."

    def has_permission(self, request, view):
        api_token = get_request_token(request)
        if api_token is None or api_token.workspace_id is None:
            return True

        slug = getattr(view, "kwargs", {}).get("slug")
        if slug is None:
            return True

        workspace_slug = getattr(api_token, "_bound_workspace_slug", None)
        if workspace_slug is None:
            workspace_slug = Workspace.objects.filter(pk=api_token.workspace_id).values_list("slug", flat=True).first()
            api_token._bound_workspace_slug = workspace_slug
        return workspace_slug == slug


class TokenScopePermission(BasePermission):
    """Restricts scoped tokens to the operations their scopes allow."""

    message = "This API token does not have the required scope for this operation."

    def has_permission(self, request, view):
        api_token = get_request_token(request)
        if api_token is None or not api_token.scopes:
            return True

        scope = required_scope(request, view)
        if scope is None:
            self.message = "This operation is not available for scoped API tokens."
            return False
        if not api_token.has_scope(scope):
            self.message = f"This API token is missing the '{scope}' scope."
            return False
        if (
            type(view).__name__ in ("IssueListCreateAPIEndpoint", "IssueDetailAPIEndpoint")
            and request.method not in SAFE_METHODS
            and any(field in request.data for field in ("tag_ids", "tags"))
            and not api_token.has_scope("tags:write")
        ):
            self.message = "This API token is missing the 'tags:write' scope."
            return False
        return True
