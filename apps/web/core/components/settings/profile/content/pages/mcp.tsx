/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { observer } from "mobx-react";
import useSWR from "swr";
// gizmo imports
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { McpService } from "@plane/services";
import type { TMcpToken, TMcpTokenCreated } from "@plane/types";
import {
  MCP_SAFETY_RULES,
  MCP_SCOPES,
  MCP_SCOPE_PRESETS,
  MCP_TOOL_GROUPS,
  buildMcpClientConfigs,
  cn,
} from "@plane/utils";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";

const mcpService = new McpService();

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("ru-RU") : "—");

const errorText = (error: unknown): string => {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    const first = Object.values(record).flat()[0];
    if (typeof first === "string") return first;
  }
  return "Попробуйте ещё раз.";
};

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-layer-1 p-3 text-12 text-primary">{code}</pre>
      <button
        type="button"
        className="absolute top-2 right-2 rounded bg-surface-1 px-2 py-1 text-12 text-secondary hover:text-primary"
        onClick={() => {
          void navigator.clipboard.writeText(code);
          setToast({ type: TOAST_TYPE.SUCCESS, title: "Скопировано" });
        }}
      >
        Копировать
      </button>
    </div>
  );
}

function ClientConfigs({
  endpoint,
  token,
  workspaceSlug,
}: {
  endpoint: string;
  token?: string;
  workspaceSlug?: string;
}) {
  const configs = useMemo(
    () => buildMcpClientConfigs({ endpoint, token, workspaceSlug }),
    [endpoint, token, workspaceSlug]
  );
  const [activeId, setActiveId] = useState(configs[0].id);
  const active = configs.find((config) => config.id === activeId) ?? configs[0];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1 border-b border-subtle">
        {configs.map((config) => (
          <button
            key={config.id}
            type="button"
            onClick={() => setActiveId(config.id)}
            className={cn("-mb-px border-b-2 px-3 py-1.5 text-13", {
              "border-primary text-primary": config.id === activeId,
              "border-transparent text-tertiary hover:text-secondary": config.id !== activeId,
            })}
          >
            {config.title}
          </button>
        ))}
      </div>
      <p className="text-13 text-secondary">{active.hint}</p>
      <CodeBlock code={active.snippet} />
    </div>
  );
}

function CreateTokenForm(props: {
  workspaces: { slug: string; name: string }[];
  allowedScopes: string[];
  maxDays: number;
  rateLimit: string;
  onCreated: (token: TMcpTokenCreated) => void;
}) {
  const { workspaces, allowedScopes, maxDays, rateLimit, onCreated } = props;
  // a preset is offered only when the administrator allows every scope it contains
  const presets = MCP_SCOPE_PRESETS.filter((preset) => preset.scopes.every((scope) => allowedScopes.includes(scope)));
  const [label, setLabel] = useState("Мой агент");
  const [workspaceSlug, setWorkspaceSlug] = useState(workspaces[0]?.slug ?? "");
  const [scopes, setScopes] = useState<string[]>(
    (presets.find((preset) => preset.id === "assistant") ?? presets[0])?.scopes ?? ["read"]
  );
  const lifetimes = [30, 90, 365].filter((days) => !maxDays || days <= maxDays);
  if (maxDays && !lifetimes.includes(maxDays)) lifetimes.push(maxDays);
  const [days, setDays] = useState<number | null>(
    lifetimes.includes(90) ? 90 : (lifetimes[lifetimes.length - 1] ?? null)
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleScope = (scope: string) =>
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!scopes.includes("read")) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Нужно право «Чтение»",
        message: "Агент находит задачи и проекты по названиям, для этого нужно читать данные.",
      });
      return;
    }
    setIsSubmitting(true);
    try {
      onCreated(
        await mcpService.userCreateToken({
          label: label.trim() || "MCP",
          workspace_slug: workspaceSlug,
          scopes,
          expires_in_days: days,
        })
      );
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось создать токен", message: errorText(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-subtle p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-13">
          <span className="block font-medium text-primary">Название</span>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={255}
            className="w-full rounded border border-subtle bg-surface-1 p-2"
            placeholder="Cursor на рабочем ноутбуке"
          />
        </label>
        <label className="space-y-1 text-13">
          <span className="block font-medium text-primary">Пространство</span>
          <select
            value={workspaceSlug}
            onChange={(event) => setWorkspaceSlug(event.target.value)}
            className="w-full rounded border border-subtle bg-surface-1 p-2"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.slug} value={workspace.slug}>
                {workspace.name}
              </option>
            ))}
          </select>
          <span className="block text-12 text-tertiary">Токен работает только в этом пространстве.</span>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-13 font-medium text-primary">Что разрешено агенту</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {presets.map((preset) => {
            const selected = preset.scopes.length === scopes.length && preset.scopes.every((s) => scopes.includes(s));
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setScopes(preset.scopes)}
                className={cn("rounded border p-2 text-left text-13", {
                  "border-accent-strong bg-accent-primary/5": selected,
                  "border-subtle hover:bg-layer-1": !selected,
                })}
              >
                <span className="block font-medium text-primary">{preset.title}</span>
                <span className="block text-12 text-secondary">{preset.description}</span>
              </button>
            );
          })}
        </div>
        <details className="text-13">
          <summary className="cursor-pointer text-secondary">Выбрать права вручную</summary>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {MCP_SCOPES.filter((item) => allowedScopes.includes(item.scope)).map((item) => (
              <label key={item.scope} className="flex items-start gap-2 rounded border border-subtle p-2">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={scopes.includes(item.scope)}
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
        </details>
      </fieldset>

      <label className="block space-y-1 text-13">
        <span className="block font-medium text-primary">Срок действия</span>
        <select
          value={days ?? ""}
          onChange={(event) => setDays(event.target.value ? Number(event.target.value) : null)}
          className="rounded border border-subtle bg-surface-1 p-2"
        >
          {lifetimes.map((value) => (
            <option key={value} value={value}>
              {value} дн.
            </option>
          ))}
          {!maxDays && <option value="">Без срока</option>}
        </select>
        <span className="block text-12 text-tertiary">Лимит запросов токена: {rateLimit}. Задаёт администратор.</span>
      </label>

      <Button
        type="submit"
        variant="primary"
        disabled={isSubmitting || !workspaceSlug || scopes.length === 0}
        loading={isSubmitting}
      >
        Создать токен
      </Button>
    </form>
  );
}

function TokenRow({ token, onDelete }: { token: TMcpToken; onDelete: () => void }) {
  const status = token.revoked ? "отозван" : token.expired ? "истёк" : "активен";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle py-3 text-13">
      <div className="min-w-0 space-y-1">
        <div className="font-medium text-primary">
          {token.label} <span className="font-normal ml-1 text-12 text-tertiary">{status}</span>
        </div>
        <div className="text-12 text-secondary">
          {token.workspace?.name ?? "любое пространство"} · создан {formatDate(token.created_at)} · использован{" "}
          {formatDate(token.last_used)} · до {token.expired_at ? formatDate(token.expired_at) : "без срока"}
        </div>
        <div className="flex flex-wrap gap-1">
          {token.scopes.map((scope) => (
            <code key={scope} className="rounded bg-layer-1 px-1 text-11">
              {scope}
            </code>
          ))}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={onDelete}>
        Удалить
      </Button>
    </div>
  );
}

export const McpProfileSettings = observer(function McpProfileSettings() {
  const { data, error, isLoading, mutate } = useSWR("USER_MCP_OVERVIEW", () => mcpService.userOverview());
  const [created, setCreated] = useState<TMcpTokenCreated | null>(null);

  if (isLoading) return <p className="text-13 text-tertiary">Загрузка…</p>;
  if (error || !data) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить настройки MCP.
      </p>
    );
  }

  const canCreate = data.enabled && data.allow_user_tokens && data.workspaces.length > 0;
  const shownWorkspace = created?.workspace?.slug ?? data.workspaces[0]?.slug;

  const removeToken = async (token: TMcpToken) => {
    if (!window.confirm(`Удалить токен «${token.label}»? Агент, который его использует, потеряет доступ.`)) return;
    try {
      await mcpService.userDeleteToken(token.id);
      if (created?.id === token.id) setCreated(null);
      await mutate();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Токен удалён" });
    } catch (deleteError) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось удалить", message: errorText(deleteError) });
    }
  };

  return (
    <div className="size-full space-y-8">
      <ProfileSettingsHeading
        title="MCP для агентов"
        description="Подключите AI-агента (Cursor, Claude, VS Code) к Gizmo. Агент будет работать от вашего имени и с вашими правами."
      />

      {!data.enabled && (
        <div role="alert" className="rounded-md border border-warning-strong/40 bg-warning-subtle p-3 text-13">
          MCP отключён администратором экземпляра. Подключение агентов временно недоступно.
        </div>
      )}
      {data.enabled && !data.allow_user_tokens && (
        <div role="status" className="rounded-md border border-subtle bg-layer-1 p-3 text-13">
          Администратор отключил самостоятельное создание MCP-токенов. Чтобы подключить агента, попросите токен у
          администратора.
        </div>
      )}
      {data.enabled && data.allow_user_tokens && data.workspaces.length === 0 && (
        <div role="status" className="rounded-md border border-subtle bg-layer-1 p-3 text-13">
          У вас нет пространств, в которых можно подключить агента.
        </div>
      )}

      {/* 1. token */}
      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">1. Создайте токен</h3>
        {canCreate && !created && (
          <CreateTokenForm
            workspaces={data.workspaces}
            allowedScopes={data.policy.allowed_scopes}
            maxDays={data.policy.max_token_days}
            rateLimit={data.policy.default_rate_limit}
            onCreated={(token) => {
              setCreated(token);
              void mutate();
            }}
          />
        )}
        {created && (
          <div className="space-y-3 rounded-lg border border-success-strong/40 bg-success-subtle p-4 text-13">
            <p className="font-medium text-primary">Токен «{created.label}» создан. Скопируйте его сейчас.</p>
            <p className="text-secondary">Токен показывается один раз. Позже его нельзя будет посмотреть.</p>
            <CodeBlock code={created.token} />
            <Button variant="secondary" size="sm" onClick={() => setCreated(null)}>
              Я сохранил токен
            </Button>
          </div>
        )}
      </section>

      {/* 2. connect */}
      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">2. Вставьте настройку в клиент</h3>
        <p className="text-13 text-secondary">
          {created
            ? "Настройки уже содержат ваш новый токен и пространство. Выберите свой клиент."
            : "Так выглядит подключение. После создания токена здесь появятся готовые настройки с вашим токеном."}
        </p>
        <ClientConfigs endpoint={data.endpoint} token={created?.token} workspaceSlug={shownWorkspace} />
      </section>

      {/* 3. tokens */}
      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Мои MCP-токены</h3>
        {data.tokens.length > 0 ? (
          data.tokens.map((token) => <TokenRow key={token.id} token={token} onDelete={() => void removeToken(token)} />)
        ) : (
          <p className="text-13 text-tertiary">Пока нет ни одного токена.</p>
        )}
      </section>

      {/* guide */}
      <section className="space-y-4 text-13 text-secondary">
        <h3 className="text-14 font-medium text-primary">Руководство</h3>
        <div className="space-y-1">
          <p className="font-medium text-primary">Что умеет агент</p>
          <ul className="space-y-2">
            {MCP_TOOL_GROUPS.map((group) => (
              <li key={group.title} className="rounded border border-subtle p-2">
                <div className="font-medium text-primary">{group.title}</div>
                <div className="text-12">{group.description}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.tools.map((tool) => (
                    <code key={tool} className="rounded bg-layer-1 px-1 text-11">
                      {tool}
                    </code>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-primary">Примеры запросов</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>«Покажи мои открытые задачи в проекте WEB и сгруппируй по приоритету».</li>
            <li>«Создай задачу WEB: исправить вёрстку шапки, назначь на меня, срок — пятница».</li>
            <li>«Ответь в ветке комментариев к WEB-123, что исправление выкатили, и спиши 2 часа».</li>
            <li>«Сколько часов команда списала на проект за этот месяц?»</li>
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-primary">Безопасность</p>
          <ul className="list-disc space-y-1 pl-5">
            {MCP_SAFETY_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-primary">Если не работает</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>401: токен неверный, истёк или отозван. Создайте новый.</li>
            <li>403: у токена нет нужного права или у вас нет доступа к проекту.</li>
            <li>429: превышен лимит запросов, подождите минуту.</li>
            <li>Ответ «MCP отключён»: администратор выключил MCP на экземпляре.</li>
          </ul>
        </div>
      </section>
    </div>
  );
});
