/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
// gizmo imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { McpService } from "@plane/services";
import {
  MCP_SAFETY_RULES,
  MCP_SCOPES,
  MCP_TOOL_GROUPS,
  buildMcpClientConfigs,
  buildMcpOAuthConfigs,
  cn,
  mcpOAuthMetadataUrl,
} from "@plane/utils";

const mcpService = new McpService();

export function McpGuideTab() {
  const { data } = useSWR("MCP_OVERVIEW", () => mcpService.adminOverview());
  const endpoint = data?.endpoint ?? `${window.location.origin}/mcp`;
  const tokenConfigs = buildMcpClientConfigs({ endpoint, workspaceSlug: "<slug-пространства>" });
  const oauthConfigs = buildMcpOAuthConfigs(endpoint);
  const oauthEnabled = data ? data.settings.enabled && data.settings.allow_oauth : true;
  const [mode, setMode] = useState<"oauth" | "token">("oauth");
  const configs = oauthEnabled && mode === "oauth" ? oauthConfigs : tokenConfigs;
  const [activeClient, setActiveClient] = useState(configs[0].id);
  const active = configs.find((config) => config.id === activeClient) ?? configs[0];
  const switchMode = (next: "oauth" | "token") => {
    setMode(next);
    setActiveClient((next === "oauth" ? oauthConfigs : tokenConfigs)[0].id);
  };

  return (
    <div className="space-y-8 text-13 text-secondary">
      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Как это работает</h3>
        <p>
          MCP (Model Context Protocol) — стандартный способ дать AI-агенту инструменты. Сервер Gizmo — тонкий адаптер к
          публичному API: он не хранит токены и не обращается к базе напрямую. Все проверки прав выполняет Django, а
          агент работает с теми правами, которые есть у владельца токена.
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Убедитесь, что MCP включён на вкладке «Обзор и политика» и контейнер сервера доступен.</li>
          <li>
            Задайте правила: какие права токена можно выдавать, максимальный срок и лимит запросов. Разрешите
            пользователям создавать токены или выдавайте их сами.
          </li>
          <li>
            Пользователь открывает «Настройки профиля → MCP для агентов». Либо создаёт токен и копирует готовую
            настройку или промпт для агента (Cursor, Claude, VS Code), либо подключает приложение через OAuth (ChatGPT,
            Claude): указывает адрес сервера, входит в Gizmo и выбирает права.
          </li>
          <li>Следите за использованием на вкладках «Токены» и «Журнал вызовов»; отзывайте лишние токены.</li>
        </ol>
      </section>

      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Подключение через OAuth (ChatGPT и др.)</h3>
        <p>
          {oauthEnabled
            ? "OAuth включён."
            : "OAuth выключен (на вкладке «Обзор и политика» или вместе с MCP): приложения смогут подключаться только по токену."}{" "}
          Приложение получает адрес сервера <code>{endpoint}</code>, само находит настройки авторизации (
          <code>{mcpOAuthMetadataUrl(endpoint)}</code>), регистрируется и отправляет пользователя на экран согласия
          Gizmo. Там пользователь выбирает права (в пределах разрешённых вам) и пространства. Приложение получает
          короткоживущий доступ и обновляет его само, пока им пользуются.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Права, срок (refresh-токен живёт «максимальный срок токена» или 365 дней без ограничения) и лимит запросов
            берутся из правил на вкладке «Обзор и политика».
          </li>
          <li>
            Подключения видны на вкладке «Токены»: администратор может отключить любое. Выключение OAuth или MCP
            останавливает их мгновенно.
          </li>
          <li>
            Для работы нужен публичный HTTPS-адрес (<code>APP_BASE_URL</code>) и маршрут{" "}
            <code>/.well-known/oauth-*</code> к API: он входит в стандартный Caddyfile.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">Пример подключения клиента</h3>
        {oauthEnabled && (
          <div className="flex gap-2 text-13">
            {(
              [
                ["oauth", "Через OAuth, без токена"],
                ["token", "По токену"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => switchMode(key)}
                className={cn("rounded border px-3 py-1", {
                  "border-accent-strong text-primary": mode === key,
                  "border-subtle text-tertiary hover:text-secondary": mode !== key,
                })}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1 border-b border-subtle">
          {configs.map((config) => (
            <button
              key={config.id}
              type="button"
              onClick={() => setActiveClient(config.id)}
              className={cn("-mb-px border-b-2 px-3 py-1.5 text-13", {
                "border-primary text-primary": config.id === activeClient,
                "border-transparent text-tertiary hover:text-secondary": config.id !== activeClient,
              })}
            >
              {config.title}
            </button>
          ))}
        </div>
        <p>{active.hint}</p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-md bg-layer-1 p-3 text-12 text-primary">{active.snippet}</pre>
          <button
            type="button"
            className="absolute top-2 right-2 rounded bg-surface-1 px-2 py-1 text-12 text-secondary hover:text-primary"
            onClick={() => {
              void navigator.clipboard.writeText(active.snippet);
              setToast({ type: TOAST_TYPE.SUCCESS, title: "Скопировано" });
            }}
          >
            Копировать
          </button>
        </div>
        <p className="text-12 text-tertiary">
          {oauthEnabled && mode === "oauth"
            ? "Токен не нужен: клиент откроет страницу входа в Gizmo. В настройках профиля те же инструкции и список подключённых приложений."
            : "Вместо <ВАШ_ТОКЕН> подставляется токен пользователя. В настройках профиля токен подставляется в настройки и в промпт для агента автоматически."}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Права токена (scopes)</h3>
        <ul className="grid gap-2 md:grid-cols-2">
          {MCP_SCOPES.map((item) => (
            <li key={item.scope} className="rounded border border-subtle p-2">
              <span className="font-medium text-primary">{item.title}</span>{" "}
              <code className="text-11 text-tertiary">{item.scope}</code>
              <div className="text-12">{item.description}</div>
            </li>
          ))}
        </ul>
        <p>
          Права только сужают доступ: токен никогда не может больше, чем позволяет роль владельца. Токен привязан к
          одному пространству или (если вы это разрешили) работает во всех пространствах пользователя.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Что умеет агент</h3>
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
      </section>

      <section className="space-y-2">
        <h3 className="text-14 font-medium text-primary">Безопасность</h3>
        <ul className="list-disc space-y-1 pl-5">
          {MCP_SAFETY_RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
          <li>
            Для служебных агентов создавайте отдельного бот-пользователя командой{" "}
            <code>
              docker compose exec api python manage.py create_agent_token --email bot@example.com --workspace acme
              --create-bot --scopes read,issues:write --expires-days 90
            </code>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
