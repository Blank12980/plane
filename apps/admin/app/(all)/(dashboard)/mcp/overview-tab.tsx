/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Copy } from "lucide-react";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { McpService } from "@plane/services";
import type { TMcpPolicy } from "@plane/types";
import { Loader, ToggleSwitch } from "@plane/ui";
import { MCP_SCOPES, cn } from "@plane/utils";

const mcpService = new McpService();

type TDraft = Pick<
  TMcpPolicy,
  | "allow_user_tokens"
  | "allow_all_workspaces"
  | "allow_oauth"
  | "allowed_scopes"
  | "max_token_days"
  | "default_rate_limit"
>;

const pickDraft = (policy: TMcpPolicy): TDraft => ({
  allow_user_tokens: policy.allow_user_tokens,
  allow_all_workspaces: policy.allow_all_workspaces,
  allow_oauth: policy.allow_oauth,
  allowed_scopes: policy.allowed_scopes,
  max_token_days: policy.max_token_days,
  default_rate_limit: policy.default_rate_limit,
});

const errorMessage = (error: unknown): string => {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    const first = Object.values(record).flat()[0];
    if (typeof first === "string") return first;
  }
  return "Попробуйте ещё раз.";
};

export function McpOverviewTab() {
  const { data, error, isLoading, mutate } = useSWR("MCP_OVERVIEW", () => mcpService.adminOverview(), {
    refreshInterval: 30_000,
  });
  const [draft, setDraft] = useState<TDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // the form is (re)filled from the server until the administrator starts editing
  useEffect(() => {
    if (data && draft === null) setDraft(pickDraft(data.settings));
  }, [data, draft]);

  const save = async (patch: Partial<TMcpPolicy>, success: string) => {
    setIsSaving(true);
    try {
      const updated = await mcpService.adminUpdateSettings(patch);
      await mutate(updated, false);
      setDraft(pickDraft(updated.settings));
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Готово", message: success });
    } catch (saveError) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось сохранить", message: errorMessage(saveError) });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !data || !draft) {
    return error ? (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить настройки MCP.
      </p>
    ) : (
      <Loader className="space-y-3">
        <Loader.Item height="80px" />
        <Loader.Item height="160px" />
      </Loader>
    );
  }

  const { settings, stats, health, endpoint } = data;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(pickDraft(settings));
  const toggleScope = (scope: string) => {
    const next = draft.allowed_scopes.includes(scope)
      ? draft.allowed_scopes.filter((item) => item !== scope)
      : [...draft.allowed_scopes, scope];
    setDraft({ ...draft, allowed_scopes: next });
  };

  return (
    <div className="space-y-8">
      {/* status + master switch */}
      <section className="space-y-4 rounded-md border border-subtle p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-14 font-medium text-primary">
              MCP-сервер
              <span
                className={cn("rounded-full px-2 py-0.5 text-11", {
                  "bg-success-subtle text-success-primary": health.status === "ok" && settings.enabled,
                  "bg-danger-subtle text-danger-primary": health.status !== "ok",
                  "bg-layer-2 text-tertiary": health.status === "ok" && !settings.enabled,
                })}
              >
                {health.status !== "ok" ? "контейнер недоступен" : settings.enabled ? "включён" : "выключен"}
              </span>
              {health.version && <span className="text-12 text-tertiary">v{health.version}</span>}
            </div>
            <p className="mt-1 text-13 text-secondary">
              {settings.enabled
                ? "Агенты могут подключаться. Выключение мгновенно блокирует все MCP-токены и MCP-сервер на стороне API."
                : "MCP выключен: API отклоняет все запросы по MCP-токенам и от MCP-сервера. Обычные API-токены работают."}
            </p>
          </div>
          <ToggleSwitch
            value={settings.enabled}
            size="sm"
            onChange={() =>
              void save({ enabled: !settings.enabled }, settings.enabled ? "MCP выключен." : "MCP включён.")
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-13">
          <span className="text-tertiary">Адрес для подключения:</span>
          <code className="rounded bg-layer-1 px-2 py-1 text-primary">{endpoint}</code>
          <button
            type="button"
            className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
            title="Скопировать"
            onClick={() => {
              void navigator.clipboard.writeText(endpoint);
              setToast({ type: TOAST_TYPE.SUCCESS, title: "Адрес скопирован" });
            }}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* usage */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Токенов всего", value: stats.tokens_total },
          { label: "Активных токенов", value: stats.tokens_active },
          { label: "Подключений OAuth", value: stats.oauth_connections },
          { label: "Использовались за 24 ч", value: stats.tokens_used_24h },
          {
            label: "Вызовов за 24 ч",
            value: `${stats.calls_24h}${stats.calls_24h_truncated ? "+" : ""}`,
            hint: stats.errors_24h > 0 ? `${stats.errors_24h} с ошибкой` : undefined,
          },
        ].map((tile) => (
          <div key={tile.label} className="rounded-md border border-subtle p-3">
            <div className="text-20 font-semibold text-primary">{tile.value}</div>
            <div className="text-12 text-tertiary">{tile.label}</div>
            {tile.hint && <div className="text-12 text-danger-primary">{tile.hint}</div>}
          </div>
        ))}
        {stats.top_tools.length > 0 && (
          <div className="col-span-2 rounded-md border border-subtle p-3 md:col-span-5">
            <div className="mb-1 text-12 text-tertiary">Чаще всего вызывают (за 24 ч)</div>
            <div className="flex flex-wrap gap-2 text-13">
              {stats.top_tools.map((item) => (
                <span key={item.tool} className="rounded bg-layer-1 px-2 py-1">
                  {item.tool} · {item.calls}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* policy */}
      <section className="space-y-5 rounded-md border border-subtle p-4">
        <div>
          <h3 className="text-14 font-medium text-primary">Правила для токенов пользователей</h3>
          <p className="text-13 text-secondary">
            Применяются, когда пользователь сам создаёт MCP-токен в настройках профиля. Токены, созданные
            администратором командой <code>create_agent_token</code>, этими правилами не ограничиваются.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 text-13">
          <span>
            <span className="block font-medium text-primary">Разрешить пользователям создавать токены</span>
            <span className="text-secondary">
              Если выключено, подключить агента смогут только по токену от администратора.
            </span>
          </span>
          <ToggleSwitch
            value={draft.allow_user_tokens}
            size="sm"
            onChange={() => setDraft({ ...draft, allow_user_tokens: !draft.allow_user_tokens })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 text-13">
          <span>
            <span className="block font-medium text-primary">Разрешить один токен для всех пространств</span>
            <span className="text-secondary">
              Пользователь сможет создать токен, который работает во всех его пространствах сразу, включая те, куда его
              добавят позже. Если выключено, токен привязывается к одному пространству.
            </span>
          </span>
          <ToggleSwitch
            value={draft.allow_all_workspaces}
            size="sm"
            onChange={() => setDraft({ ...draft, allow_all_workspaces: !draft.allow_all_workspaces })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 text-13">
          <span>
            <span className="block font-medium text-primary">Разрешить подключение через OAuth (ChatGPT и др.)</span>
            <span className="text-secondary">
              Приложения (ChatGPT, Claude, Cursor, VS Code) сами регистрируются, а пользователь входит в Gizmo и
              выбирает права и пространства на экране согласия; токен вручную создавать не нужно. Права, срок
              (refresh-токен) и лимит запросов берутся из правил ниже. Выключение мгновенно закрывает все такие
              подключения.
            </span>
          </span>
          <ToggleSwitch
            value={draft.allow_oauth}
            size="sm"
            onChange={() => setDraft({ ...draft, allow_oauth: !draft.allow_oauth })}
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-13 font-medium text-primary">Разрешённые права токена</legend>
          <p className="text-12 text-secondary">
            Пользователь сможет выбрать только отмеченные права. Право «Чтение» обязательно.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {MCP_SCOPES.map((item) => (
              <label key={item.scope} className="flex items-start gap-2 rounded border border-subtle p-2 text-13">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.allowed_scopes.includes(item.scope)}
                  disabled={item.scope === "read"}
                  onChange={() => toggleScope(item.scope)}
                />
                <span>
                  <span className="font-medium text-primary">{item.title}</span>{" "}
                  <code className="text-11 text-tertiary">{item.scope}</code>
                  <span className="block text-12 text-secondary">{item.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-13">
            <span className="block font-medium text-primary">Максимальный срок токена, дней</span>
            <input
              type="number"
              min={0}
              max={3650}
              value={draft.max_token_days}
              onChange={(event) => setDraft({ ...draft, max_token_days: Number(event.target.value) })}
              className="w-full rounded border border-subtle bg-surface-1 p-2"
            />
            <span className="block text-12 text-secondary">
              0 — без ограничения. Без срока токен получит этот максимум.
            </span>
          </label>
          <label className="space-y-1 text-13">
            <span className="block font-medium text-primary">Лимит запросов токена</span>
            <input
              type="text"
              value={draft.default_rate_limit}
              onChange={(event) => setDraft({ ...draft, default_rate_limit: event.target.value })}
              className="w-full rounded border border-subtle bg-surface-1 p-2"
              placeholder="120/min"
            />
            <span className="block text-12 text-secondary">Формат: 60/min, 10/s, 1000/hour.</span>
          </label>
        </div>

        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!isDirty || isSaving}
            loading={isSaving}
            onClick={() => void save(draft, "Правила сохранены.")}
          >
            Сохранить правила
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!isDirty || isSaving}
            onClick={() => setDraft(pickDraft(settings))}
          >
            Отменить
          </Button>
        </div>
      </section>
    </div>
  );
}
