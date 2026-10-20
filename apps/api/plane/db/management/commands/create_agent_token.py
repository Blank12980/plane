# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Create a scoped, workspace bound API token for an AI agent (MCP client).

Example:
    python manage.py create_agent_token --email triage-bot@example.com --workspace acme \\
        --create-bot --projects WEB,API --scopes read,issues:write,comments:write \\
        --rate-limit 120/min --expires-days 90
"""

# Python imports
from datetime import timedelta
from uuid import uuid4

# Django imports
from django.core.management import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

# Module imports
from plane.api.rate_limit import is_valid_rate
from plane.db.models import APIToken, Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.db.models.api import API_TOKEN_SCOPES

MEMBER_ROLE = 15


class Command(BaseCommand):
    help = "Create a scoped, workspace bound API token for an AI agent (MCP)"

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Email of the (bot) user that owns the token")
        parser.add_argument("--workspace", required=True, help="Workspace slug the token is bound to")
        parser.add_argument(
            "--scopes",
            default="read",
            help=f"Comma separated scopes. Available: {', '.join(API_TOKEN_SCOPES)}",
        )
        parser.add_argument("--rate-limit", default="60/min", help="Requests per period, e.g. 120/min")
        parser.add_argument("--expires-days", type=int, default=90, help="Token lifetime in days (0 = never)")
        parser.add_argument("--label", default=None, help="Token label")
        parser.add_argument(
            "--create-bot",
            action="store_true",
            help="Create the bot user and add it to the workspace as a member if it does not exist",
        )
        parser.add_argument(
            "--projects",
            default="",
            help="Comma separated project identifiers to add the bot to as a member",
        )

    def handle(self, *args, **options):
        scopes = [scope.strip() for scope in options["scopes"].split(",") if scope.strip()]
        unknown = sorted(set(scopes) - set(API_TOKEN_SCOPES))
        if unknown:
            raise CommandError(f"Unknown scopes: {', '.join(unknown)}")
        if not scopes:
            raise CommandError("At least one scope is required for agent tokens")
        if not is_valid_rate(options["rate_limit"]):
            raise CommandError("Rate limit must look like 60/min, 10/s, 1000/hour")
        if options["expires_days"] < 0:
            raise CommandError("Token lifetime cannot be negative (use 0 for no expiry)")

        workspace = Workspace.objects.filter(slug=options["workspace"]).first()
        if workspace is None:
            raise CommandError("Workspace not found")

        with transaction.atomic():
            user = User.objects.filter(email=options["email"]).first()
            if user is None:
                if not options["create_bot"]:
                    raise CommandError("User not found (use --create-bot to create a bot user)")
                user = User.objects.create(
                    email=options["email"],
                    username=f"agent_{uuid4().hex[:12]}",
                    display_name=options["email"].split("@")[0],
                    first_name=options["email"].split("@")[0],
                    is_bot=True,
                    bot_type="MCP_AGENT",
                )
                user.set_unusable_password()
                user.save()

            if not user.is_active:
                raise CommandError("User is inactive")

            member, _ = WorkspaceMember.objects.get_or_create(
                workspace=workspace, member=user, defaults={"role": MEMBER_ROLE}
            )
            if not member.is_active:
                raise CommandError("User is not an active member of the workspace")

            identifiers = [value.strip() for value in options["projects"].split(",") if value.strip()]
            for identifier in identifiers:
                project = Project.objects.filter(workspace=workspace, identifier=identifier).first()
                if project is None:
                    raise CommandError(f"Project {identifier} not found")
                ProjectMember.objects.get_or_create(
                    project=project, member=user, workspace=workspace, defaults={"role": MEMBER_ROLE}
                )

            expires_days = options["expires_days"]
            token = APIToken.objects.create(
                label=options["label"] or f"MCP agent {user.email}",
                description="Created with create_agent_token",
                user=user,
                user_type=1 if user.is_bot else 0,
                workspace=workspace,
                scopes=[scope for scope in API_TOKEN_SCOPES if scope in scopes],
                source="mcp",
                allowed_rate_limit=options["rate_limit"],
                expired_at=timezone.now() + timedelta(days=expires_days) if expires_days > 0 else None,
            )

        self.stdout.write(self.style.SUCCESS(f"Token created for {user.email} in workspace {workspace.slug}"))
        self.stdout.write(f"Scopes: {', '.join(token.scopes)}")
        self.stdout.write(f"Rate limit: {token.allowed_rate_limit}")
        self.stdout.write(f"Expires: {token.expired_at or 'never'}")
        self.stdout.write(token.token)
