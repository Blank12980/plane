import type { TCurrentTask, TCurrentTaskSortField, TCurrentTaskSortRule, TCurrentTasksConfig } from "@plane/types";

export const CURRENT_TASKS_DEFAULT_LIMIT = 10;
export const CURRENT_TASKS_LIMITS = [5, 10, 20, 50] as const;

/** Tasks that are closest to being finished first, then by priority. */
export const DEFAULT_CURRENT_TASKS_SORT: TCurrentTaskSortRule[] = [
  { field: "readiness", direction: "asc" },
  { field: "priority", direction: "asc" },
];

export const CURRENT_TASKS_SORT_FIELDS: TCurrentTaskSortField[] = [
  "readiness",
  "priority",
  "due_date",
  "updated_at",
  "project",
];

/** What a field means and how each direction reads. */
export const CURRENT_TASKS_SORT_LABELS: Record<TCurrentTaskSortField, { title: string; asc: string; desc: string }> = {
  readiness: { title: "Готовность", asc: "сначала в работе", desc: "сначала не начатые" },
  priority: { title: "Приоритет", asc: "сначала срочные", desc: "сначала низкие" },
  due_date: { title: "Срок", asc: "сначала ближайшие", desc: "сначала дальние" },
  updated_at: { title: "Обновление", asc: "сначала давние", desc: "сначала свежие" },
  project: { title: "Проект", asc: "А → Я", desc: "Я → А" },
};

// smaller = closer to being done
const READINESS_RANK: Record<string, number> = { started: 0, unstarted: 1, backlog: 2, completed: 3, cancelled: 4 };
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export type TResolvedCurrentTasksConfig = {
  sort: TCurrentTaskSortRule[];
  show_completed: boolean;
  limit: number;
};

export function resolveCurrentTasksConfig(config?: TCurrentTasksConfig | null): TResolvedCurrentTasksConfig {
  const sort = (config?.sort ?? []).filter(
    (rule, index, rules) =>
      CURRENT_TASKS_SORT_FIELDS.includes(rule.field) && rules.findIndex((item) => item.field === rule.field) === index
  );
  return {
    // an explicitly emptied list is a valid choice ("just the newest first"); only a missing one gets the default
    sort: config?.sort ? sort : DEFAULT_CURRENT_TASKS_SORT,
    show_completed: config?.show_completed ?? false,
    limit: config?.limit ?? CURRENT_TASKS_DEFAULT_LIMIT,
  };
}

const dueTime = (task: TCurrentTask): number | undefined => {
  const value = task.deadline_at ?? task.target_date;
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
};

function compareField(field: TCurrentTaskSortField, a: TCurrentTask, b: TCurrentTask): number {
  switch (field) {
    case "readiness":
      return (READINESS_RANK[a.state_group ?? ""] ?? 9) - (READINESS_RANK[b.state_group ?? ""] ?? 9);
    case "priority":
      return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    case "updated_at":
      return a.updated_at.localeCompare(b.updated_at);
    case "project":
      return a.project_name.localeCompare(b.project_name, "ru");
    case "due_date": {
      // no deadline sorts last in both directions: it is handled by the caller
      return (dueTime(a) ?? 0) - (dueTime(b) ?? 0);
    }
  }
}

/**
 * New tasks (assigned, not opened yet) always come first, newest assignment on top. The rest follow the user's rules
 * in order; ties fall back to the most recently updated task so the order is stable.
 */
export function sortCurrentTasks(tasks: TCurrentTask[], config?: TCurrentTasksConfig | null): TCurrentTask[] {
  const { sort } = resolveCurrentTasksConfig(config);
  // a copy is sorted: the caller's list stays untouched
  // eslint-disable-next-line unicorn/no-array-sort
  return [...tasks].sort((a, b) => {
    if (a.is_new !== b.is_new) return a.is_new ? -1 : 1;
    if (a.is_new && b.is_new) {
      const byAssignment = (b.assigned_at ?? "").localeCompare(a.assigned_at ?? "");
      if (byAssignment !== 0) return byAssignment;
    }
    for (const rule of sort) {
      let result: number;
      if (rule.field === "due_date") {
        const first = dueTime(a);
        const second = dueTime(b);
        if (first === undefined && second === undefined) continue;
        if (first === undefined) return 1;
        if (second === undefined) return -1;
        result = first - second;
      } else {
        result = compareField(rule.field, a, b);
      }
      if (result !== 0) return rule.direction === "asc" ? result : -result;
    }
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export const currentTaskKey = (task: Pick<TCurrentTask, "project_identifier" | "sequence_id">) =>
  `${task.project_identifier}-${task.sequence_id}`;

export const currentTaskUrl = (workspaceSlug: string, task: Pick<TCurrentTask, "project_identifier" | "sequence_id">) =>
  `/${workspaceSlug}/browse/${currentTaskKey(task)}/`;
