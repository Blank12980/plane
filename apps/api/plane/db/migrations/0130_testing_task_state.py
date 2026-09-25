from django.db import migrations


def add_testing_task_state(apps, schema_editor):
    Project = apps.get_model("db", "Project")
    State = apps.get_model("db", "State")
    db_alias = schema_editor.connection.alias

    for project in Project.objects.using(db_alias).filter(deleted_at__isnull=True).iterator():
        states_by_name = {
            state.name: state.sequence
            for state in State.objects.using(db_alias).filter(project_id=project.id, deleted_at__isnull=True)
        }
        if "Тестирование" in states_by_name:
            continue

        review_sequence = states_by_name.get("На ревью")
        done_sequence = states_by_name.get("Готово")
        sequence = 42500
        if review_sequence is not None and done_sequence is not None and review_sequence < done_sequence:
            sequence = (review_sequence + done_sequence) / 2

        State.objects.using(db_alias).bulk_create(
            [
                State(
                    name="Тестирование",
                    color="#06B6D4",
                    sequence=sequence,
                    group="started",
                    default=False,
                    project_id=project.id,
                    workspace_id=project.workspace_id,
                )
            ]
        )


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0129_promote_explicit_instance_admin_members"),
    ]

    operations = [
        migrations.RunPython(add_testing_task_state, migrations.RunPython.noop),
    ]
