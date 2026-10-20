/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { createElement, useEffect } from "react";
// gizmo imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TUnreadNotificationsCount } from "@plane/types";
// helpers
import {
  notificationAlertTracker,
  notificationSoundEnabled,
  notificationTarget,
  playNotificationSound,
} from "@/helpers/notification-alerts";

/**
 * Shows a toast (and plays the sound, if the user enabled it) for notifications that arrived since the last poll.
 * The tracker is shared per user and workspace, so calling the hook from several components never repeats a toast.
 */
export function useNotificationAlerts(
  userId: string | undefined,
  workspaceSlug: string,
  data: TUnreadNotificationsCount | undefined
) {
  useEffect(() => {
    if (!userId || !data?.recent_notifications) return;
    const fresh = notificationAlertTracker(`${userId}:${workspaceSlug}`).ingest(data.recent_notifications);
    if (!fresh.length) return;
    const latest = fresh[0];
    const isBudgetAlert = latest.entity_name === "module" || latest.entity_name === "project";
    setToast({
      id: `notification-${latest.id}`,
      type: isBudgetAlert ? TOAST_TYPE.WARNING : TOAST_TYPE.INFO,
      title: latest.title || (isBudgetAlert ? "Достигнут лимит часов" : "Новое действие в задаче"),
      message: fresh.length > 1 ? `Новых уведомлений: ${fresh.length}` : latest.data?.issue?.name || latest.title,
      actionItems: createElement(
        "a",
        { className: "text-accent-primary underline", href: notificationTarget(workspaceSlug, latest) },
        "Открыть уведомление"
      ),
    });
    if (notificationSoundEnabled(userId)) void playNotificationSound();
  }, [data, userId, workspaceSlug]);
}
