/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
// gizmo imports
import { getNumberCount } from "@plane/utils";
// components
import { CountChip } from "@/components/common/count-chip";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useUser } from "@/hooks/store/user";
import { useNotificationAlerts } from "@/hooks/use-notification-alerts";

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

  useNotificationAlerts(user?.id, workspaceSlug, data);

  // derived values
  const isMentionsEnabled = unreadNotificationsCount.mention_unread_notifications_count > 0;
  const totalNotifications =
    unreadNotificationsCount.mention_unread_notifications_count +
    unreadNotificationsCount.total_unread_notifications_count;
  const hasNewTasks = (unreadNotificationsCount.new_tasks_count ?? 0) > 0;

  if (totalNotifications <= 0 && !hasNewTasks) return <></>;

  return (
    <div className="ml-auto flex items-center gap-1.5" aria-label={`Непрочитанных уведомлений: ${totalNotifications}`}>
      {hasNewTasks && (
        <span
          title="Есть новые задачи"
          className="flex size-4 items-center justify-center rounded-full bg-danger-primary text-[11px] leading-none font-bold text-white"
        >
          !
        </span>
      )}
      {totalNotifications > 0 && (
        <div className="rounded bg-accent-primary/15 px-1 font-semibold text-accent-primary">
          <CountChip count={`${isMentionsEnabled ? `@ ` : ``}${getNumberCount(totalNotifications)}`} />
        </div>
      )}
    </div>
  );
});
