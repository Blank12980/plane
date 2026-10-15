/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useEffect } from "react";
import useSWR from "swr";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// gizmo imports
import { getNumberCount } from "@plane/utils";
// components
import { CountChip } from "@/components/common/count-chip";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useUser } from "@/hooks/store/user";
import {
  notificationAlertTracker,
  notificationSoundEnabled,
  notificationTarget,
  playNotificationSound,
} from "@/helpers/notification-alerts";

type TNotificationAppSidebarOption = {
  workspaceSlug: string;
};

export const NotificationAppSidebarOption = observer(function NotificationAppSidebarOption(
  props: TNotificationAppSidebarOption
) {
  const { workspaceSlug } = props;
  // hooks
  const { unreadNotificationsCount, getUnreadNotificationsCount } = useWorkspaceNotifications();
  const { data: user } = useUser();

  const { data } = useSWR(
    workspaceSlug && user?.id ? ["WORKSPACE_UNREAD_NOTIFICATION_COUNT", user.id, workspaceSlug] : null,
    () => getUnreadNotificationsCount(workspaceSlug),
    { refreshInterval: 15_000, revalidateOnFocus: true, refreshWhenHidden: false }
  );

  useEffect(() => {
    if (!user?.id || !data?.recent_notifications) return;
    const fresh = notificationAlertTracker(`${user.id}:${workspaceSlug}`).ingest(data.recent_notifications);
    if (!fresh.length) return;
    const latest = fresh[0];
    setToast({
      id: `notification-${latest.id}`,
      type: latest.entity_name === "module" ? TOAST_TYPE.WARNING : TOAST_TYPE.INFO,
      title: latest.title || (latest.entity_name === "module" ? "Достигнут лимит часов" : "Новое действие в задаче"),
      message: fresh.length > 1 ? `Новых уведомлений: ${fresh.length}` : latest.data?.issue?.name || latest.title,
      actionItems: (
        <a className="text-accent-primary underline" href={notificationTarget(workspaceSlug, latest)}>
          Открыть уведомление
        </a>
      ),
    });
    if (notificationSoundEnabled(user.id)) void playNotificationSound();
  }, [data, user?.id, workspaceSlug]);

  // derived values
  const isMentionsEnabled = unreadNotificationsCount.mention_unread_notifications_count > 0;
  const totalNotifications =
    unreadNotificationsCount.mention_unread_notifications_count +
    unreadNotificationsCount.total_unread_notifications_count;

  if (totalNotifications <= 0) return <></>;

  return (
    <div
      className="ml-auto rounded bg-accent-primary/15 px-1 font-semibold text-accent-primary"
      aria-label={`Непрочитанных уведомлений: ${totalNotifications}`}
    >
      <CountChip count={`${isMentionsEnabled ? `@ ` : ``}${getNumberCount(totalNotifications)}`} />
    </div>
  );
});
