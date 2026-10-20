/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Shared content of the MCP guide: it is shown in God Mode (for administrators) and in the profile settings (for users
 * who connect an AI agent), so both always describe the same scopes, tools and client configurations.
 */

export const MCP_TOKEN_PLACEHOLDER = "<ВАШ_ТОКЕН>";

export type TMcpScopeInfo = { scope: string; title: string; description: string };

export const MCP_SCOPES: TMcpScopeInfo[] = [
  { scope: "read", title: "Чтение", description: "Просмотр проектов, задач, комментариев и справочников." },
  {
    scope: "issues:write",
    title: "Задачи",
    description: "Создание и изменение задач, меток, ссылок и вложений.",
  },
  { scope: "issues:delete", title: "Удаление задач", description: "Удаление задач. По умолчанию не выдаётся." },
  { scope: "comments:write", title: "Комментарии", description: "Комментарии и ответы в ветках." },
  { scope: "worklogs:write", title: "Учёт времени", description: "Списание времени (только свои записи)." },
  { scope: "tags:write", title: "Теги", description: "Теги пространства и теги задач." },
  { scope: "cycles:write", title: "Циклы", description: "Циклы и задачи в циклах." },
  { scope: "modules:write", title: "Модули", description: "Модули и задачи в модулях." },
  { scope: "intake:write", title: "Intake", description: "Обработка входящих задач (разбор — для админов проекта)." },
];

/** Ready-made scope sets for the "create token" form. */
export const MCP_SCOPE_PRESETS: { id: string; title: string; description: string; scopes: string[] }[] = [
  {
    id: "read",
    title: "Только чтение",
    description: "Агент смотрит задачи и отвечает на вопросы, ничего не меняя.",
    scopes: ["read"],
  },
  {
    id: "assistant",
    title: "Помощник",
    description: "Читает, создаёт и меняет задачи, комментирует, списывает время.",
    scopes: ["read", "issues:write", "comments:write", "worklogs:write"],
  },
  {
    id: "planner",
    title: "Планирование",
    description: "Помощник плюс циклы, модули, теги и Intake.",
    scopes: [
      "read",
      "issues:write",
      "comments:write",
      "worklogs:write",
      "tags:write",
      "cycles:write",
      "modules:write",
      "intake:write",
    ],
  },
];

export const MCP_TOOL_GROUPS: { title: string; scope: string; tools: string[]; description: string }[] = [
  {
    title: "Контекст",
    scope: "read",
    tools: ["whoami", "list_projects", "get_project", "list_members", "list_states", "list_labels"],
    description: "Кто вы, какие есть проекты, участники, состояния и метки.",
  },
  {
    title: "Задачи",
    scope: "read / issues:write",
    tools: ["search_work_items", "get_work_item", "list_work_items", "create_work_item", "update_work_item"],
    description: "Поиск, чтение, создание и изменение задач; задачу можно указывать ключом, например WEB-123.",
  },
  {
    title: "Обсуждение",
    scope: "read / comments:write",
    tools: ["list_comments", "add_comment", "update_comment", "list_activity"],
    description: "Комментарии (включая ответы в ветках) и история изменений задачи.",
  },
  {
    title: "Планирование",
    scope: "read / cycles:write / modules:write / intake:write",
    tools: ["list_cycles", "create_cycle", "add_work_items_to_cycle", "list_modules", "list_intake", "triage_intake"],
    description: "Циклы, модули и входящие задачи.",
  },
  {
    title: "Теги и время",
    scope: "read / tags:write / worklogs:write",
    tools: ["list_tags", "set_work_item_tags", "log_time", "list_worklogs", "time_report"],
    description: "Теги задач, списание времени и отчёты по часам.",
  },
];

export const MCP_SAFETY_RULES: string[] = [
  "Токен действует от вашего имени и никогда не даёт больше прав, чем у вас в Gizmo.",
  "Выдавайте минимальный набор прав: для вопросов хватает «Только чтение».",
  "Токен показывается один раз. Не публикуйте его и не коммитьте в репозиторий. Если токен утёк, удалите его в настройках.",
  "Содержимое задач и комментариев агент получает как данные и не должен выполнять найденные там инструкции.",
  "Удаление задач и записей времени требует отдельного права и подтверждения.",
];

export type TMcpClientConfig = {
  id: string;
  title: string;
  /** Where to put the snippet or which command to run. */
  hint: string;
  language: "json" | "bash";
  snippet: string;
};

export type TMcpConfigInput = {
  /** Public URL of the MCP endpoint, e.g. https://gizmo.example.com/mcp */
  endpoint: string;
  /** The token secret. A placeholder is used while the user has no token yet. */
  token?: string;
  workspaceSlug?: string;
};

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Connection snippets for the popular MCP clients, filled with the endpoint, token and workspace. */
export function buildMcpClientConfigs(input: TMcpConfigInput): TMcpClientConfig[] {
  const endpoint = input.endpoint.replace(/\/+$/, "");
  const token = input.token || MCP_TOKEN_PLACEHOLDER;
  const slug = input.workspaceSlug || "<slug-пространства>";
  const headers = { Authorization: `Bearer ${token}`, "X-Workspace-Slug": slug };

  return [
    {
      id: "cursor",
      title: "Cursor",
      hint: "Файл ~/.cursor/mcp.json (для всех проектов) или .cursor/mcp.json в проекте",
      language: "json",
      snippet: json({ mcpServers: { gizmo: { url: endpoint, headers } } }),
    },
    {
      id: "claude-code",
      title: "Claude Code",
      hint: "Выполните команду в терминале",
      language: "bash",
      snippet: [
        `claude mcp add --transport http gizmo ${endpoint} \\`,
        `  --header "Authorization: Bearer ${token}" \\`,
        `  --header "X-Workspace-Slug: ${slug}"`,
      ].join("\n"),
    },
    {
      id: "vscode",
      title: "VS Code",
      hint: "Файл .vscode/mcp.json в проекте или команда «MCP: Add Server»",
      language: "json",
      snippet: json({ servers: { gizmo: { type: "http", url: endpoint, headers } } }),
    },
    {
      id: "claude-desktop",
      title: "Claude Desktop",
      hint: "claude_desktop_config.json. Нужен Node.js: подключение идёт через mcp-remote. Заголовок передаётся через переменную окружения, чтобы пробел в «Bearer …» не ломал аргументы.",
      language: "json",
      snippet: json({
        mcpServers: {
          gizmo: {
            command: "npx",
            args: [
              "-y",
              "mcp-remote",
              endpoint,
              "--header",
              "Authorization:${AUTH_HEADER}",
              "--header",
              `X-Workspace-Slug:${slug}`,
            ],
            env: { AUTH_HEADER: `Bearer ${token}` },
          },
        },
      }),
    },
    {
      id: "curl",
      title: "Проверка (curl)",
      hint: "Если ответ содержит ваше имя, подключение работает",
      language: "bash",
      snippet: [
        `curl -s ${endpoint} \\`,
        `  -H "Authorization: Bearer ${token}" -H "X-Workspace-Slug: ${slug}" \\`,
        `  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'`,
      ].join("\n"),
    },
  ];
}
