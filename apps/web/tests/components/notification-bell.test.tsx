import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TCurrentTask, TNotification } from "@plane/types";
import { NotificationBell } from "@/components/workspace-notifications/notification-bell";

const { store, markAllUnreadAsRead, getUnread, toast } = vi.hoisted(() => ({
  store: {
    unreadNotificationsCount: {
      total_unread_notifications_count: 0,
      mention_unread_notifications_count: 0,
      recent_notifications: [] as unknown[],
      new_tasks: [] as unknown[],
      new_tasks_count: 0,
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
    new_tasks: [],
    new_tasks_count: 0,
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

const newTask = (id: string, extra: Partial<TCurrentTask> = {}) =>
  ({
    id,
    name: `Задача ${id}`,
    sequence_id: 7,
    project_identifier: "WEB",
    state_name: "К выполнению",
    assigned_at: "2026-10-18T10:00:00Z",
    is_new: true,
    ...extra,
  }) as TCurrentTask;

const markButton = () =>
  [...container.querySelectorAll("button")].find((item) => item.textContent === "Отметить прочитанным")!;

test("nothing unread: neither exclamation mark nor dot, explains there are no new tasks, button disabled", async () => {
  await render();
  expect(container.querySelector("[data-testid=notification-alert]")).toBeNull();
  expect(container.querySelector("[data-testid=notification-dot]")).toBeNull();
  await hover();
  expect(container.textContent).toContain("У вас нет новых задач");
  expect(markButton().disabled).toBe(true);
});

test("new assigned tasks: the big red exclamation mark, listed under the title, button enabled", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 1,
    mention_unread_notifications_count: 0,
    recent_notifications: [],
    new_tasks: [newTask("a"), newTask("b")],
    new_tasks_count: 2,
  };
  await render();
  expect(container.querySelector("[data-testid=notification-alert]")?.textContent).toBe("!");
  expect(container.querySelector("[data-testid=notification-dot]")).toBeNull();
  await hover();
  expect(container.textContent).toContain("Новые задачи");
  expect(container.textContent).toContain("WEB-7 Задача a");
  expect(container.querySelectorAll("[aria-label='Новые задачи'] li")).toHaveLength(2);
  expect(markButton().disabled).toBe(false);
  await act(async () => markButton().click());
  expect(markAllUnreadAsRead).toHaveBeenCalledWith("space");
});

test("other unread notifications without new tasks: the plain red dot, not the exclamation mark", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 2,
    mention_unread_notifications_count: 0,
    recent_notifications: [task("a"), task("b", { created_at: "2026-10-18T11:00:00Z" })],
    new_tasks: [],
    new_tasks_count: 0,
  };
  await render();
  expect(container.querySelector("[data-testid=notification-alert]")).toBeNull();
  expect(container.querySelector("[data-testid=notification-dot]")).not.toBeNull();
  await hover();
  expect(container.textContent).toContain("У вас нет новых задач");
  expect(container.querySelectorAll("[aria-label='Непрочитанные уведомления'] li")).toHaveLength(2);
  expect(markButton().disabled).toBe(false);
});

test("the notification about an assignment is not listed twice next to the new task", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 2,
    mention_unread_notifications_count: 0,
    recent_notifications: [
      task("assigned", {
        data: { issue: { id: "t1", identifier: "WEB", sequence_id: 7, name: "Задача t1" } } as never,
      }),
      task("comment"),
    ],
    new_tasks: [newTask("t1")],
    new_tasks_count: 1,
  };
  await render();
  await hover();
  expect(container.querySelectorAll("[aria-label='Новые задачи'] li")).toHaveLength(1);
  expect(container.querySelectorAll("[aria-label='Непрочитанные уведомления'] li")).toHaveLength(1);
});

test("read and archived notifications are not listed", async () => {
  store.unreadNotificationsCount = {
    total_unread_notifications_count: 1,
    mention_unread_notifications_count: 0,
    recent_notifications: [task("read", { read_at: "2026-10-18T12:00:00Z" }), task("archived", { archived_at: "x" })],
    new_tasks: [],
    new_tasks_count: 0,
  };
  await render();
  await hover();
  expect(container.querySelectorAll("li")).toHaveLength(0);
});
