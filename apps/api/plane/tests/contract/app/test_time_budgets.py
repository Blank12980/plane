from datetime import date
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from plane.db.models import (
    Issue,
    IssueWorkLog,
    Module,
    ModuleIssue,
    ModuleTimeBudget,
    Notification,
    Project,
    ProjectMember,
    ProjectTimeBudget,
    ProjectTimeBudgetAlert,
    State,
    User,
    WorkspaceMember,
)
from plane.utils.time_budget import (
    check_issue_time_budgets,
    check_linked_module_time_budgets,
    check_project_time_budget,
    monthly_minutes,
    project_month,
    project_monthly_minutes,
)

pytestmark = [pytest.mark.contract, pytest.mark.django_db]

DAY = date(2026, 10, 5)
MONTH = date(2026, 10, 1)


@pytest.fixture(autouse=True)
def background_tasks():
    with patch("plane.db.mixins.soft_delete_related_objects.delay"):
        yield


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="Budgets", identifier="BG", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    return project


@pytest.fixture
def state(project):
    return State.objects.create(project=project, name="Todo", color="#123456")


def make_issue(project, state, sequence_id, parent=None):
    return Issue.objects.bulk_create(
        [
            Issue(
                project=project,
                workspace=project.workspace,
                state=state,
                name=f"Task {sequence_id}",
                sequence_id=sequence_id,
                parent=parent,
            )
        ]
    )[0]


def log(issue, user, minutes, day=DAY):
    return IssueWorkLog.objects.create(
        project=issue.project, issue=issue, logged_by=user, duration_minutes=minutes, logged_on=day
    )


@pytest.fixture
def tree(project, state):
    """module task -> sub task -> sub sub task, plus one task that is in no module."""
    module = Module.objects.create(project=project, name="Module")
    top = make_issue(project, state, 1)
    sub = make_issue(project, state, 2, parent=top)
    subsub = make_issue(project, state, 3, parent=sub)
    loose = make_issue(project, state, 4)
    ModuleIssue.objects.create(project=project, module=module, issue=top)
    return module, top, sub, subsub, loose


# -- module: everything below the module --------------------------------------------------------------------------


def test_module_counts_subtasks_by_default_and_can_ignore_them(create_user, tree):
    module, top, sub, subsub, loose = tree
    for issue, minutes in ((top, 10), (sub, 20), (subsub, 40), (loose, 1000)):
        log(issue, create_user, minutes)
    assert monthly_minutes(module, MONTH) == 70
    ModuleTimeBudget.objects.create(module=module, limit_minutes=500, include_subtasks=False)
    assert monthly_minutes(module, MONTH, include_subtasks=False) == 10


def test_task_linked_twice_in_one_module_branch_is_not_counted_twice(project, state, create_user, tree):
    module, top, sub, *_ = tree
    ModuleIssue.objects.create(project=project, module=module, issue=sub)
    log(sub, create_user, 25)
    assert monthly_minutes(module, MONTH) == 25


def test_subtask_time_triggers_the_module_alert(project, create_user, tree):
    module, top, sub, subsub, loose = tree
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60)
    log(top, create_user, 30)
    log(subsub, create_user, 30)
    check_issue_time_budgets(subsub.id, MONTH)
    assert Notification.objects.filter(entity_name="module", receiver=create_user).count() == 1


def test_module_without_subtasks_ignores_subtask_time(create_user, tree):
    module, top, sub, *_ = tree
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60, include_subtasks=False)
    log(sub, create_user, 120)
    check_issue_time_budgets(sub.id, MONTH)
    assert not Notification.objects.exists()


# -- project: modules and specific tasks --------------------------------------------------------------------------


def test_project_total_splits_module_tasks_and_specific_tasks(project, create_user, tree):
    module, top, sub, subsub, loose = tree
    for issue, minutes in ((top, 10), (sub, 20), (loose, 300)):
        log(issue, create_user, minutes)
    assert project_monthly_minutes(project, MONTH) == (330, 30, 300)


@pytest.mark.parametrize(
    "count_modules,count_other,expected",
    [(True, True, 330), (True, False, 30), (False, True, 300)],
)
def test_project_budget_counts_only_selected_parts(project, create_user, tree, count_modules, count_other, expected):
    module, top, sub, subsub, loose = tree
    for issue, minutes in ((top, 10), (sub, 20), (loose, 300)):
        log(issue, create_user, minutes)
    budget = ProjectTimeBudget.objects.create(
        project=project, limit_minutes=60, count_module_tasks=count_modules, count_other_tasks=count_other
    )
    assert project_monthly_minutes(project, MONTH, budget)[0] == expected


def test_project_budget_without_subtasks_treats_them_as_specific_tasks(project, create_user, tree):
    module, top, sub, *_ = tree
    log(top, create_user, 10)
    log(sub, create_user, 20)
    budget = ProjectTimeBudget.objects.create(project=project, limit_minutes=60, include_subtasks=False)
    assert project_monthly_minutes(project, MONTH, budget) == (30, 10, 20)


def test_project_alert_is_sent_once_per_month_to_members_and_admins(workspace, project, create_user, tree):
    module, top, sub, subsub, loose = tree
    member = User.objects.create(email="member@gizmo.so", username="member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    ProjectMember.objects.create(project=project, member=member, role=15)
    guest = User.objects.create(email="guest@gizmo.so", username="guest")
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    ProjectMember.objects.create(project=project, member=guest, role=5)
    ProjectTimeBudget.objects.create(project=project, limit_minutes=100)
    log(loose, create_user, 99)
    check_project_time_budget(project.id, MONTH)
    assert not Notification.objects.exists()
    log(top, create_user, 1)
    check_issue_time_budgets(top.id, MONTH)
    check_issue_time_budgets(top.id, MONTH)
    notifications = Notification.objects.filter(entity_name="project")
    assert notifications.count() == 2
    assert set(notifications.values_list("receiver_id", flat=True)) == {create_user.id, member.id}
    assert ProjectTimeBudgetAlert.objects.count() == 1
    assert notifications.first().data["project"]["id"] == str(project.id)
    # a new month re-arms the alert
    log(loose, create_user, 100, date(2026, 11, 3))
    check_project_time_budget(project.id, date(2026, 11, 1))
    assert ProjectTimeBudgetAlert.objects.count() == 2


def test_moving_a_task_into_a_module_rechecks_the_project_split(project, state, create_user):
    module = Module.objects.create(project=project, name="Late module")
    task = make_issue(project, state, 1)
    ProjectTimeBudget.objects.create(project=project, limit_minutes=50, count_other_tasks=False)
    log(task, create_user, 50, project_month(project))
    check_project_time_budget(project.id)
    assert not Notification.objects.exists()
    ModuleIssue.objects.create(project=project, module=module, issue=task)
    check_linked_module_time_budgets([module.id])
    assert Notification.objects.filter(entity_name="project").count() == 1


# -- API ------------------------------------------------------------------------------------------------------------


def project_url(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/time-budget/"


def test_project_budget_api_roundtrip_and_validation(session_client, workspace, project, create_user, tree):
    module, top, sub, subsub, loose = tree
    log(loose, create_user, 90, project_month(project))
    url = project_url(workspace, project)
    summary = session_client.get(url).data
    assert summary["limit_minutes"] is None
    assert summary["other_minutes"] == 90
    assert session_client.patch(url, {}, format="json").status_code == 400
    assert session_client.patch(url, {"limit_minutes": 0}, format="json").status_code == 400
    both_off = {"limit_minutes": 60, "count_module_tasks": False, "count_other_tasks": False}
    assert session_client.patch(url, both_off, format="json").status_code == 400
    response = session_client.patch(url, {"limit_minutes": 60, "count_module_tasks": False}, format="json")
    assert response.status_code == 200
    assert response.data["reached"] is True
    assert response.data["count_module_tasks"] is False
    assert Notification.objects.filter(entity_name="project").count() == 1
    # switching off the only counted part is rejected on top of the stored settings
    assert session_client.patch(url, {"count_other_tasks": False}, format="json").status_code == 400
    response = session_client.patch(url, {"limit_minutes": None}, format="json")
    assert response.data["limit_minutes"] is None
    assert response.data["reached"] is False


def test_project_budget_api_permissions(session_client, workspace, project, create_user):
    url = project_url(workspace, project)
    member = User.objects.create(email="api-member@gizmo.so", username="api-member")
    WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
    ProjectMember.objects.create(project=project, member=member, role=15)
    guest = User.objects.create(email="api-guest@gizmo.so", username="api-guest")
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    ProjectMember.objects.create(project=project, member=guest, role=5)
    outsider = User.objects.create(email="api-outsider@gizmo.so", username="api-outsider")
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)

    def client_for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    assert client_for(member).get(url).status_code == 200
    assert client_for(member).patch(url, {"limit_minutes": 60}, format="json").status_code == 403
    assert client_for(guest).get(url).status_code == 403
    assert client_for(outsider).get(url).status_code == 403
    assert session_client.patch(url, {"limit_minutes": 60}, format="json").status_code == 200


def test_module_budget_api_stores_the_subtask_switch(session_client, workspace, project, create_user, tree):
    module, top, sub, *_ = tree
    url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/modules/{module.id}/time-budget/"
    log(sub, create_user, 45, project_month(project))
    assert session_client.get(url).data["total_minutes"] == 45
    response = session_client.patch(url, {"include_subtasks": False}, format="json")
    assert response.status_code == 200
    assert response.data["include_subtasks"] is False
    assert response.data["total_minutes"] == 0
    assert response.data["limit_minutes"] is None
    response = session_client.patch(url, {"limit_minutes": 30}, format="json")
    assert response.data["include_subtasks"] is False
    assert session_client.patch(url, {}, format="json").status_code == 400
