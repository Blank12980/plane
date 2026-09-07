# Copyright (c) 2023-present Gizmo Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import os
from datetime import timedelta

# Django imports
from django.utils import timezone
from django.db.models import Q

# Third party imports
from celery import shared_task

# Module imports
from plane.db.models import FileAsset


@shared_task
def delete_unuploaded_file_asset():
    """This task deletes unuploaded file assets older than a certain number of days."""
    cutoff = timezone.now() - timedelta(days=int(os.environ.get("UNUPLOADED_ASSET_DELETE_DAYS", "7")))

    FileAsset.objects.filter(Q(created_at__lt=cutoff) & Q(is_uploaded=False)).delete()

    # Comment attachments are uploaded before the comment exists, so an abandoned
    # draft leaves an uploaded asset that never got bound to a comment.
    FileAsset.objects.filter(
        created_at__lt=cutoff,
        entity_type=FileAsset.EntityTypeContext.COMMENT_ATTACHMENT,
        comment_id__isnull=True,
    ).delete()
