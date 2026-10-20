from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("db", "0139_apitoken_source"),
    ]

    operations = [
        migrations.AddField(
            model_name="issueassignee",
            name="seen_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        # Everything assigned before this release is already known to the assignees: only new assignments are "new".
        migrations.RunSQL(
            sql="UPDATE issue_assignees SET seen_at = created_at WHERE seen_at IS NULL",
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
