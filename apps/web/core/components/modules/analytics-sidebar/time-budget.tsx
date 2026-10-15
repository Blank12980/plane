import { useState } from "react";
import useSWR from "swr";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Input } from "@plane/ui";
import { convertMinutesToHoursMinutesString } from "@plane/utils";
import { moduleTimeBudgetService } from "@/services/module-time-budget.service";

type Props = { workspaceSlug: string; projectId: string; moduleId: string; disabled?: boolean };

export function ModuleTimeBudget({ workspaceSlug, projectId, moduleId, disabled }: Props) {
  const [hours, setHours] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const {
    data,
    error: loadError,
    mutate,
  } = useSWR(
    ["MODULE_TIME_BUDGET", workspaceSlug, projectId, moduleId],
    () => moduleTimeBudgetService.fetchBudget(workspaceSlug, projectId, moduleId),
    { refreshInterval: 30_000 }
  );
  const value = hours ?? (data?.limit_minutes ? String(data.limit_minutes / 60) : "");
  const save = async () => {
    const minutes = value.trim() === "" ? null : Math.round(Number(value) * 60);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 2147483647)) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Укажите положительный лимит часов" });
      return;
    }
    setIsSaving(true);
    try {
      await mutate(await moduleTimeBudgetService.updateBudget(workspaceSlug, projectId, moduleId, minutes), false);
      setHours(null);
      setToast({ type: TOAST_TYPE.SUCCESS, title: minutes === null ? "Лимит отключён" : "Лимит часов сохранён" });
    } catch (error) {
      console.error("Unable to save module time budget", error);
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось сохранить лимит часов" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="my-4 space-y-2 rounded-lg border border-subtle p-3" aria-label="Месячный лимит часов">
      <h5 className="text-14 font-medium">Месячный лимит часов</h5>
      <p className="text-12 text-secondary">Сумма записей времени по всем задачам модуля за календарный месяц.</p>
      {loadError ? (
        <p role="alert" className="text-12 text-danger-primary">
          Не удалось загрузить учёт часов
        </p>
      ) : data ? (
        <>
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
          <label htmlFor={`module-hours-${moduleId}`} className="block text-12 text-secondary">
            Лимит, часов в месяц
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`module-hours-${moduleId}`}
              type="number"
              min="0"
              step="any"
              value={value}
              onChange={(event) => setHours(event.target.value)}
              disabled={disabled || isSaving}
              placeholder="Без лимита"
              className="w-full"
            />
            <Button size="sm" variant="primary" onClick={save} disabled={disabled || isSaving || hours === null}>
              Сохранить
            </Button>
          </div>
          <p className="text-11 text-tertiary">
            Пустое поле отключает лимит. Участники проекта получат одно уведомление за месяц при достижении лимита.
          </p>
        </>
      ) : (
        <p className="text-12 text-tertiary">Загрузка часов…</p>
      )}
    </section>
  );
}
