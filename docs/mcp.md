# MCP-сервер Gizmo

`apps/mcp` — сервер [Model Context Protocol](https://modelcontextprotocol.io), через который
ИИ-агенты (Cursor, Claude, любые MCP-клиенты) работают с Gizmo: читают и создают задачи,
комментируют, планируют циклы, ставят теги, списывают время.

- Адрес: `https://<APP_HOST>/mcp` (Streamable HTTP, stateless). Проверка: `GET https://<APP_HOST>/mcp/health`.
- Сервер — тонкий адаптер к публичному API `/api/v1`. Прямого доступа к БД у него нет.
  Все проверки прав выполняет Django, MCP только пересылает токен вызывающего.
- Токен передаётся заголовком `Authorization: Bearer <token>` (или `X-Api-Key: <token>`) и
  уходит в API как `X-Api-Key`. В API добавляется заголовок `X-Mcp-Tool: <имя инструмента>`,
  он попадает в журнал `APIActivityLog` (поле `headers`).

## 0. Быстрый старт для пользователя

1. Откройте **Настройки профиля → MCP для агентов** (раздел «Разработчик»).
2. Выберите пространство и набор прав («Только чтение», «Помощник», «Планирование» или свой), срок действия.
3. Нажмите **Создать токен** и скопируйте его. Токен показывается один раз.
4. Выберите свой клиент (Cursor, Claude Code, VS Code, Claude Desktop). Настройка уже содержит адрес сервера,
   токен и пространство. Вставьте её в файл конфигурации или выполните команду.
5. Проверка: попросите агента «кто я в Gizmo» (инструмент `whoami`) или выполните готовую команду `curl`.

Токен создаётся **от вашего имени**: агент работает с вашими правами и никогда не получает больше, чем у вас
есть в Gizmo. Правила создания токенов (допустимые права, срок, лимит запросов) задаёт администратор экземпляра.
Если MCP выключен или самостоятельные токены запрещены, страница объясняет это и не даёт создать токен.

## 1. Токен для агента

Рекомендуемая схема: **у каждого агента свой бот-пользователь и свой токен**, привязанный к
workspace, с минимальным набором скоупов, лимитом запросов и сроком действия.

### Скоупы

| Скоуп            | Что разрешает                                                              |
| ---------------- | -------------------------------------------------------------------------- |
| `read`           | все GET-запросы                                                            |
| `issues:write`   | создание и изменение задач, меток (labels), ссылок, вложений               |
| `issues:delete`  | удаление задач (отдельно, по умолчанию не выдаётся)                        |
| `comments:write` | комментарии                                                                |
| `worklogs:write` | учёт времени (только свои записи)                                          |
| `tags:write`     | теги workspace и теги задач (создание тегов — только для админа workspace) |
| `cycles:write`   | циклы и задачи в циклах                                                    |
| `modules:write`  | модули и задачи в модулях                                                  |
| `intake:write`   | intake (triage — только для админа проекта)                                |

- Пустой список скоупов = старое поведение (полный доступ в пределах роли пользователя).
  Так работают все существующие токены.
- Скоупы только сужают доступ и никогда не дают больше, чем позволяет роль пользователя.
- Большинство инструментов записи сначала читают задачу или справочники для разрешения
  ключей и имён. Выдавайте MCP-токенам `read` вместе с нужными скоупами записи.
- Операции без собственного скоупа (создание проектов, состояний, участников, инвайтов,
  стикеров) токенам со скоупами недоступны.
- Токен с привязкой к workspace получает `403` при обращении к другому workspace.
- Для обычных токенов лимит запросов берётся из `allowed_rate_limit` (например `120/min`). Значение по
  умолчанию `60/min` означает «использовать глобальный `API_KEY_RATE_LIMIT`».
  Пользователь не может менять лимит и флаг `is_service` своего токена через API.
  Служебные токены (`is_service`) сохраняют отдельный лимит `300/min`.

### Создание бота и токена (рекомендуется)

```bash
docker compose exec api python manage.py create_agent_token \
  --email triage-bot@example.com \
  --workspace acme \
  --create-bot \
  --projects WEB,API \
  --scopes read,issues:write,comments:write,worklogs:write \
  --rate-limit 120/min \
  --expires-days 90
```

Команда создаёт бот-пользователя (если его нет), добавляет его в workspace и указанные проекты
с ролью Member и печатает токен. Токен показывается один раз.

### Токен от своего имени

Через API приложения (сессия пользователя) можно создать токен со скоупами и привязкой:

```http
POST /api/users/api-tokens/
{"label": "cursor", "scopes": ["read", "issues:write"], "workspace_slug": "acme", "expired_at": "2027-01-01T00:00:00Z"}
```

## 2. Подключение клиентов

Ниже `https://plane.example.com` — ваш `APP_HOST`, `plane_api_xxx` — токен.
Если у сервера не задан `DEFAULT_WORKSPACE_SLUG`, передайте заголовок `X-Workspace-Slug`
(или аргумент `workspace_slug` в каждом вызове). Привязка токена ограничивает доступ,
но сама по себе не задаёт workspace в MCP.

### Cursor (`~/.cursor/mcp.json` или `.cursor/mcp.json` в проекте)

```json
{
  "mcpServers": {
    "gizmo": {
      "url": "https://plane.example.com/mcp",
      "headers": {
        "Authorization": "Bearer plane_api_xxx",
        "X-Workspace-Slug": "acme"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http gizmo https://plane.example.com/mcp \
  --header "Authorization: Bearer plane_api_xxx" \
  --header "X-Workspace-Slug: acme"
```

### Claude Desktop и клиенты без поддержки заголовков — через `mcp-remote`

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gizmo": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://plane.example.com/mcp",
        "--header",
        "Authorization:${AUTH_HEADER}",
        "--header",
        "X-Workspace-Slug:acme"
      ],
      "env": { "AUTH_HEADER": "Bearer plane_api_xxx" }
    }
  }
}
```

Значение заголовка передаётся через переменную окружения, чтобы пробел в `Bearer <token>`
не ломал аргументы (известная проблема `mcp-remote` в Claude Desktop на Windows).

### Проверка вручную

```bash
curl -s https://plane.example.com/mcp \
  -H "Authorization: Bearer plane_api_xxx" -H "X-Workspace-Slug: acme" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

## 3. Инструменты

Задачу можно указывать ключом (`WEB-123`) или UUID (тогда нужен ещё `project`).
Проект — UUID или идентификатор (`WEB`). Состояния, метки, теги, циклы и модули можно
передавать по имени. Постраничные списки возвращают не больше 100 элементов за вызов и `next_cursor`.
При разрешении имён сервер просматривает до 20 страниц; для больших наборов используйте UUID.
Фильтры `list_work_items` и `list_intake` применяются к текущей странице.

| Группа     | Инструменты                                                                                   | Скоуп                 |
| ---------- | --------------------------------------------------------------------------------------------- | --------------------- |
| Контекст   | `whoami`, `list_projects`, `get_project`, `list_members`, `list_states`, `list_labels`        | read                  |
|            | `create_label`                                                                                | issues:write          |
| Задачи     | `search_work_items`, `get_work_item`, `list_work_items`                                       | read                  |
|            | `create_work_item`, `update_work_item`, `set_deadline`                                        | issues:write          |
|            | `delete_work_item` (destructive, требует `confirm: true`)                                     | issues:delete         |
| Обсуждение | `list_comments`, `list_activity`                                                              | read                  |
|            | `add_comment` (с `reply_to_comment_id` — ответ в ветке), `update_comment`                     | comments:write        |
|            | `add_link`                                                                                    | issues:write          |
| Циклы      | `list_cycles` / `create_cycle`, `add_work_items_to_cycle`, `transfer_cycle_work_items`        | read / cycles:write   |
| Модули     | `list_modules` / `add_work_items_to_module`                                                   | read / modules:write  |
| Intake     | `list_intake` / `triage_intake`                                                               | read / intake:write   |
| Теги       | `list_tags` / `create_tag`, `set_work_item_tags`                                              | read / tags:write     |
| Лимиты     | `get_time_budget` (месячный лимит часов проекта или модуля и сколько уже использовано)        | read                  |
| Время      | `list_worklogs`, `time_report` / `log_time`, `update_worklog`, `delete_worklog` (destructive) | read / worklogs:write |

У инструментов есть аннотации `readOnlyHint` / `destructiveHint`, клиенты используют их для
подтверждений.

Ресурсы: `gizmo://workspace/{slug}/projects`, `gizmo://workspace/{slug}/tags`,
`gizmo://project/{project}/states|labels|members`, `gizmo://work-item/{PROJ-123}`.

Промпты: `triage_inbox`, `daily_standup`, `plan_cycle`, `summarize_work_item`, `log_my_day`.

### Ветки комментариев

`list_comments` возвращает у каждого комментария поле `reply_to_comment_id` (у ответов это id комментария, на который
отвечают, у первого комментария ветки — `null`), поэтому ветку можно собрать целиком. `add_comment` с
`reply_to_comment_id` создаёт ответ: он попадает в ту же ветку и наследует видимость корневого комментария.
Автор исходного комментария получает уведомление об ответе.

### Новые эндпоинты публичного API

Добавлены для MCP, доступны и обычным интеграциям:

- `GET|POST /api/v1/workspaces/{slug}/tags/`, `GET|PATCH|DELETE .../tags/{id}/`
- `GET|PUT /api/v1/workspaces/{slug}/projects/{project_id}/work-items/{id}/tags/` — `{"tag_ids": [...]}`
- `GET|POST .../work-items/{id}/worklogs/`, `PATCH|DELETE .../worklogs/{worklog_id}/` —
  через публичный API можно менять и удалять только свои записи (админы правят чужие в приложении)
- `GET /api/v1/workspaces/{slug}/projects/{project_id}/time-budget/` и
  `GET .../projects/{project_id}/modules/{module_id}/time-budget/` — месячный лимит часов и расход (только чтение)
- `GET /api/v1/workspaces/{slug}/time-report/?date_from&date_to&project_id&issue_id&user_id=me&group_by=user|issue|project|day`

## 4. Безопасность

- Все права и скоупы проверяет Django; MCP-сервер не хранит токены и не держит сессий.
- Неактивные пользователи не могут использовать API-токены. Изменять и удалять чужие
  комментарии могут только администраторы проекта, workspace или инстанса.
- Отчёт времени доступен участникам в пределах их проектов; администраторы workspace
  и инстанса сохраняют доступ ко всем проектам соответствующего workspace.
- Проверка `Origin`: запросы из браузера принимаются только с `APP_BASE_URL` и
  `MCP_ALLOWED_ORIGINS`. Запросы без `Origin` (CLI, IDE) разрешены.
- Только HTTPS снаружи: TLS терминирует nginx, MCP доступен лишь через proxy.
- Содержимое задач и комментариев агент получает как данные; в инструкциях сервера и промптах
  агенту явно сказано не выполнять инструкции из этих данных.
- Удаление задач — только со скоупом `issues:delete` и `confirm: true`.
- Списывать время за других через API нельзя.
- Мессенджер и отправка почты через MCP не реализованы (отложено).
- Администратор может выключить MCP целиком или отозвать любой токен в God Mode (раздел 5).

## 5. Управление MCP в God Mode

Страница **God Mode → MCP для AI-агентов** (доступна администраторам экземпляра):

- **Обзор и политика**: состояние контейнера MCP (health), адрес для подключения, главный выключатель, числа
  (токены, использованные за 24 часа, вызовы и ошибки, частые инструменты) и правила для токенов, которые
  пользователи создают сами:
  - разрешить пользователям создавать токены в профиле;
  - допустимые права токена (право `read` обязательно; `issues:delete` по умолчанию не разрешено);
  - максимальный срок токена в днях (0 — без ограничения; без явного срока токен получает этот максимум);
  - лимит запросов токена (формат `120/min`); пользователь его не меняет.
- **Токены**: все MCP-токены экземпляра (владелец, пространство, права, последнее использование, срок). Токен можно
  отозвать, вернуть в работу или удалить. Секрет в списке не показывается.
- **Журнал вызовов**: последние вызовы инструментов за 7 дней (инструмент, статус, время). Работает, пока журнал
  запросов API хранится в PostgreSQL; токены и тела запросов не показываются.
- **Руководство**: как это работает, настройки клиентов, список прав и инструментов, правила безопасности.

Главный выключатель действует на стороне API: при выключенном MCP запросы с MCP-токена и запросы от MCP-сервера
(заголовок `X-Mcp-Tool`) получают отказ с пояснением. Обычные API-токены продолжают работать для своих интеграций.
Настройки кэшируются на несколько секунд. Правила применяются при создании токена; уже созданные токены
администратор отзывает вручную.

API управления: `GET|PATCH /api/instances/mcp/`, `GET /api/instances/mcp/tokens/`,
`PATCH|DELETE /api/instances/mcp/tokens/{id}/`, `GET /api/instances/mcp/activity/`. Для пользователя:
`GET /api/users/me/mcp/`, `POST /api/users/me/mcp/tokens/`, `DELETE /api/users/me/mcp/tokens/{id}/`.

## 6. Деплой и настройка

Сервис `mcp` в `docker-compose.yml` (образ `apps/mcp/Dockerfile.mcp`, собирается `setup.sh` /
`setup.ps1`). Caddy проксирует `/mcp*` на `mcp:3000` с `flush_interval -1`, в nginx для `/mcp`
выключена буферизация и увеличен таймаут.
Для production-пакета используется отдельный lockfile [`pnpm deploy`](https://pnpm.io/10.x/cli/deploy),
чтобы установка из кеша не требовала повторного разрешения зависимостей разработки.

Переменные окружения (`apps/mcp/.env.example`):

| Переменная               | По умолчанию      | Описание                                                         |
| ------------------------ | ----------------- | ---------------------------------------------------------------- |
| `PORT`                   | `3000`            | порт сервера                                                     |
| `API_BASE_URL`           | `http://api:8000` | внутренний адрес Django                                          |
| `APP_BASE_URL`           | `${APP_HOST}`     | публичный адрес, для ссылок на задачи и проверки Origin          |
| `DEFAULT_WORKSPACE_SLUG` | —                 | workspace по умолчанию (в compose: `MCP_DEFAULT_WORKSPACE_SLUG`) |
| `MCP_ALLOWED_ORIGINS`    | —                 | дополнительные разрешённые Origin через запятую                  |
| `API_TIMEOUT_MS`         | `20000`           | таймаут запроса к API                                            |

После обновления примените миграции (`0133_apitoken_scopes`) — это делает контейнер `migrator`.
Миграции `0138_time_budget_scopes` (лимиты часов), `0139_apitoken_source` (признак MCP-токена) и
`license.0008_mcpsettings` (политика MCP) добавляют только новые таблицы и поля, поэтому старая версия кода работает с
ними во время бесшовной выкатки. Миграция `0134_merge_apitoken_scopes_revoke_admin_access` объединяет её с изменениями прав
администраторов, а `0137_merge_mcp_and_client_updates` объединяет с миграциями роли Client,
лимитов времени модулей и ответов на комментарии. Применяйте весь граф через `manage.py migrate`.

## 7. Разработка

```bash
pnpm --filter mcp dev      # сборка в watch-режиме и запуск, читает apps/mcp/.env
pnpm --filter mcp test     # vitest (API замокан)
pnpm --filter mcp check:types
```

Django-тесты: `pytest plane/tests/contract/api/test_token_restrictions.py plane/tests/contract/api/test_tags_worklogs.py`.
