import { beforeEach, expect, test, vi } from "vitest";
import type { TNotification, TUnreadNotificationsCount } from "@plane/types";
import type { CoreRootStore } from "@/store/root.store";
import { WorkspaceNotificationStore } from "@/store/notifications/workspace-notifications.store";

const { fetchUnread } = vi.hoisted(() => ({ fetchUnread: vi.fn() }));
vi.mock("@/services/workspace-notification.service", () => ({
  default: { fetchUnreadNotificationsCount: fetchUnread },
}));
beforeEach(() => vi.clearAllMocks());
const count = (total: number): TUnreadNotificationsCount => ({
  total_unread_notifications_count: total,
  mention_unread_notifications_count: 0,
});

test("late response from the previous workspace cannot replace current unread counts", async () => {
  const router = { workspaceSlug: "first" };
  const store = new WorkspaceNotificationStore({ router } as CoreRootStore);
  let finish!: (value: TUnreadNotificationsCount) => void;
  fetchUnread.mockImplementationOnce(
    () =>
      new Promise<TUnreadNotificationsCount>((resolve) => {
        finish = resolve;
      })
  );
  const oldRequest = store.getUnreadNotificationsCount("first");
  router.workspaceSlug = "second";
  fetchUnread.mockResolvedValueOnce(count(2));
  await store.getUnreadNotificationsCount("second");
  finish(count(99));
  await oldRequest;
  expect(store.unreadNotificationsCount.total_unread_notifications_count).toBe(2);
});

test("recent notifications appear in the inbox as the counter refreshes", async () => {
  const store = new WorkspaceNotificationStore({ router: { workspaceSlug: "space" } } as CoreRootStore);
  const item = { id: "new", workspace: "workspace", created_at: "2026-10-01T00:00:00Z" } as TNotification;
  fetchUnread.mockResolvedValue({ ...count(1), recent_notifications: [item] });
  await store.getUnreadNotificationsCount("space");
  expect(store.notificationIdsByWorkspaceId("workspace")).toEqual(["new"]);
});

test("polling preserves the selected type filter", async () => {
  const store = new WorkspaceNotificationStore({ router: { workspaceSlug: "space" } } as CoreRootStore);
  store.filters.type.assigned = true;
  fetchUnread.mockResolvedValue({ ...count(1), recent_notifications: [{ id: "unrelated" }] });
  await store.getUnreadNotificationsCount("space");
  expect(store.notifications.unrelated).toBeUndefined();
});

test("expired snoozes return to the inbox", () => {
  const store = new WorkspaceNotificationStore({ router: { workspaceSlug: "space" } } as CoreRootStore);
  store.notificationPollAt = new Date("2026-10-01T00:00:00Z").getTime();
  store.mutateNotifications([
    {
      id: "snoozed",
      workspace: "workspace",
      created_at: "2026-09-30T00:00:00Z",
      snoozed_till: "2026-10-01T01:00:00Z",
    } as TNotification,
  ]);
  expect(store.notificationIdsByWorkspaceId("workspace")).toEqual([]);
  store.notificationPollAt = new Date("2026-10-01T02:00:00Z").getTime();
  expect(store.notificationIdsByWorkspaceId("workspace")).toEqual(["snoozed"]);
});
