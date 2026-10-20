# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueComment,
    IssueSubscriber,
    Page,
    Project,
    ProjectMember,
    ProjectPage,
    State,
    User,
    UserRecentVisit,
    WorkspaceHomePreference,
    WorkspaceMember,
)

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def background_tasks():
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield


@pytest.fixture
def team(workspace, create_user):
    """`create_user` is the workspace admin who hands out work; `member` is the assignee under test."""
    member = User.objects.create(email="assignee@gizmo.so", username="assignee", display_name="Assignee")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    project = Project.objects.create(name="Tasks", identifier="TSK", workspace=workspace, network=0)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    ProjectMember.objects.create(project=project, member=member, role=15)
    states = {
        group: State.objects.create(project=project, name=group.title(), group=group, color="#123456")
        for group in ("backlog", "unstarted", "started", "completed", "cancelled")
    }
    client = APIClient()
    client.force_authenticate(user=member)
    return member, project, states, client


def make_issue(project, state, sequence_id, creator, assignee=None, assigned_by=None, **extra):
    issue = Issue.objects.bulk_create(
        [
            Issue(
                project=project,
                workspace=project.workspace,
                state=state,
                name=f"Task {sequence_id}",
                sequence_id=sequence_id,
                created_by=creator,
                **extra,
            )
        ]
    )[0]
    if assignee:
        IssueAssignee.objects.bulk_create(
            [
                IssueAssignee(
                    issue=issue,
                    assignee=assignee,
                    project=project,
                    workspace=project.workspace,
                    created_by=assigned_by or creator,
                )
            ]
        )
    return issue


def current_url(workspace):
    return f"/api/workspaces/{workspace.slug}/current-tasks/"


# -- current tasks --------------------------------------------------------------------------------------------------


def test_lists_only_open_tasks_assigned_to_the_user(workspace, create_user, team):
    member, project, states, client = team
    mine = make_issue(project, states["started"], 1, create_user, member)
    make_issue(project, states["started"], 2, create_user, create_user)  # assigned to somebody else
    make_issue(project, states["unstarted"], 3, create_user)  # not assigned at all
    make_issue(project, states["completed"], 4, create_user, member)
    make_issue(project, states["cancelled"], 5, create_user, member)

    body = client.get(current_url(workspace)).json()
    assert [task["id"] for task in body["results"]] == [str(mine.id)]
    task = body["results"][0]
    assert (task["project_identifier"], task["sequence_id"], task["state_group"]) == ("TSK", 1, "started")
    assert task["is_new"] is True and body["new_count"] == 1

    done = client.get(current_url(workspace), {"include_completed": "1"}).json()
    assert len(done["results"]) == 3


def test_a_task_is_new_until_the_assignee_opens_it(workspace, create_user, team):
    member, project, states, client = team
    handed_over = make_issue(project, states["unstarted"], 1, create_user, member)
    self_assigned = make_issue(project, states["unstarted"], 2, member, member)
    created_by_me = make_issue(project, states["unstarted"], 3, member, member, assigned_by=create_user)
    tasks = {task["id"]: task for task in client.get(current_url(workspace)).json()["results"]}
    assert tasks[str(handed_over.id)]["is_new"] is True
    assert tasks[str(self_assigned.id)]["is_new"] is False
    # created by the assignee: they know it, even if somebody else added them as the assignee
    assert tasks[str(created_by_me.id)]["is_new"] is False

    response = client.post(current_url(workspace) + "seen/", {"issue_ids": [str(handed_over.id)]}, format="json")
    assert response.json() == {"updated": 1}
    assert client.get(current_url(workspace)).json()["new_count"] == 0
    # without ids everything still unseen is marked (here the two assignments the user made or created himself)
    assert client.post(current_url(workspace) + "seen/", {}, format="json").json() == {"updated": 2}
    assert client.post(current_url(workspace) + "seen/", {}, format="json").json() == {"updated": 0}


def test_marking_seen_never_touches_other_users_or_inaccessible_tasks(workspace, create_user, team):
    member, project, states, client = team
    other = User.objects.create(email="colleague@gizmo.so", username="colleague")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
    ProjectMember.objects.create(project=project, member=other, role=15)
    shared = make_issue(project, states["started"], 1, create_user, member)
    IssueAssignee.objects.bulk_create(
        [IssueAssignee(issue=shared, assignee=other, project=project, workspace=workspace, created_by=create_user)]
    )
    hidden_project = Project.objects.create(name="Hidden", identifier="HID", workspace=workspace, network=0)
    ProjectMember.objects.create(project=hidden_project, member=create_user, role=20)
    hidden = make_issue(
        hidden_project,
        State.objects.create(project=hidden_project, name="S", group="started", color="#111111"),
        1,
        create_user,
        member,
    )

    client.post(current_url(workspace) + "seen/", {}, format="json")
    assert IssueAssignee.objects.get(issue=shared, assignee=other).seen_at is None
    assert IssueAssignee.objects.get(issue=hidden, assignee=member).seen_at is None
    assert client.post(current_url(workspace) + "seen/", {"issue_ids": ["nope"]}, format="json").status_code == 400


def test_private_projects_of_others_are_never_listed(workspace, create_user, team):
    member, *_ = team
    hidden_project = Project.objects.create(name="Hidden", identifier="HID", workspace=workspace, network=0)
    ProjectMember.objects.create(project=hidden_project, member=create_user, role=20)
    state = State.objects.create(project=hidden_project, name="S", group="started", color="#111111")
    make_issue(hidden_project, state, 1, create_user, member)
    client = APIClient()
    client.force_authenticate(user=member)
    assert client.get(current_url(workspace)).json()["results"] == []


def test_clients_have_no_current_tasks(workspace, team):
    client_user = User.objects.create(email="client@gizmo.so", username="client")
    WorkspaceMember.objects.create(workspace=workspace, member=client_user, role=3)
    client = APIClient()
    client.force_authenticate(user=client_user)
    assert client.get(current_url(workspace)).status_code == 403
    assert client.post(current_url(workspace) + "seen/", {}, format="json").status_code == 403


def test_bell_payload_lists_new_tasks_and_forgets_opened_ones(workspace, create_user, team):
    member, project, states, client = team
    fresh = make_issue(project, states["unstarted"], 1, create_user, member)
    opened = make_issue(project, states["unstarted"], 2, create_user, member)
    make_issue(project, states["completed"], 3, create_user, member)
    IssueAssignee.objects.filter(issue=opened).update(seen_at=timezone.now())

    body = client.get(f"/api/workspaces/{workspace.slug}/users/notifications/unread/").json()
    assert body["new_tasks_count"] == 1
    assert [task["id"] for task in body["new_tasks"]] == [str(fresh.id)]
    assert body["new_tasks"][0]["project_identifier"] == "TSK"


# -- home preferences --------------------------------------------------------------------------------------------------


def preferences_url(workspace, key=None):
    suffix = f"{key}/" if key else ""
    return f"/api/workspaces/{workspace.slug}/home-preferences/{suffix}"


def test_current_tasks_widget_sits_between_quick_links_and_recents(workspace, team):
    *_, client = team
    widgets = client.get(preferences_url(workspace)).json()
    ordered = [item["key"] for item in sorted(widgets, key=lambda item: -item["sort_order"])]
    assert ordered == ["quick_links", "current_tasks", "recents", "my_stickies"]
    # users who already had the old widgets get only the missing one, in the right place
    WorkspaceHomePreference.objects.filter(key="current_tasks").delete()
    ordered = [
        item["key"] for item in sorted(client.get(preferences_url(workspace)).json(), key=lambda i: -i["sort_order"])
    ]
    assert ordered == ["quick_links", "current_tasks", "recents", "my_stickies"]


def test_sort_settings_are_validated_and_stored_per_user(workspace, team):
    member, *_, client = team
    client.get(preferences_url(workspace))
    url = preferences_url(workspace, "current_tasks")
    config = {
        "sort": [{"field": "priority", "direction": "asc"}, {"field": "due_date", "direction": "desc"}],
        "show_completed": True,
        "limit": 20,
    }
    response = client.patch(url, {"config": config}, format="json")
    assert response.status_code == 200, response.content
    stored = next(item for item in client.get(preferences_url(workspace)).json() if item["key"] == "current_tasks")
    assert stored["config"] == config

    for bad in (
        {"sort": [{"field": "nope", "direction": "asc"}]},
        {"sort": [{"field": "priority", "direction": "up"}]},
        {"sort": [{"field": "priority", "direction": "asc"}, {"field": "priority", "direction": "desc"}]},
        {"limit": 1},
        {"limit": True},
        {"show_completed": "yes"},
        {"surprise": 1},
    ):
        assert client.patch(url, {"config": bad}, format="json").status_code == 400, bad
    assert client.patch(preferences_url(workspace, "recents"), {"config": {"x": 1}}, format="json").status_code == 400

    # settings belong to the user who saved them
    other = User.objects.create(email="other@gizmo.so", username="other")
    WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
    other_client = APIClient()
    other_client.force_authenticate(user=other)
    theirs = next(
        item for item in other_client.get(preferences_url(workspace)).json() if item["key"] == "current_tasks"
    )
    assert theirs["config"] == {}


# -- recents -----------------------------------------------------------------------------------------------------------


def visit(workspace, user, entity_name, entity_id, project=None, at=None):
    row = UserRecentVisit.objects.create(
        workspace=workspace, user=user, entity_name=entity_name, entity_identifier=entity_id, project=project
    )
    if at:
        UserRecentVisit.objects.filter(pk=row.pk).update(visited_at=at)
    return row


def test_recents_show_only_what_the_user_takes_part_in(workspace, create_user, team):
    member, project, states, client = team
    state = states["started"]
    assigned = make_issue(project, state, 1, create_user, member)
    created = make_issue(project, state, 2, member)
    followed = make_issue(project, state, 3, create_user)
    IssueSubscriber.objects.bulk_create(
        [IssueSubscriber(issue=followed, subscriber=member, project=project, workspace=workspace)]
    )
    commented = make_issue(project, state, 4, create_user)
    IssueComment.objects.bulk_create(
        [IssueComment(issue=commented, actor=member, project=project, workspace=workspace, comment_html="<p>hi</p>")]
    )
    stranger_issue = make_issue(project, state, 5, create_user)  # just opened, no involvement

    public = Project.objects.create(name="Open", identifier="OPN", workspace=workspace, network=2)
    ProjectMember.objects.create(project=public, member=create_user, role=20)

    own_page = Page.objects.create(workspace=workspace, owned_by=member, name="Mine")
    foreign_page = Page.objects.create(workspace=workspace, owned_by=create_user, name="Theirs")
    ProjectPage.objects.bulk_create(
        [
            ProjectPage(page=own_page, project=project, workspace=workspace),
            ProjectPage(page=foreign_page, project=project, workspace=workspace),
        ]
    )

    now = timezone.now()
    for index, (name, entity) in enumerate(
        [
            ("issue", assigned),
            ("issue", created),
            ("issue", followed),
            ("issue", commented),
            ("issue", stranger_issue),
            ("project", project),
            ("project", public),
            ("page", own_page),
            ("page", foreign_page),
        ]
    ):
        visit(workspace, member, name, entity.id, project, at=now - timedelta(minutes=10 - index))

    response = client.get(f"/api/workspaces/{workspace.slug}/recent-visits/")
    assert response.status_code == 200
    shown = {(item["entity_name"], item["entity_identifier"]) for item in response.json()}
    assert shown == {
        ("issue", str(assigned.id)),
        ("issue", str(created.id)),
        ("issue", str(followed.id)),
        ("issue", str(commented.id)),
        ("project", str(project.id)),
        ("page", str(own_page.id)),
    }
    # newest visit first
    assert response.json()[0]["entity_identifier"] == str(own_page.id)


def test_workspace_admin_sees_projects_they_do_not_belong_to_only_when_they_take_part(workspace, create_user, team):
    """Administrators can open every project, but their recents still list only their own."""
    member, project, states, _ = team
    other_project = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, network=0)
    admin_client = APIClient()
    admin_client.force_authenticate(user=create_user)
    visit(workspace, create_user, "project", project.id, project)
    visit(workspace, create_user, "project", other_project.id, other_project)
    shown = {
        item["entity_identifier"]
        for item in admin_client.get(f"/api/workspaces/{workspace.slug}/recent-visits/").json()
    }
    assert shown == {str(project.id)}
