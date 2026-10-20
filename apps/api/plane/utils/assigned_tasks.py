# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work items assigned to a user: the "current tasks" list of the home page and the "new tasks" signal of the bell.

A work item is *new* for its assignee until the assignee opens it (``IssueAssignee.seen_at``). Work items the user
created or assigned to themselves are never new: the user obviously knows them.
"""

# Django imports
from django.db.models import BooleanField, Case, Exists, OuterRef, Q, Subquery, Value, When
from django.utils import timezone

# Module imports
from plane.db.models import Issue, IssueAssignee, ProjectMember
from plane.db.models.state import StateGroup
from plane.utils.project_access import projects_for_user

DONE_GROUPS = (StateGroup.COMPLETED.value, StateGroup.CANCELLED.value)
MAX_CURRENT_TASKS = 300
MAX_NEW_TASKS_IN_BELL = 20


def _own_assignment(user):
    return IssueAssignee.objects.filter(issue_id=OuterRef("pk"), assignee=user)


def assigned_issues(user, slug, *, include_done=False):
    """Work items assigned to the user in the projects the user can access, annotated with ``assigned_at`` and
    ``is_new``. Finished work items (completed / cancelled) are left out unless ``include_done`` is set."""
    # Guests only see their own work items unless the project opens everything to guests.
    guest_in_project = ProjectMember.objects.filter(
        project_id=OuterRef("project_id"), member=user, is_active=True, role=5, is_instance_admin_access=False
    )
    issues = (
        Issue.issue_objects.filter(
            workspace__slug=slug,
            project_id__in=projects_for_user(user, slug).values("pk"),
            issue_assignee__assignee=user,
            issue_assignee__deleted_at__isnull=True,
        )
        .alias(_guest=Exists(guest_in_project))
        .filter(Q(_guest=False) | Q(project__guest_view_all_features=True) | Q(created_by=user))
        .select_related("project", "state")
        .annotate(
            assigned_at=Subquery(_own_assignment(user).values("created_at")[:1]),
            # Not opened yet, handed over by somebody else and not created by the assignee.
            is_new=Case(
                When(created_by=user, then=Value(False)),
                default=Exists(_own_assignment(user).filter(seen_at__isnull=True).exclude(created_by=user)),
                output_field=BooleanField(),
            ),
        )
        .distinct()
    )
    if not include_done:
        issues = issues.exclude(state__group__in=DONE_GROUPS)
    return issues


def unseen_assigned_issues(user, slug):
    """Open work items that were assigned to the user by somebody else and not opened yet, newest first."""
    return assigned_issues(user, slug).filter(is_new=True).order_by("-assigned_at")


def mark_tasks_seen(user, slug, issue_ids=None):
    """Mark the user's assignments as seen. Without ``issue_ids`` every unseen assignment is marked."""
    assignments = IssueAssignee.objects.filter(
        assignee=user,
        seen_at__isnull=True,
        workspace__slug=slug,
        issue__project_id__in=projects_for_user(user, slug).values("pk"),
    )
    if issue_ids is not None:
        assignments = assignments.filter(issue_id__in=issue_ids)
    return assignments.update(seen_at=timezone.now())


def task_payload(issue):
    state = issue.state
    return {
        "id": str(issue.id),
        "name": issue.name,
        "sequence_id": issue.sequence_id,
        "project_id": str(issue.project_id),
        "project_identifier": issue.project.identifier,
        "project_name": issue.project.name,
        "state_id": str(state.id) if state else None,
        "state_name": state.name if state else None,
        "state_group": state.group if state else None,
        "state_color": state.color if state else None,
        "priority": issue.priority,
        "target_date": issue.target_date,
        "deadline_at": issue.deadline_at,
        "updated_at": issue.updated_at,
        "assigned_at": issue.assigned_at,
        "is_new": issue.is_new,
    }
