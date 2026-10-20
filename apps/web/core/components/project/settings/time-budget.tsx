/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Input } from "@plane/ui";
import { convertMinutesToHoursMinutesString } from "@plane/utils";
// services
import type { TProjectTimeBudgetUpdate } from "@/services/project-time-budget.service";
import { projectTimeBudgetService } from "@/services/project-time-budget.service";

type Props = { workspaceSlug: string; projectId: string; disabled?: boolean };

const TOGGLES: { key: "count_module_tasks" | "count_other_tasks" | "include_subtasks"; label: string }[] = [
  { key: "count_module_tasks", label: "Задачи в модулях" },
  { key: "count_other_tasks", label: "Отдельные задачи (не входят ни в один модуль)" },
  { key: "include_subtasks", label: "Подзадачи считаются вместе с родительской задачей" },
];

/**
 * Monthly hour limit of a whole project. The total is made of the work items that live in modules and of the specific
 * work items outside of any module; each part can be switched on or off.
 */
export function ProjectTimeBudget({ workspaceSlug, projectId, disabled }: Props) {
  const [hours, setHours] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR(
    ["PROJECT_TIME_BUDGET", workspaceSlug, projectId],
    () => projectTimeBudgetService.fetchBudget(workspaceSlug, projectId),
    { refreshInterval: 30_000 }
  );
  const value = hours ?? (data?.limit_minutes ? String(data.limit_minutes / 60) : "");

  const save = async (update: TProjectTimeBudgetUpdate, successTitle: string) => {
    setIsSaving(true);
    try {
      await mutate(await projectTimeBudgetService.updateBudget(workspaceSlug, projectId, update), false);
      setToast({ type: TOAST_TYPE.SUCCESS, title: successTitle });
      return true;
    } catch (error) {
      console.error("Unable to save project time budget", error);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось сохранить лимит часов" });
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const saveLimit = async () => {
    const minutes = value.trim() === "" ? null : Math.round(Number(value) * 60);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 2147483647)) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Укажите положительный лимит часов" });
      return;
    }
    if (await save({ limit_minutes: minutes }, minutes === null ? "Лимит отключён" : "Лимит часов сохранён")) {
      setHours(null);
    }
  };

  if (loadError) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить учёт часов
      </p>
    );
  }
  if (!data) return <p className="text-13 text-tertiary">Загрузка часов…</p>;

  return (
    <section className="space-y-4 rounded-lg border border-subtle p-4" aria-label="Месячный лимит часов проекта">
      <p className="text-13 text-secondary">
        Считается всё, что ниже проекта: задачи в модулях и отдельные задачи. Участники проекта и администраторы
        пространства получат одно уведомление за месяц при достижении лимита. Отдельный лимит можно задать и для каждого
        модуля.
      </p>

      <div className="space-y-1">
        <p
          role={data.reached ? "status" : undefined}
          className={data.reached ? "text-14 font-semibold text-danger-primary" : "text-14"}
        >
          {data.month.slice(0, 7)}: {convertMinutesToHoursMinutesString(data.total_minutes)}
          {data.limit_minutes !== null && ` / ${convertMinutesToHoursMinutesString(data.limit_minutes)}`}
          {data.reached && " — лимит достигнут"}
        </p>
        {data.limit_minutes !== null && (
          <progress
            className="w-full"
            aria-label="Использовано часов"
            value={Math.min(data.total_minutes, data.limit_minutes)}
            max={data.limit_minutes}
          />
        )}
        <p className="text-12 text-tertiary">
          В модулях: {convertMinutesToHoursMinutesString(data.module_minutes)} · Отдельные задачи:{" "}
          {convertMinutesToHoursMinutesString(data.other_minutes)}
        </p>
      </div>

      <fieldset className="space-y-2" disabled={disabled || isSaving}>
        <legend className="text-12 font-medium text-secondary">Что входит в лимит</legend>
        {TOGGLES.map((toggle) => (
          <label key={toggle.key} className="flex items-center gap-2 text-13">
            <input
              type="checkbox"
              checked={data[toggle.key]}
              onChange={(event) => void save({ [toggle.key]: event.target.checked }, "Настройка сохранена")}
            />
            {toggle.label}
          </label>
        ))}
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={`project-hours-${projectId}`} className="block text-12 text-secondary">
          Лимит, часов в месяц
        </label>
        <div className="flex max-w-sm items-center gap-2">
          <Input
            id={`project-hours-${projectId}`}
            type="number"
            min="0"
            step="any"
            value={value}
            onChange={(event) => setHours(event.target.value)}
            disabled={disabled || isSaving}
            placeholder="Без лимита"
            className="w-full"
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => void saveLimit()}
            disabled={disabled || isSaving || hours === null}
          >
            Сохранить
          </Button>
        </div>
        <p className="text-11 text-tertiary">Пустое поле отключает лимит.</p>
      </div>
    </section>
  );
}
