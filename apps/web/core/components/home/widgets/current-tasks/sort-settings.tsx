/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { orderBy } from "lodash-es";
import { ArrowDown, ArrowUp, X } from "lucide-react";
// gizmo imports
import { Button } from "@plane/propel/button";
import type { TCurrentTaskSortField, TCurrentTaskSortRule, TCurrentTasksConfig } from "@plane/types";
// helpers
import {
  CURRENT_TASKS_LIMITS,
  CURRENT_TASKS_SORT_FIELDS,
  CURRENT_TASKS_SORT_LABELS,
  DEFAULT_CURRENT_TASKS_SORT,
} from "@/helpers/current-tasks";
import type { TResolvedCurrentTasksConfig } from "@/helpers/current-tasks";

type Props = {
  config: TResolvedCurrentTasksConfig;
  onChange: (config: TCurrentTasksConfig) => void;
};

const selectClass = "rounded border border-subtle bg-surface-1 px-2 py-1 text-13";

/** Lets the user choose by what and in which order the current tasks are sorted. New tasks always stay on top. */
export function CurrentTasksSortSettings({ config, onChange }: Props) {
  const { sort } = config;
  const update = (patch: Partial<TCurrentTasksConfig>) =>
    onChange({ sort: config.sort, show_completed: config.show_completed, limit: config.limit, ...patch });

  const replaceRule = (index: number, rule: TCurrentTaskSortRule) =>
    update({ sort: sort.map((item, position) => (position === index ? rule : item)) });
  const moveRule = (index: number, offset: -1 | 1) => {
    const next = [...sort];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update({ sort: next });
  };
  const unusedFields = CURRENT_TASKS_SORT_FIELDS.filter((field) => !sort.some((rule) => rule.field === field));

  return (
    <div className="mb-3 space-y-3 rounded-lg border border-subtle bg-surface-1 p-3" aria-label="Настройки сортировки">
      <div>
        <p className="text-13 font-medium text-primary">Порядок задач</p>
        <p className="text-12 text-tertiary">
          Сверху всегда идут новые задачи: назначенные вам, но ещё не открытые. Остальные упорядочиваются по критериям
          ниже: следующий критерий применяется, когда предыдущие совпали.
        </p>
      </div>

      <ol className="space-y-2">
        {sort.map((rule, index) => (
          <li key={rule.field} className="flex flex-wrap items-center gap-2">
            <span className="w-4 text-12 text-tertiary">{index + 1}.</span>
            <select
              aria-label={`Критерий ${index + 1}`}
              className={selectClass}
              value={rule.field}
              onChange={(event) => replaceRule(index, { ...rule, field: event.target.value as TCurrentTaskSortField })}
            >
              {[rule.field, ...unusedFields].map((field) => (
                <option key={field} value={field}>
                  {CURRENT_TASKS_SORT_LABELS[field].title}
                </option>
              ))}
            </select>
            <select
              aria-label={`Направление ${index + 1}`}
              className={selectClass}
              value={rule.direction}
              onChange={(event) => replaceRule(index, { ...rule, direction: event.target.value as "asc" | "desc" })}
            >
              <option value="asc">{CURRENT_TASKS_SORT_LABELS[rule.field].asc}</option>
              <option value="desc">{CURRENT_TASKS_SORT_LABELS[rule.field].desc}</option>
            </select>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                title="Выше"
                disabled={index === 0}
                className="rounded p-1 text-tertiary hover:bg-layer-1-hover disabled:opacity-30"
                onClick={() => moveRule(index, -1)}
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                title="Ниже"
                disabled={index === sort.length - 1}
                className="rounded p-1 text-tertiary hover:bg-layer-1-hover disabled:opacity-30"
                onClick={() => moveRule(index, 1)}
              >
                <ArrowDown className="size-3.5" />
              </button>
              <button
                type="button"
                title="Убрать критерий"
                className="rounded p-1 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"
                onClick={() => update({ sort: sort.filter((_, position) => position !== index) })}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
        {sort.length === 0 && (
          <li className="text-12 text-tertiary">Без критериев: после новых идут недавно обновлённые задачи.</li>
        )}
      </ol>

      {unusedFields.length > 0 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => update({ sort: [...sort, { field: unusedFields[0], direction: "asc" }] })}
        >
          Добавить критерий
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-subtle pt-3 text-13">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.show_completed}
            onChange={(event) => update({ show_completed: event.target.checked })}
          />
          Показывать завершённые
        </label>
        <label className="flex items-center gap-2">
          Сначала показывать
          <select
            aria-label="Сколько задач показывать"
            className={selectClass}
            value={config.limit}
            onChange={(event) => update({ limit: Number(event.target.value) })}
          >
            {orderBy([...new Set([...CURRENT_TASKS_LIMITS, config.limit])]).map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => update({ sort: DEFAULT_CURRENT_TASKS_SORT, show_completed: false, limit: 10 })}
        >
          Сбросить
        </Button>
      </div>
    </div>
  );
}
