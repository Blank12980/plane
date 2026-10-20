/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import useSWR from "swr";
import { Settings2 } from "lucide-react";
// gizmo imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCurrentTask, TCurrentTasksConfig, THomeWidgetProps } from "@plane/types";
import { cn, renderFormattedDate } from "@plane/utils";
// helpers
import { currentTaskKey, currentTaskUrl, resolveCurrentTasksConfig, sortCurrentTasks } from "@/helpers/current-tasks";
// hooks
import { useHome } from "@/hooks/store/use-home";
// services
import { currentTasksService } from "@/services/current-tasks.service";
// local imports
import { CurrentTasksSortSettings } from "./sort-settings";

const PRIORITY_STYLE: Record<string, { label: string; className: string }> = {
  urgent: { label: "Срочный", className: "bg-danger-primary" },
  high: { label: "Высокий", className: "bg-orange-500" },
  medium: { label: "Средний", className: "bg-yellow-500" },
  low: { label: "Низкий", className: "bg-blue-500" },
  none: { label: "Без приоритета", className: "bg-layer-3" },
};

const isDone = (task: TCurrentTask) => task.state_group === "completed" || task.state_group === "cancelled";

function TaskRow({ task, workspaceSlug }: { task: TCurrentTask; workspaceSlug: string }) {
  const priority = PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.none;
  const due = task.deadline_at ?? task.target_date;
  const overdue = !!due && !isDone(task) && new Date(due).getTime() < Date.now();
  return (
    <Link
      href={currentTaskUrl(workspaceSlug, task)}
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-layer-transparent-hover",
        task.is_new && "bg-danger-subtle/40"
      )}
    >
      <span title={priority.label} aria-label={`Приоритет: ${priority.label}`} className="shrink-0">
        <span className={cn("block size-2.5 rounded-full", priority.className)} />
      </span>
      <span className="shrink-0 text-12 text-tertiary">{currentTaskKey(task)}</span>
      <span className={cn("min-w-0 flex-1 truncate text-13 text-primary", isDone(task) && "line-through opacity-60")}>
        {task.name}
      </span>
      {task.is_new && (
        <span className="shrink-0 rounded bg-danger-primary px-1.5 py-0.5 text-11 font-semibold text-white">Новая</span>
      )}
      {task.state_name && (
        <span className="hidden shrink-0 items-center gap-1.5 text-12 text-secondary sm:flex">
          <span className="size-2 rounded-full" style={{ backgroundColor: task.state_color ?? undefined }} />
          {task.state_name}
        </span>
      )}
      {due && (
        <span className={cn("shrink-0 text-12", overdue ? "text-danger-primary" : "text-tertiary")}>
          {renderFormattedDate(due)}
        </span>
      )}
    </Link>
  );
}

/**
 * Tasks assigned to the user. Tasks that were handed over but not opened yet are always first; the rest follow the
 * sort rules the user chose (by default: closest to done first, then by priority).
 */
export const CurrentTasksWidget = observer(function CurrentTasksWidget(props: THomeWidgetProps) {
  const { workspaceSlug } = props;
  const { widgetsMap, updateWidgetConfig } = useHome();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const storedConfig = widgetsMap.current_tasks?.config;
  const config = resolveCurrentTasksConfig(storedConfig);
  const configKey = JSON.stringify(config);

  const { data, error, isLoading, mutate } = useSWR(
    ["CURRENT_TASKS", workspaceSlug, config.show_completed],
    () => currentTasksService.list(workspaceSlug, config.show_completed),
    { refreshInterval: 60_000, revalidateOnFocus: true }
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tasks = useMemo(() => sortCurrentTasks(data?.results ?? [], config), [data, configKey]);
  const visible = isExpanded ? tasks : tasks.slice(0, config.limit);
  const newCount = tasks.filter((task) => task.is_new).length;

  const saveConfig = async (next: TCurrentTasksConfig) => {
    try {
      await updateWidgetConfig(workspaceSlug, "current_tasks", next);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось сохранить настройки списка" });
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-14 font-semibold text-tertiary">
          Текущие задачи
          {newCount > 0 && (
            <span className="rounded-full bg-danger-primary px-2 py-0.5 text-11 font-semibold text-white">
              {newCount} {newCount === 1 ? "новая" : "новых"}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-expanded={isSettingsOpen}
          onClick={() => setIsSettingsOpen((open) => !open)}
          className="flex items-center gap-1 text-13 font-medium text-accent-primary"
        >
          <Settings2 className="size-4" /> Порядок
        </button>
      </div>

      {isSettingsOpen && <CurrentTasksSortSettings config={config} onChange={(next) => void saveConfig(next)} />}

      {isLoading && <p className="py-2 text-13 text-tertiary">Загрузка задач…</p>}
      {error && !data && (
        <p role="alert" className="py-2 text-13 text-danger-primary">
          Не удалось загрузить задачи.{" "}
          <button type="button" className="underline" onClick={() => void mutate()}>
            Повторить
          </button>
        </p>
      )}
      {!isLoading && data && tasks.length === 0 && (
        <p className="rounded-lg bg-layer-1 px-3 py-3 text-13 text-secondary">Вам пока не назначено задач.</p>
      )}
      {visible.length > 0 && (
        <div className="flex flex-col">
          {visible.map((task) => (
            <TaskRow key={task.id} task={task} workspaceSlug={workspaceSlug} />
          ))}
        </div>
      )}
      {tasks.length > config.limit && (
        <button
          type="button"
          className="mt-1 px-2 text-13 font-medium text-accent-primary"
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? "Свернуть" : `Показать все (${tasks.length})`}
        </button>
      )}
    </div>
  );
});
