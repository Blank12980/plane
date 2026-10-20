import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TNotification } from "@plane/types";
import { NotificationBell } from "@/components/workspace-notifications/notification-bell";

const { store, markAllUnreadAsRead, getUnread, toast } = vi.hoisted(() => ({
  store: {
    unreadNotificationsCount: {
      total_unread_notifications_count: 0,
      mention_unread_notifications_count: 0,
      recent_notifications: [] as unknown[],
    },
  },
  markAllUnreadAsRead: vi.fn(),
  getUnread: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceSlug: "space" }),
  usePathname: () => "/space/",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));
vi.mock("@/hooks/store/notifications", () => ({
  useWorkspaceNotifications: () => ({
    unreadNotificationsCount: store.unreadNotificationsCount,
    getUnreadNotificationsCount: getUnread,
    markAllUnreadAsRead,
  }),
}));
vi.mock("@/hooks/store/user", () => ({ useUser: () => ({ data: { id: "user" } }) }));
vi.mock("@/hooks/use-notification-alerts", () => ({ useNotificationAlerts: () => undefined }));
vi.mock("@/components/sidebar/sidebar-item", () => ({
  AppSidebarItem: ({ item }: { item: { icon: React.ReactNode } }) => <div>{item.icon}</div>,
}));
vi.mock("@plane/propel/icons", () => ({ InboxIcon: () => <svg data-testid="inbox" /> }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

const task = (id: string, extra: Partial<TNotification> = {}) =>
  ({
    id,
    entity_name: "issue",
    created_at: "2026-10-18T10:00:00Z",
    read_at: undefined,
    data: { issue: { id: "i", identifier: "WEB", sequence_id: 7, name: "Новая задача" } },
    triggered_by_details: { display_name: "Анна" },
    ...extra,
  }) as TNotification;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  markAllUnreadAsRead.mockResolvedValue(undefined);
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 0,
    mention_unread_notifications_count: 0,
    recent_notifications: [],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<NotificationBell />));
}
async function hover() {
  await act(async () => {
    container.firstElementChild!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    container.firstElementChild!.dispatchEvent(new MouseEvent("mouseenter"));
    // React listens to mouseover for onMouseEnter
    vi.advanceTimersByTime(300);
  });
}

test("no unread: no alert badge, explains there are no new tasks and the button is disabled", async () => {
  await render();
  expect(container.querySelector("[data-testid=notification-alert]")).toBeNull();
  await hover();
  expect(container.textContent).toContain("У вас нет новых задач");
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Отметить прочитанным")!;
  expect(button.disabled).toBe(true);
});

test("unread tasks: red exclamation badge, task list and an enabled mark-as-read button", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 2,
    mention_unread_notifications_count: 0,
    recent_notifications: [task("a"), task("b", { created_at: "2026-10-18T11:00:00Z" })],
  };
  await render();
  const badge = container.querySelector("[data-testid=notification-alert]")!;
  expect(badge.textContent).toBe("!");
  await hover();
  expect(container.textContent).toContain("WEB-7 Новая задача");
  expect(container.querySelectorAll("li")).toHaveLength(2);
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Отметить прочитанным")!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(markAllUnreadAsRead).toHaveBeenCalledWith("space");
});

test("read and archived notifications are not listed as new tasks", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 1,
    mention_unread_notifications_count: 0,
    recent_notifications: [task("read", { read_at: "2026-10-18T12:00:00Z" }), task("archived", { archived_at: "x" })],
  };
  await render();
  await hover();
  expect(container.querySelectorAll("li")).toHaveLength(0);
});
