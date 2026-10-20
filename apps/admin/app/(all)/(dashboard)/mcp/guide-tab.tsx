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
import { MCP_SAFETY_RULES, MCP_SCOPES, MCP_TOOL_GROUPS, buildMcpClientConfigs, cn } from "@plane/utils";

const mcpService = new McpService();

export function McpGuideTab() {
  const { data } = useSWR("MCP_OVERVIEW", () => mcpService.adminOverview());
  const endpoint = data?.endpoint ?? `${window.location.origin}/mcp`;
  const configs = buildMcpClientConfigs({ endpoint, workspaceSlug: "<slug-пространства>" });
  const [activeClient, setActiveClient] = useState(configs[0].id);
  const active = configs.find((config) => config.id === activeClient) ?? configs[0];

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
            Пользователь открывает «Настройки профиля → MCP для агентов», создаёт токен, копирует готовую настройку для
            своего клиента (Cursor, Claude, VS Code) и вставляет её.
          </li>
          <li>Следите за использованием на вкладках «Токены» и «Журнал вызовов»; отзывайте лишние токены.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h3 className="text-14 font-medium text-primary">Пример подключения клиента</h3>
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
          Вместо &lt;ВАШ_ТОКЕН&gt; подставляется токен пользователя. В настройках профиля пользователь получает те же
          настройки уже с готовым токеном и пространством.
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
          одному пространству и не работает в других.
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
