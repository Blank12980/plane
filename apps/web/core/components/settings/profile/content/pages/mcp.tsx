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
import type { TMcpOAuthConnection, TMcpToken, TMcpTokenCreated } from "@plane/types";
import {
  MCP_SAFETY_RULES,
  MCP_SCOPES,
  MCP_SCOPE_PRESETS,
  MCP_TOOL_GROUPS,
  buildMcpAgentPrompt,
  buildMcpClientConfigs,
  buildMcpOAuthConfigs,
  cn,
} from "@plane/utils";
import type { TMcpClientConfig } from "@plane/utils";
// components
import { ProfileSettingsHeading } from "@/components/settings/profile/heading";

const mcpService = new McpService();

const ALL_WORKSPACES = "*";

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

const tokenTarget = (token: Pick<TMcpToken, "workspace">) => token.workspace?.name ?? "все пространства";

/** A secret is never shown in full on screen; copying still copies the real value. */
const maskToken = (text: string, token?: string) => (token ? text.split(token).join("plane_api_••••••••") : text);

function CodeBlock({
  code,
  copyValue,
  label = "Копировать",
  testId,
}: {
  code: string;
  copyValue?: string;
  label?: string;
  testId?: string;
}) {
  return (
    <div className="relative">
      <pre
        data-testid={testId}
        className="max-h-96 overflow-auto rounded-md bg-layer-1 p-3 pr-28 text-12 whitespace-pre-wrap text-primary"
      >
        {code}
      </pre>
      <button
        type="button"
        className="absolute top-2 right-2 rounded bg-surface-1 px-2 py-1 text-12 text-secondary hover:text-primary"
        onClick={() => {
          void navigator.clipboard.writeText(copyValue ?? code);
          setToast({ type: TOAST_TYPE.SUCCESS, title: "Скопировано" });
        }}
      >
        {label}
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
  return <ConfigTabs configs={configs} token={token} />;
}

function ConfigTabs({ configs, token }: { configs: TMcpClientConfig[]; token?: string }) {
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
      <CodeBlock code={maskToken(active.snippet, token)} copyValue={active.snippet} />
    </div>
  );
}

function CreateTokenForm(props: {
  workspaces: { slug: string; name: string }[];
  allowAllWorkspaces: boolean;
  allowedScopes: string[];
  maxDays: number;
  rateLimit: string;
  onCreated: (token: TMcpTokenCreated) => void;
}) {
  const { workspaces, allowAllWorkspaces, allowedScopes, maxDays, rateLimit, onCreated } = props;
  // a preset is offered only when the administrator allows every scope it contains
  const presets = MCP_SCOPE_PRESETS.filter((preset) => preset.scopes.every((scope) => allowedScopes.includes(scope)));
  const [label, setLabel] = useState("Мой агент");
  // "all workspaces" is the default when it is allowed and the user has more than one workspace
  const [target, setTarget] = useState(
    allowAllWorkspaces && workspaces.length > 1 ? ALL_WORKSPACES : (workspaces[0]?.slug ?? "")
  );
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
          ...(target === ALL_WORKSPACES ? { all_workspaces: true } : { workspace_slug: target }),
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
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="w-full rounded border border-subtle bg-surface-1 p-2"
          >
            {allowAllWorkspaces && <option value={ALL_WORKSPACES}>Все мои пространства ({workspaces.length})</option>}
            {workspaces.map((workspace) => (
              <option key={workspace.slug} value={workspace.slug}>
                {workspace.name}
              </option>
            ))}
          </select>
          <span className="block text-12 text-tertiary">
            {target === ALL_WORKSPACES
              ? "Один токен работает во всех пространствах, где вы состоите, в том числе в тех, куда вас добавят позже."
              : "Токен работает только в этом пространстве."}
          </span>
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
        disabled={isSubmitting || !target || scopes.length === 0}
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
          {tokenTarget(token)} · создан {formatDate(token.created_at)} · использован {formatDate(token.last_used)} · до{" "}
          {token.expired_at ? formatDate(token.expired_at) : "без срока"}
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

function OAuthSection({
  endpoint,
  connections,
  hasWorkspaces,
  onDisconnect,
}: {
  endpoint: string;
  connections: TMcpOAuthConnection[];
  hasWorkspaces: boolean;
  onDisconnect: (connection: TMcpOAuthConnection) => void;
}) {
  const configs = useMemo(() => buildMcpOAuthConfigs(endpoint), [endpoint]);
  return (
    <section className="space-y-3" aria-label="Вход через OAuth">
      <h3 className="text-14 font-medium text-primary">Способ 1. Вход через OAuth, без токена</h3>
      <p className="text-13 text-secondary">
        Подходит приложениям, которые сами открывают окно входа: ChatGPT, Claude, Cursor, VS Code. Укажите в приложении
        адрес сервера и выберите авторизацию OAuth: приложение попросит вас войти в Gizmo, а вы выберете права и
        пространства. Токен создавать и вставлять не нужно.
      </p>
      {!hasWorkspaces && (
        <p role="status" className="text-13 text-tertiary">
          У вас нет пространств, в которых можно подключить приложение.
        </p>
      )}
      <div className="space-y-1">
        <span className="text-13 font-medium text-primary">Адрес MCP-сервера</span>
        <CodeBlock code={endpoint} label="Скопировать адрес" />
      </div>
      <ConfigTabs configs={configs} />
      <div className="space-y-1">
        <h4 className="text-13 font-medium text-primary">Подключённые приложения</h4>
        {connections.length > 0 ? (
          connections.map((connection) => (
            <div
              key={connection.id}
              className="flex flex-wrap items-start justify-between gap-3 border-b border-subtle py-3 text-13"
            >
              <div className="min-w-0 space-y-1">
                <div className="font-medium text-primary">{connection.client_name}</div>
                <div className="text-12 text-secondary">
                  {connection.workspace?.name ?? "все пространства"} · подключено {formatDate(connection.created_at)} ·
                  использовано {formatDate(connection.last_used_at)} · действует до {formatDate(connection.expires_at)}
                </div>
                <div className="flex flex-wrap gap-1">
                  {connection.scopes.map((scope) => (
                    <code key={scope} className="rounded bg-layer-1 px-1 text-11">
                      {scope}
                    </code>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onDisconnect(connection)}>
                Отключить
              </Button>
            </div>
          ))
        ) : (
          <p className="text-13 text-tertiary">Пока ни одно приложение не подключено через OAuth.</p>
        )}
      </div>
    </section>
  );
}

export const McpProfileSettings = observer(function McpProfileSettings() {
  const { data, error, isLoading, mutate } = useSWR("USER_MCP_OVERVIEW", () => mcpService.userOverview());
  const [created, setCreated] = useState<TMcpTokenCreated | null>(null);
  // undefined: the newest working token is used automatically, null: the user chose "without a token"
  const [chosenTokenId, setChosenTokenId] = useState<string | null | undefined>(undefined);

  // the token that was just created is usable right away, before the list is reloaded
  const knownTokens = data?.tokens ?? [];
  const tokens =
    created && !knownTokens.some((token) => token.id === created.id) ? [created, ...knownTokens] : knownTokens;
  const workingTokens = tokens.filter((token) => token.is_active);
  const selectedId = chosenTokenId === undefined ? (created?.id ?? workingTokens[0]?.id ?? null) : chosenTokenId;
  const selectedToken = workingTokens.find((token) => token.id === selectedId) ?? null;

  // the secret of the selected token is substituted into the prompt and the configurations automatically
  const { data: fetchedSecret } = useSWR(
    selectedToken && created?.id !== selectedToken.id ? ["USER_MCP_TOKEN_SECRET", selectedToken.id] : null,
    () => mcpService.userRevealToken(selectedToken!.id),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const secret = selectedToken ? (created?.id === selectedToken.id ? created.token : fetchedSecret) : undefined;

  const workspaceSlugs = (data?.workspaces ?? []).map((workspace) => workspace.slug);
  const tokenWorkspaceSlug = selectedToken?.workspace?.slug;
  const defaultSlug = tokenWorkspaceSlug ?? workspaceSlugs[0];
  const coversAllWorkspaces = !!selectedToken && !selectedToken.workspace;

  const prompt = useMemo(
    () =>
      data
        ? buildMcpAgentPrompt({
            endpoint: data.endpoint,
            token: secret,
            workspaceSlug: defaultSlug,
            allWorkspaceSlugs: coversAllWorkspaces ? workspaceSlugs : undefined,
            oauth: data.oauth.enabled,
          })
        : "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.endpoint, data?.oauth.enabled, secret, defaultSlug, coversAllWorkspaces, workspaceSlugs.join(",")]
  );

  if (isLoading) return <p className="text-13 text-tertiary">Загрузка…</p>;
  if (error || !data) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить настройки MCP.
      </p>
    );
  }

  const canCreate = data.enabled && data.allow_user_tokens && data.workspaces.length > 0;

  const removeToken = async (token: TMcpToken) => {
    if (!window.confirm(`Удалить токен «${token.label}»? Агент, который его использует, потеряет доступ.`)) return;
    try {
      await mcpService.userDeleteToken(token.id);
      if (created?.id === token.id) setCreated(null);
      if (chosenTokenId === token.id) setChosenTokenId(undefined);
      await mutate();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Токен удалён" });
    } catch (deleteError) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось удалить", message: errorText(deleteError) });
    }
  };

  const disconnect = async (connection: TMcpOAuthConnection) => {
    if (!window.confirm(`Отключить «${connection.client_name}»? Приложение потеряет доступ к Gizmo.`)) return;
    try {
      await mcpService.userDeleteConnection(connection.id);
      await mutate();
      setToast({ type: TOAST_TYPE.SUCCESS, title: "Приложение отключено" });
    } catch (disconnectError) {
      setToast({ type: TOAST_TYPE.ERROR, title: "Не удалось отключить", message: errorText(disconnectError) });
    }
  };

  const oauthEnabled = data.oauth.enabled;

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

      {/* OAuth: applications such as ChatGPT log the user in themselves */}
      {oauthEnabled && (
        <OAuthSection
          endpoint={data.endpoint}
          connections={data.oauth.connections}
          hasWorkspaces={data.workspaces.length > 0}
          onDisconnect={(connection) => void disconnect(connection)}
        />
      )}
      {data.enabled && !data.policy.allow_oauth && (
        <p className="text-12 text-tertiary">
          Вход через OAuth (ChatGPT и другие приложения) отключён администратором: используйте токен.
        </p>
      )}

      {/* token */}
      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">{oauthEnabled ? "Способ 2. Токен" : "1. Токен"}</h3>
        {canCreate && !created && (
          <CreateTokenForm
            workspaces={data.workspaces}
            allowAllWorkspaces={data.policy.allow_all_workspaces}
            allowedScopes={data.policy.allowed_scopes}
            maxDays={data.policy.max_token_days}
            rateLimit={data.policy.default_rate_limit}
            onCreated={(token) => {
              setCreated(token);
              setChosenTokenId(undefined);
              void mutate();
            }}
          />
        )}
        {created && (
          <div className="space-y-3 rounded-lg border border-success-strong/40 bg-success-subtle p-4 text-13">
            <p className="font-medium text-primary">
              Токен «{created.label}» создан ({tokenTarget(created)}). Он уже подставлен в промпт и настройки ниже.
            </p>
            <p className="text-secondary">Позже токен можно снова скопировать здесь же: он виден только вам.</p>
            <CodeBlock code={maskToken(created.token, created.token)} copyValue={created.token} />
            <Button variant="secondary" size="sm" onClick={() => setCreated(null)}>
              Создать ещё один
            </Button>
          </div>
        )}
        {!canCreate && !created && workingTokens.length === 0 && (
          <p className="text-13 text-tertiary">Пока нет рабочих токенов.</p>
        )}
      </section>

      {/* 2. prompt for an agent */}
      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">Попросите агента подключиться самому</h3>
        <p className="text-13 text-secondary">
          Скопируйте промпт и вставьте его агенту (Claude Code, Cursor, Codex и др.): он сам определит свой клиент,
          добавит MCP-сервер Gizmo и проверит подключение. Вручную ничего править не нужно.
          {oauthEnabled &&
            " В промпте два способа: вход через OAuth (токен не нужен) и токен; агент выберет тот, что поддерживает его клиент."}
        </p>
        <label className="flex flex-wrap items-center gap-2 text-13">
          <span className="font-medium text-primary">Токен в промпте</span>
          <select
            aria-label="Токен в промпте"
            value={selectedId ?? ""}
            onChange={(event) => setChosenTokenId(event.target.value || null)}
            className="rounded border border-subtle bg-surface-1 p-2"
          >
            {workingTokens.map((token) => (
              <option key={token.id} value={token.id}>
                {token.label} · {tokenTarget(token)}
              </option>
            ))}
            <option value="">
              {oauthEnabled
                ? "Без токена (вход через OAuth или агент попросит токен)"
                : "Без токена (агент попросит его у вас)"}
            </option>
          </select>
        </label>
        {selectedToken && !secret && <p className="text-12 text-tertiary">Подставляем токен…</p>}
        <CodeBlock
          code={maskToken(prompt, secret)}
          copyValue={prompt}
          label="Скопировать промпт"
          testId="agent-prompt"
        />
        {!selectedToken && (
          <p className="text-12 text-tertiary">
            Токена пока нет. Создайте его выше, и он подставится в промпт автоматически.
          </p>
        )}
      </section>

      {/* 3. manual */}
      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">Или добавьте вручную (по токену)</h3>
        <p className="text-13 text-secondary">
          Настройки для разных клиентов. Токен и пространство подставлены автоматически, если токен выбран выше.
        </p>
        <ClientConfigs endpoint={data.endpoint} token={secret} workspaceSlug={defaultSlug} />
      </section>

      {/* tokens */}
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
            {oauthEnabled && (
              <li>
                Приложение, подключённое через OAuth, перестало отвечать: отключите его выше и подключите заново (доступ
                обновляется автоматически, пока приложением пользуются).
              </li>
            )}
            <li>403: у токена нет нужного права или у вас нет доступа к проекту.</li>
            <li>429: превышен лимит запросов, подождите минуту.</li>
            <li>Ответ «MCP отключён»: администратор выключил MCP на экземпляре.</li>
            <li>
              «No workspace given»: токен для всех пространств, а пространство не указано. Агент вызывает
              list_workspaces.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
});
