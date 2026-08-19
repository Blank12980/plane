from django.db import migrations


VISIBLE_DEFAULT_STATES = [
    {
        "name": "Бэклог",
        "color": "#60646C",
        "sequence": 15000,
        "group": "backlog",
        "default": True,
    },
    {
        "name": "На уточнении",
        "color": "#3F76FF",
        "sequence": 25000,
        "group": "unstarted",
        "default": False,
    },
    {
        "name": "В работе",
        "color": "#F59E0B",
        "sequence": 35000,
        "group": "started",
        "default": False,
    },
    {
        "name": "На ревью",
        "color": "#8B5CF6",
        "sequence": 40000,
        "group": "started",
        "default": False,
    },
    {
        "name": "Готово",
        "color": "#46A758",
        "sequence": 45000,
        "group": "completed",
        "default": False,
    },
]

ENGLISH_TO_RUSSIAN_NAMES = {
    "Backlog": "Бэклог",
    "Todo": "На уточнении",
    "In Progress": "В работе",
    "Done": "Готово",
}


def apply_default_task_states(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")

    for project in Project.objects.filter(deleted_at__isnull=True).iterator():
        existing_by_name = {
            state.name: state
            for state in State.objects.filter(project_id=project.id, deleted_at__isnull=True)
        }

        for english_name, russian_name in ENGLISH_TO_RUSSIAN_NAMES.items():
            state = existing_by_name.get(english_name)
            if state is None or russian_name in existing_by_name:
                continue
            state.name = russian_name
            state.save(update_fields=["name"])
            existing_by_name[russian_name] = state
            existing_by_name.pop(english_name, None)

        has_default = any(state.default for state in existing_by_name.values())

        for spec in VISIBLE_DEFAULT_STATES:
            if spec["name"] in existing_by_name:
                continue
            is_default = spec["default"] and not has_default
            State.objects.create(
                name=spec["name"],
                color=spec["color"],
                sequence=spec["sequence"],
                group=spec["group"],
                default=is_default,
                project_id=project.id,
                workspace_id=project.workspace_id,
            )
            if is_default:
                has_default = True


def revert_default_task_states(apps, schema_editor):
    State = apps.get_model("db", "State")

    for english_name, russian_name in ENGLISH_TO_RUSSIAN_NAMES.items():
        State.objects.filter(name=russian_name, deleted_at__isnull=True).exclude(
            project_id__in=State.objects.filter(name=english_name, deleted_at__isnull=True).values("project_id")
        ).update(name=english_name)


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0127_user_ban_metadata"),
    ]

    operations = [
        migrations.RunPython(apply_default_task_states, revert_default_task_states),
    ]
