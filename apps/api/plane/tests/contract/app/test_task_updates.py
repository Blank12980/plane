import json
from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from plane.app.serializers import IssueCommentSerializer
from plane.bgtasks.notification_task import notifications
from plane.db.models import (
    Issue,
    IssueComment,
    IssueWorkLog,
    Module,
    ModuleIssue,
    ModuleTimeBudget,
    ModuleTimeBudgetAlert,
    Notification,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.utils.module_time_budget import check_module_time_budget, monthly_minutes, module_month

pytestmark = [pytest.mark.contract, pytest.mark.django_db]


@pytest.fixture(autouse=True)
def background_tasks():
    with (
        patch("plane.db.mixins.soft_delete_related_objects.delay"),
        patch("plane.app.views.issue.comment.issue_activity.delay"),
        patch("plane.app.views.issue.comment.model_activity.delay"),
    ):
        yield


@pytest.fixture
def task(workspace, create_user):
    project = Project.objects.create(name="Updates", identifier="UP", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20)
    state = State.objects.create(project=project, name="Todo", color="#123456")
    return Issue.objects.bulk_create(
        [Issue(project=project, workspace=workspace, state=state, name="Task", sequence_id=1)]
    )[0]


@pytest.fixture
def module(task):
    module = Module.objects.create(project=task.project, name="Monthly hours")
    ModuleIssue.objects.create(project=task.project, module=module, issue=task)
    return module


def log_time(task, user, minutes, day):
    return IssueWorkLog.objects.create(
        project=task.project, issue=task, logged_by=user, duration_minutes=minutes, logged_on=day
    )


def budget_url(workspace, task, module):
    return f"/api/workspaces/{workspace.slug}/projects/{task.project_id}/modules/{module.id}/time-budget/"


def comment_url(workspace, task):
    return f"/api/workspaces/{workspace.slug}/projects/{task.project_id}/issues/{task.id}/comments/"


def test_monthly_sum_uses_dates_and_current_module_membership(task, module, create_user):
    log_time(task, create_user, 40, date(2026, 9, 30))
    log_time(task, create_user, 60, date(2026, 10, 1))
    log_time(task, create_user, 90, date(2026, 10, 31))
    log_time(task, create_user, 100, date(2026, 11, 1))
    unrelated = Module.objects.create(project=task.project, name="Other")
    assert monthly_minutes(module, date(2026, 10, 1)) == 150
    assert monthly_minutes(unrelated, date(2026, 10, 1)) == 0
    assert monthly_minutes(module, date(2026, 12, 1)) == 0
    ModuleIssue.objects.filter(module=module).delete()
    assert monthly_minutes(module, date(2026, 10, 1)) == 0


def test_exact_threshold_notifies_once_and_new_month_rearms(workspace, task, module, create_user):
    ModuleTimeBudget.objects.create(module=module, limit_minutes=120)
    entry = log_time(task, create_user, 119, date(2026, 9, 1))
    check_module_time_budget(module.id, date(2026, 9, 1))
    assert not Notification.objects.exists()
    entry.duration_minutes = 120
    entry.save()
    check_module_time_budget(module.id, date(2026, 9, 1))
    check_module_time_budget(module.id, date(2026, 9, 1))
    assert Notification.objects.filter(receiver=create_user, entity_name="module").count() == 1
    entry.duration_minutes = 1
    entry.save()
    entry.duration_minutes = 140
    entry.save()
    check_module_time_budget(module.id, date(2026, 9, 1))
    assert ModuleTimeBudgetAlert.objects.count() == 1
    log_time(task, create_user, 120, date(2026, 10, 1))
    check_module_time_budget(module.id, date(2026, 10, 1))
    assert Notification.objects.count() == 2


def test_budget_api_existing_hours_disable_and_invalid_limits(session_client, workspace, task, module, create_user):
    log_time(task, create_user, 120, module_month(module))
    url = budget_url(workspace, task, module)
    assert session_client.get(url).data["total_minutes"] == 120
    for value in (0, -1, "abc", 1.5, 2147483648):
        assert session_client.patch(url, {"limit_minutes": value}, format="json").status_code == 400
    assert session_client.patch(url, {}, format="json").status_code == 400
    response = session_client.patch(url, {"limit_minutes": 120}, format="json")
    assert response.status_code == 200
    assert response.data["reached"] is True
    assert Notification.objects.count() == 1
    response = session_client.patch(url, {"limit_minutes": None}, format="json")
    assert response.data["limit_minutes"] is None
    assert response.data["reached"] is False


def test_worklog_save_schedules_alert_after_commit(task, module, create_user, django_capture_on_commit_callbacks):
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60)
    with django_capture_on_commit_callbacks(execute=True):
        entry = log_time(task, create_user, 30, module_month(module))
    assert not Notification.objects.exists()
    with django_capture_on_commit_callbacks(execute=True):
        entry.duration_minutes = 60
        entry.save()
    assert Notification.objects.count() == 1


def test_month_sums_all_tasks_without_counting_other_modules(task, module, create_user):
    second, outside = Issue.objects.bulk_create(
        [
            Issue(project=task.project, workspace_id=task.workspace_id, state=task.state, name="Second", sequence_id=2),
            Issue(
                project=task.project, workspace_id=task.workspace_id, state=task.state, name="Outside", sequence_id=3
            ),
        ]
    )
    ModuleIssue.objects.create(project=task.project, module=module, issue=second)
    other = Module.objects.create(project=task.project, name="Shared task")
    ModuleIssue.objects.create(project=task.project, module=other, issue=task)
    log_time(task, create_user, 60, date(2026, 10, 1))
    log_time(second, create_user, 90, date(2026, 10, 2))
    log_time(outside, create_user, 500, date(2026, 10, 2))
    assert monthly_minutes(module, date(2026, 10, 1)) == 150
    assert monthly_minutes(other, date(2026, 10, 1)) == 60


def test_month_boundary_uses_project_timezone(module):
    module.project.timezone = "America/Los_Angeles"
    with patch("django.utils.timezone.now", return_value=datetime(2027, 1, 1, 1, tzinfo=UTC)):
        assert module_month(module) == date(2026, 12, 1)


def test_attaching_task_with_existing_hours_checks_limit(session_client, workspace, task, module, create_user):
    ModuleIssue.objects.filter(module=module).delete()
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60)
    log_time(task, create_user, 60, module_month(module))
    url = f"/api/workspaces/{workspace.slug}/projects/{task.project_id}/modules/{module.id}/issues/"
    response = session_client.post(url, {"issues": [str(task.id)]}, format="json")
    assert response.status_code == 201
    assert ModuleTimeBudgetAlert.objects.count() == 1


def test_limit_does_not_notify_departed_members_guests_or_clients(workspace, task, module, create_user):
    users = []
    for role, active in [(15, True), (15, False), (5, True), (3, True)]:
        user = User.objects.create(email=f"recipient-{len(users)}@gizmo.so", username=f"recipient-{len(users)}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=role, is_active=active)
        ProjectMember.objects.create(project=task.project, member=user, role=15)
        users.append(user)
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60)
    log_time(task, create_user, 60, module_month(module))
    check_module_time_budget(module.id)
    assert set(Notification.objects.values_list("receiver_id", flat=True)) == {create_user.id, users[0].id}


def test_budget_is_protected_from_guests_and_cross_project_ids(session_client, workspace, task, module, create_user):
    guest = User.objects.create(email="budget-guest@gizmo.so", username="budget-guest")
    WorkspaceMember.objects.create(workspace=workspace, member=guest, role=5)
    ProjectMember.objects.create(project=task.project, member=guest, role=5)
    client = APIClient()
    client.force_authenticate(user=guest)
    url = budget_url(workspace, task, module)
    assert client.get(url).status_code == 403
    assert client.patch(url, {"limit_minutes": 60}, format="json").status_code == 403
    other = Project.objects.create(workspace=workspace, name="Other project", identifier="OT")
    ProjectMember.objects.create(project=other, member=create_user, role=20)
    assert session_client.get(url.replace(str(task.project_id), str(other.id))).status_code == 403


def test_recent_notifications_include_limits_and_exclude_hidden_snoozed_archived(
    session_client, workspace, task, module, create_user
):
    ModuleTimeBudget.objects.create(module=module, limit_minutes=60)
    log_time(task, create_user, 60, module_month(module))
    check_module_time_budget(module.id)
    base = dict(workspace=workspace, receiver=create_user, entity_name="issue", entity_identifier=task.id)
    Notification.objects.create(**base, project=task.project, sender="mentioned", title="Mention")
    Notification.objects.create(
        **base, project=task.project, sender="test", title="Snoozed", snoozed_till=timezone.now() + timedelta(days=1)
    )
    Notification.objects.create(
        **base, project=task.project, sender="test", title="Archived", archived_at=timezone.now()
    )
    private = Project.objects.create(workspace=workspace, name="Hidden", identifier="HI", network=0)
    outsider = User.objects.create(email="notification-outsider@gizmo.so", username="notification-outsider")
    WorkspaceMember.objects.create(workspace=workspace, member=outsider, role=15)
    Notification.objects.create(
        workspace=workspace,
        project=private,
        receiver=outsider,
        entity_name="module",
        entity_identifier=module.id,
        sender="test",
        title="Secret",
    )
    url = f"/api/workspaces/{workspace.slug}/users/notifications/"
    response = session_client.get(url + "unread/")
    assert response.status_code == 200
    assert response.data["total_unread_notifications_count"] == 1
    assert response.data["mention_unread_notifications_count"] == 1
    assert {item["entity_name"] for item in response.data["recent_notifications"]} == {"issue", "module"}
    assert any(item["entity_name"] == "module" for item in session_client.get(url).data)
    client = APIClient()
    client.force_authenticate(user=outsider)
    assert client.get(url + "unread/").data["recent_notifications"] == []


def test_reply_create_inherits_visibility_and_rejects_cross_issue_parent(session_client, workspace, task, create_user):
    root = IssueComment.objects.create(project=task.project, issue=task, actor=create_user, comment_html="<p>Root</p>")
    url = comment_url(workspace, task)
    response = session_client.post(url, {"parent": str(root.id), "comment_html": "<p>Reply</p>"}, format="json")
    assert response.status_code == 201
    assert str(response.data["parent"]) == str(root.id)
    assert response.data["access"] == "INTERNAL"
    assert session_client.post(url, {"parent": str(root.id), "access": "EXTERNAL"}, format="json").status_code == 400
    invalid = IssueCommentSerializer(data={"parent": root.id}, context={"issue_id": "different-issue"})
    assert not invalid.is_valid()
    reparent = session_client.patch(url + str(response.data["id"]) + "/", {"parent": None}, format="json")
    assert reparent.status_code == 400
    # Making a root public must never expose its existing private replies.
    assert session_client.patch(url + str(root.id) + "/", {"access": "EXTERNAL"}, format="json").status_code == 400


def test_deleting_root_preserves_replies(session_client, workspace, task, create_user):
    root = IssueComment.objects.create(project=task.project, issue=task, actor=create_user, comment_html="<p>Root</p>")
    reply = IssueComment.objects.create(
        project=task.project, issue=task, actor=create_user, parent=root, comment_html="<p>Reply</p>"
    )
    assert session_client.delete(comment_url(workspace, task) + str(root.id) + "/").status_code == 204
    reply.refresh_from_db()
    assert reply.deleted_at is None
    assert reply.parent_id is None


def test_reply_notifies_parent_author_without_subscription(workspace, task, create_user):
    actor = User.objects.create(email="reply-author@gizmo.so", username="reply-author")
    WorkspaceMember.objects.create(workspace=workspace, member=actor, role=15)
    ProjectMember.objects.create(project=task.project, member=actor, role=15)
    root = IssueComment.objects.create(project=task.project, issue=task, actor=create_user, comment_html="<p>Root</p>")
    reply = IssueComment.objects.create(
        project=task.project, issue=task, actor=actor, parent=root, comment_html="<p>Reply</p>"
    )
    activity = {
        "id": str(reply.id),
        "issue_detail": {"id": str(task.id)},
        "field": "comment",
        "verb": "created",
        "actor_id": str(actor.id),
        "issue_comment": str(reply.id),
        "comment": "replied",
    }
    notifications.run(
        type="comment.activity.created",
        issue_id=str(task.id),
        project_id=str(task.project_id),
        actor_id=str(actor.id),
        subscriber=False,
        issue_activities_created=json.dumps([activity]),
        requested_data=json.dumps({"parent": str(root.id), "comment_html": reply.comment_html}),
        current_instance=None,
    )
    assert Notification.objects.filter(receiver=create_user, entity_name="issue").count() == 1
    assert not Notification.objects.filter(receiver=actor).exists()
    WorkspaceMember.objects.filter(workspace=workspace, member=create_user).update(role=3)
    notifications.run(
        type="comment.activity.created",
        issue_id=str(task.id),
        project_id=str(task.project_id),
        actor_id=str(actor.id),
        subscriber=False,
        issue_activities_created=json.dumps([activity]),
        requested_data=json.dumps({"parent": str(root.id), "comment_html": reply.comment_html}),
        current_instance=None,
    )
    assert Notification.objects.filter(receiver=create_user).count() == 1


@pytest.mark.parametrize("surface", ["app", "api", "space"])
def test_all_comment_surfaces_validate_parent_scope_and_visibility(surface, task, create_user):
    from plane.api.serializers.issue import IssueCommentCreateSerializer
    from plane.space.serializer.issue import IssueCommentSerializer as PublicCommentSerializer

    serializer_class = {
        "app": IssueCommentSerializer,
        "api": IssueCommentCreateSerializer,
        "space": PublicCommentSerializer,
    }[surface]
    root = IssueComment.objects.create(
        project=task.project, issue=task, actor=create_user, comment_html="<p>Root</p>", access="EXTERNAL"
    )
    payload = {"parent": root.id, "comment_html": "<p>Reply</p>", "access": "EXTERNAL"}
    valid = serializer_class(data=payload, context={"issue_id": task.id})
    assert valid.is_valid(), valid.errors
    invalid = serializer_class(data=payload, context={"issue_id": "another-task"})
    assert not invalid.is_valid()
    root.access = "INTERNAL"
    root.save()
    invalid = serializer_class(data=payload, context={"issue_id": task.id})
    assert not invalid.is_valid()


def test_nested_reply_keeps_its_direct_parent(session_client, workspace, task, create_user):
    root = IssueComment.objects.create(project=task.project, issue=task, actor=create_user, comment_html="<p>Root</p>")
    reply = IssueComment.objects.create(
        project=task.project, issue=task, actor=create_user, parent=root, comment_html="<p>Reply</p>"
    )
    response = session_client.post(
        comment_url(workspace, task), {"parent": str(reply.id), "comment_html": "<p>Nested reply</p>"}, format="json"
    )
    assert response.status_code == 201
    assert str(response.data["parent"]) == str(reply.id)
