/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
// gizmo imports
import { Button } from "@plane/propel/button";
import { InboxIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { calculateTimeAgo, cn } from "@plane/utils";
// components
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
// helpers
import { newTaskNotifications, notificationHeadline, notificationTarget } from "@/helpers/notification-alerts";
// hooks
import { useWorkspaceNotifications } from "@/hooks/store/notifications";
import { useUser } from "@/hooks/store/user";
import { useNotificationAlerts } from "@/hooks/use-notification-alerts";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 220;
const MAX_VISIBLE_TASKS = 6;

/**
 * The notifications icon of the top navigation. Unread items are signalled with a large red "!" badge; hovering the
 * icon shows the new tasks right below it together with a "mark as read" action.
 */
export const NotificationBell = observer(function NotificationBell() {
  const { workspaceSlug: routeWorkspaceSlug } = useParams();
  const pathname = usePathname();
  const workspaceSlug = routeWorkspaceSlug?.toString() ?? "";
  // states
  const [isOpen, setIsOpen] = useState(false);
  const [isMarking, setIsMarking] = useState(false);
  // refs
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  // store hooks
  const { data: user } = useUser();
  const { unreadNotificationsCount, getUnreadNotificationsCount, markAllUnreadAsRead } = useWorkspaceNotifications();

  const { data } = useSWR(
    workspaceSlug && user?.id ? ["WORKSPACE_UNREAD_NOTIFICATION_COUNT", user.id, workspaceSlug] : null,
    () => getUnreadNotificationsCount(workspaceSlug),
    { refreshInterval: 15_000, revalidateOnFocus: true, refreshWhenHidden: false }
  );
  useNotificationAlerts(user?.id, workspaceSlug, data);

  // derived values
  const totalUnread =
    unreadNotificationsCount.total_unread_notifications_count +
    unreadNotificationsCount.mention_unread_notifications_count;
  const newTasks = newTaskNotifications(unreadNotificationsCount.recent_notifications);
  const visibleTasks = newTasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenCount = Math.max(0, Math.max(totalUnread, newTasks.length) - visibleTasks.length);
  const hasNewTasks = totalUnread > 0 || newTasks.length > 0;

  const scheduleOpen = (open: boolean) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsOpen(open), open ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleMarkAsRead = useCallback(async () => {
    if (!workspaceSlug || isMarking) return;
    setIsMarking(true);
    try {
      await markAllUnreadAsRead(workspaceSlug);
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось",
        message: "Не получилось отметить уведомления прочитанными. Попробуйте ещё раз.",
      });
    } finally {
      setIsMarking(false);
    }
  }, [workspaceSlug, isMarking, markAllUnreadAsRead]);

  return (
    <div
      role="group"
      aria-label="Уведомления"
      className="relative"
      onMouseEnter={() => scheduleOpen(true)}
      onMouseLeave={() => scheduleOpen(false)}
      onFocus={() => scheduleOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          clearTimeout(timerRef.current);
          setIsOpen(false);
        }
      }}
    >
      <AppSidebarItem
        variant="link"
        item={{
          href: `/${workspaceSlug}/notifications/`,
          icon: (
            <div className="relative" aria-label={hasNewTasks ? "Есть новые уведомления" : "Уведомления"}>
              <InboxIcon className="size-5" />
              {hasNewTasks && (
                <span
                  data-testid="notification-alert"
                  className="shadow-sm ring-canvas absolute -top-1.5 -right-2 flex size-4 items-center justify-center rounded-full bg-danger-primary text-[11px] leading-none font-bold text-white ring-2"
                >
                  !
                </span>
              )}
            </div>
          ),
          isActive: pathname?.includes("/notifications/"),
        }}
      />

      {isOpen && (
        <div
          role="dialog"
          aria-label="Уведомления"
          className="absolute top-full right-0 z-[30] mt-1 w-[22rem] max-w-[90vw] rounded-lg border border-subtle bg-surface-1 p-3 shadow-raised-200"
        >
          <div className="flex items-center justify-between">
            <Link
              href={`/${workspaceSlug}/notifications/`}
              className="text-body-sm-semibold text-primary hover:underline"
              onClick={() => setIsOpen(false)}
            >
              Уведомления
            </Link>
            {hasNewTasks && (
              <span className="rounded-full bg-danger-primary px-2 py-0.5 text-11 font-semibold text-white">
                {Math.max(totalUnread, newTasks.length)}
              </span>
            )}
          </div>

          <div className="mt-2">
            {visibleTasks.length > 0 ? (
              <ul className="flex max-h-72 flex-col overflow-y-auto">
                {visibleTasks.map((notification) => (
                  <li key={notification.id}>
                    <Link
                      href={notificationTarget(workspaceSlug, notification)}
                      className={cn("flex flex-col gap-0.5 rounded-md px-2 py-2 hover:bg-layer-1")}
                      onClick={() => setIsOpen(false)}
                    >
                      <span className="line-clamp-2 text-13 font-medium text-primary">
                        {notificationHeadline(notification)}
                      </span>
                      <span className="text-12 text-tertiary">
                        {[
                          notification.triggered_by_details?.display_name,
                          notification.created_at ? calculateTimeAgo(notification.created_at) : undefined,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : hasNewTasks ? (
              <p className="px-2 py-4 text-center text-13 text-secondary">
                Новые уведомления — в разделе «Уведомления».
              </p>
            ) : (
              <p className="px-2 py-4 text-center text-13 text-secondary">У вас нет новых задач</p>
            )}
            {hiddenCount > 0 && visibleTasks.length > 0 && (
              <p className="px-2 pt-1 text-12 text-tertiary">и ещё {hiddenCount}</p>
            )}
          </div>

          <div className="mt-3 border-t border-subtle pt-3">
            <Button
              variant="secondary"
              size="base"
              className="w-full"
              disabled={!hasNewTasks || isMarking}
              loading={isMarking}
              onClick={() => void handleMarkAsRead()}
            >
              Отметить прочитанным
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});
