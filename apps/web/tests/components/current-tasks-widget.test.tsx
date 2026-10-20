import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import type { TCurrentTask, TCurrentTasksConfig } from "@plane/types";
import { CurrentTasksWidget } from "@/components/home/widgets/current-tasks";

const { widgets, updateWidgetConfig, list, toast } = vi.hoisted(() => ({
  widgets: { current_tasks: { config: undefined as TCurrentTasksConfig | undefined } },
  updateWidgetConfig: vi.fn(),
  list: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/store/use-home", () => ({ useHome: () => ({ widgetsMap: widgets, updateWidgetConfig }) }));
vi.mock("@/services/current-tasks.service", () => ({ currentTasksService: { list } }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const task = (id: string, extra: Partial<TCurrentTask> = {}): TCurrentTask => ({
  id,
  name: `Задача ${id}`,
  sequence_id: 1,
  project_id: "p",
  project_identifier: "WEB",
  project_name: "Web",
  state_id: null,
  state_name: "В работе",
  state_group: "started",
  state_color: "#ff0000",
  priority: "medium",
  target_date: null,
  deadline_at: null,
  updated_at: "2026-10-01T00:00:00Z",
  assigned_at: "2026-10-01T00:00:00Z",
  is_new: false,
  ...extra,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  widgets.current_tasks.config = undefined;
  updateWidgetConfig.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CurrentTasksWidget workspaceSlug="space" />
      </SWRConfig>
    )
  );
}
const rows = () => [...container.querySelectorAll("a")].map((link) => link.textContent ?? "");
const buttonByText = (text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));

test("new tasks come first with a badge, the rest follows readiness and then priority", async () => {
  list.mockResolvedValue({
    results: [
      task("todo", { state_group: "unstarted", priority: "urgent" }),
      task("doing-low", { priority: "low" }),
      task("fresh", { is_new: true, state_group: "backlog" }),
      task("doing-high", { priority: "high" }),
    ],
    has_more: false,
    new_count: 1,
  });
  await render();
  const texts = rows();
  expect(texts.map((text) => text.match(/Задача [\w-]+/)?.[0])).toEqual([
    "Задача fresh",
    "Задача doing-high",
    "Задача doing-low",
    "Задача todo",
  ]);
  expect(texts[0]).toContain("Новая");
  expect(container.textContent).toContain("1 новая");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/space/browse/WEB-1/");
});

test("the user's own sort rules are applied and can be changed", async () => {
  widgets.current_tasks.config = { sort: [{ field: "priority", direction: "asc" }] };
  list.mockResolvedValue({
    results: [
      task("doing-low", { priority: "low" }),
      task("todo-urgent", { state_group: "unstarted", priority: "urgent" }),
    ],
    has_more: false,
    new_count: 0,
  });
  await render();
  expect(rows()[0]).toContain("todo-urgent");

  await act(async () => buttonByText("Порядок")!.click());
  const direction = container.querySelector<HTMLSelectElement>("select[aria-label='Направление 1']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(direction, "desc");
    direction.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(updateWidgetConfig).toHaveBeenCalledWith(
    "space",
    "current_tasks",
    expect.objectContaining({ sort: [{ field: "priority", direction: "desc" }] })
  );
});

test("completed tasks are requested only when the user asks for them", async () => {
  list.mockResolvedValue({ results: [], has_more: false, new_count: 0 });
  await render();
  expect(list).toHaveBeenCalledWith("space", false);
  expect(container.textContent).toContain("Вам пока не назначено задач");

  widgets.current_tasks.config = { show_completed: true };
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(list).toHaveBeenLastCalledWith("space", true);
});

test("only the configured number of tasks is shown until the list is expanded", async () => {
  widgets.current_tasks.config = { limit: 3 };
  list.mockResolvedValue({
    results: Array.from({ length: 5 }, (_, index) => task(`t${index}`, { priority: "low" })),
    has_more: false,
    new_count: 0,
  });
  await render();
  expect(rows()).toHaveLength(3);
  await act(async () => buttonByText("Показать все (5)")!.click());
  expect(rows()).toHaveLength(5);
});
