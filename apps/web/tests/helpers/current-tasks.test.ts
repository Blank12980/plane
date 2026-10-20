import { expect, test } from "vitest";
import type { TCurrentTask } from "@plane/types";
import {
  DEFAULT_CURRENT_TASKS_SORT,
  currentTaskUrl,
  resolveCurrentTasksConfig,
  sortCurrentTasks,
} from "@/helpers/current-tasks";

const task = (id: string, extra: Partial<TCurrentTask> = {}): TCurrentTask => ({
  id,
  name: id,
  sequence_id: 1,
  project_id: "p",
  project_identifier: "WEB",
  project_name: "Web",
  state_id: null,
  state_name: null,
  state_group: "unstarted",
  state_color: null,
  priority: "none",
  target_date: null,
  deadline_at: null,
  updated_at: "2026-10-01T00:00:00Z",
  assigned_at: "2026-10-01T00:00:00Z",
  is_new: false,
  ...extra,
});
const ids = (tasks: TCurrentTask[]) => tasks.map((item) => item.id);

test("by default tasks are ordered by readiness, then by priority", () => {
  const sorted = sortCurrentTasks([
    task("todo-urgent", { state_group: "unstarted", priority: "urgent" }),
    task("doing-low", { state_group: "started", priority: "low" }),
    task("doing-high", { state_group: "started", priority: "high" }),
    task("backlog-urgent", { state_group: "backlog", priority: "urgent" }),
    task("done-urgent", { state_group: "completed", priority: "urgent" }),
  ]);
  expect(ids(sorted)).toEqual(["doing-high", "doing-low", "todo-urgent", "backlog-urgent", "done-urgent"]);
});

test("assigned but not yet opened tasks are always on top, the newest assignment first", () => {
  const sorted = sortCurrentTasks([
    task("doing-urgent", { state_group: "started", priority: "urgent" }),
    task("new-old", { is_new: true, state_group: "backlog", assigned_at: "2026-10-02T00:00:00Z" }),
    task("new-recent", { is_new: true, state_group: "backlog", assigned_at: "2026-10-05T00:00:00Z" }),
  ]);
  expect(ids(sorted)).toEqual(["new-recent", "new-old", "doing-urgent"]);
  // also when the user sorts completely differently
  const custom = sortCurrentTasks(sorted, { sort: [{ field: "project", direction: "desc" }] });
  expect(ids(custom).slice(0, 2)).toEqual(["new-recent", "new-old"]);
});

test("the order and the direction of the criteria are configurable", () => {
  const tasks = [
    task("a", { state_group: "started", priority: "low" }),
    task("b", { state_group: "unstarted", priority: "urgent" }),
    task("c", { state_group: "started", priority: "urgent" }),
  ];
  const priorityFirst = {
    sort: [
      { field: "priority", direction: "asc" },
      { field: "readiness", direction: "asc" },
    ],
  } as const;
  const reversed = {
    sort: [
      { field: "readiness", direction: "desc" },
      { field: "priority", direction: "desc" },
    ],
  } as const;
  expect(ids(sortCurrentTasks(tasks, { sort: [...priorityFirst.sort] }))).toEqual(["c", "b", "a"]);
  expect(ids(sortCurrentTasks(tasks, { sort: [...reversed.sort] }))).toEqual(["b", "a", "c"]);
});

test("tasks without a deadline go last whichever direction is chosen", () => {
  const tasks = [
    task("none"),
    task("late", { target_date: "2026-12-01" }),
    task("soon", { deadline_at: "2026-10-21T10:00:00Z" }),
  ];
  expect(ids(sortCurrentTasks(tasks, { sort: [{ field: "due_date", direction: "asc" }] }))).toEqual([
    "soon",
    "late",
    "none",
  ]);
  expect(ids(sortCurrentTasks(tasks, { sort: [{ field: "due_date", direction: "desc" }] }))).toEqual([
    "late",
    "soon",
    "none",
  ]);
});

test("ties fall back to the most recently updated task and the input is not mutated", () => {
  const tasks = [
    task("old", { updated_at: "2026-10-01T00:00:00Z" }),
    task("fresh", { updated_at: "2026-10-09T00:00:00Z" }),
  ];
  const before = ids(tasks);
  expect(ids(sortCurrentTasks(tasks))).toEqual(["fresh", "old"]);
  expect(ids(tasks)).toEqual(before);
});

test("settings fall back to the defaults, invalid and repeated rules are dropped", () => {
  expect(resolveCurrentTasksConfig(undefined)).toEqual({
    sort: DEFAULT_CURRENT_TASKS_SORT,
    show_completed: false,
    limit: 10,
  });
  expect(resolveCurrentTasksConfig({ sort: [] }).sort).toEqual([]);
  expect(
    resolveCurrentTasksConfig({
      sort: [
        { field: "priority", direction: "desc" },
        { field: "priority", direction: "asc" },
        { field: "nope" as never, direction: "asc" },
      ],
      limit: 20,
      show_completed: true,
    })
  ).toEqual({ sort: [{ field: "priority", direction: "desc" }], show_completed: true, limit: 20 });
});

test("a task links to its work item", () => {
  expect(currentTaskUrl("space", task("x", { sequence_id: 12 }))).toBe("/space/browse/WEB-12/");
});
