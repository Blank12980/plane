import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { GizmoApiClient } from "../src/api-client";
import { loadConfig } from "../src/env";
import { createMcpServer } from "../src/server";
import { ISSUE_ID, PROJECT_ID, STATE_ID, TAG_ID, USER_ID, WS, baseRoutes, issue, mockApi } from "./mock-api";

let activeClient: Client | undefined;

async function connect(routes: Parameters<typeof mockApi>[0] = {}, opts: { workspace?: string | null } = {}) {
  const api = mockApi({ ...baseRoutes, ...routes });
  const config = {
    ...loadConfig({ APP_BASE_URL: "https://pm.example.com" }),
    defaultWorkspaceSlug: opts.workspace === null ? undefined : (opts.workspace ?? WS),
  };
  const server = createMcpServer({
    api: new GizmoApiClient({ baseUrl: "http://api:8000", apiKey: "plane_api_test", fetch: api.fetch }),
    config,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  activeClient = client;
  return { client, api };
}

const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const result = (await c.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };
  const text = result.content[0]?.text ?? "";
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // plain text error
  }
  return { isError: Boolean(result.isError), data, text };
};

afterEach(async () => {
  await activeClient?.close();
  activeClient = undefined;
});

describe("tool catalogue", () => {
  it("exposes the planned tools with safety annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).toSorted();
    expect(names).toEqual(
      [
        "add_comment",
        "add_link",
        "add_work_items_to_cycle",
        "add_work_items_to_module",
        "create_cycle",
        "create_label",
        "create_tag",
        "create_work_item",
        "delete_work_item",
        "delete_worklog",
        "get_project",
        "get_time_budget",
        "get_work_item",
        "list_activity",
        "list_comments",
        "list_cycles",
        "list_intake",
        "list_labels",
        "list_members",
        "list_modules",
        "list_projects",
        "list_states",
        "list_tags",
        "list_work_items",
        "list_workspaces",
        "list_worklogs",
        "log_time",
        "search_work_items",
        "set_deadline",
        "set_work_item_tags",
        "time_report",
        "transfer_cycle_work_items",
        "triage_intake",
        "update_comment",
        "update_work_item",
        "update_worklog",
        "whoami",
      ].toSorted()
    );
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.list_projects.annotations?.readOnlyHint).toBe(true);
    expect(byName.delete_work_item.annotations?.destructiveHint).toBe(true);
    expect(byName.delete_worklog.annotations?.destructiveHint).toBe(true);
    expect(byName.create_work_item.annotations?.readOnlyHint).toBe(false);
    expect(byName.create_work_item.annotations?.destructiveHint).toBe(false);
    expect(byName.delete_work_item.description).toContain("issues:delete");
    // every tool accepts an explicit workspace
    for (const tool of tools) expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("workspace_slug");
  });

  it("exposes prompts and resource templates", async () => {
    const { client } = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).toSorted()).toEqual(
      ["daily_standup", "log_my_day", "plan_cycle", "summarize_work_item", "triage_inbox"].toSorted()
    );
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.uriTemplate)).toContain("gizmo://work-item/{key}");
    const prompt = await client.getPrompt({ name: "summarize_work_item", arguments: { work_item: "WEB-12" } });
    expect(JSON.stringify(prompt.messages)).toContain("WEB-12");
  });

  it("reads a work item resource", async () => {
    const { client } = await connect();
    const resource = await client.readResource({ uri: "gizmo://work-item/WEB-12" });
    const content = resource.contents[0] as { text: string };
    expect(JSON.parse(content.text)).toMatchObject({ key: "WEB-12", name: "Fix login" });
  });
});

describe("context tools", () => {
  it("whoami returns the token user and workspace", async () => {
    const { client } = await connect();
    const { data } = await call(client, "whoami");
    expect(data).toMatchObject({ user: { id: USER_ID, is_bot: true }, workspace_slug: WS });
  });

  it("errors clearly when no workspace is known", async () => {
    const { client } = await connect({}, { workspace: null });
    const result = await call(client, "list_projects");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("workspace_slug");
  });

  it("list_projects clamps page size and returns the cursor", async () => {
    const { client, api } = await connect({
      [`GET /workspaces/${WS}/projects/`]: () => ({
        results: [{ id: PROJECT_ID, identifier: "WEB", name: "Web", secret_field: "x" }],
        next_page_results: true,
        next_cursor: "100:1:0",
        total_results: 150,
      }),
    });
    const { data } = await call(client, "list_projects", { per_page: 100 });
    expect(api.calls.at(-1)?.query.per_page).toBe("100");
    expect(data.next_cursor).toBe("100:1:0");
    expect(data.results[0]).toEqual({ id: PROJECT_ID, identifier: "WEB", name: "Web" });
  });

  it("rejects page sizes above the limit", async () => {
    const { client } = await connect();
    const result = await call(client, "list_projects", { per_page: 1000 });
    expect(result.isError).toBe(true);
  });
});

describe("work item tools", () => {
  it("get_work_item resolves a key and adds tags, time and link", async () => {
    const base = `/workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}`;
    const { client } = await connect({
      [`GET ${base}/tags/`]: () => ({ tag_ids: [TAG_ID], tags: [{ id: TAG_ID, name: "Backend" }] }),
      [`GET ${base}/worklogs/`]: () => ({ total_minutes: 95, results: [] }),
    });
    const { data } = await call(client, "get_work_item", {
      work_item: "web-12",
      include_tags: true,
      include_time: true,
    });
    expect(data).toMatchObject({
      id: ISSUE_ID,
      key: "WEB-12",
      description: "Steps to reproduce",
      tags: [{ id: TAG_ID, name: "Backend" }],
      logged_minutes: 95,
      url: "https://pm.example.com/acme/browse/WEB-12/",
    });
  });

  it("requires the project for UUID references", async () => {
    const { client } = await connect();
    const failed = await call(client, "get_work_item", { work_item: ISSUE_ID });
    expect(failed.isError).toBe(true);
    const ok = await call(client, "get_work_item", { work_item: ISSUE_ID, project: "WEB" });
    expect(ok.data.id).toBe(ISSUE_ID);
  });

  it("create_work_item resolves state by name and converts description and deadline", async () => {
    const { client, api } = await connect({
      [`POST /workspaces/${WS}/projects/${PROJECT_ID}/work-items/`]: (c) => ({
        status: 201,
        body: { ...issue, ...(c.body as object) },
      }),
    });
    const { data, isError } = await call(client, "create_work_item", {
      project: "WEB",
      name: "New task",
      description: "Line <1>",
      state: "in progress",
      priority: "urgent",
      deadline_at: "2026-10-20",
    });
    expect(isError).toBe(false);
    const post = api.calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({
      name: "New task",
      description_html: "<p>Line &lt;1&gt;</p>",
      state: STATE_ID,
      priority: "urgent",
      deadline_at: "2026-10-20T23:59:59Z",
    });
    expect(data.name).toBe("New task");
  });

  it("set_deadline can clear the deadline", async () => {
    const { client, api } = await connect({
      [`PATCH /workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/`]: () => ({
        ...issue,
        deadline_at: null,
      }),
    });
    const { data } = await call(client, "set_deadline", { work_item: "WEB-12", deadline_at: null });
    expect(api.calls.at(-1)?.body).toEqual({ deadline_at: null });
    expect(data.deadline_at).toBeNull();
  });

  it("delete_work_item needs explicit confirmation", async () => {
    const { client, api } = await connect({
      [`DELETE /workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/`]: () => ({ status: 204 }),
    });
    const refused = await call(client, "delete_work_item", { work_item: "WEB-12" });
    expect(refused.isError).toBe(true);
    expect(api.calls.some((c) => c.method === "DELETE")).toBe(false);

    const { data } = await call(client, "delete_work_item", { work_item: "WEB-12", confirm: true });
    expect(data).toMatchObject({ deleted: true, id: ISSUE_ID });
  });

  it("surfaces scope errors from the API as tool errors", async () => {
    const { client } = await connect({
      [`DELETE /workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/`]: () => ({
        status: 403,
        body: { detail: "This API token is missing the 'issues:delete' scope." },
      }),
    });
    const result = await call(client, "delete_work_item", { work_item: "WEB-12", confirm: true });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("issues:delete");
  });

  it("search_work_items maps results to keys and links", async () => {
    const { client, api } = await connect({
      [`GET /workspaces/${WS}/work-items/search/`]: () => ({
        issues: [
          { id: ISSUE_ID, name: "Fix login", sequence_id: 12, project__identifier: "WEB", project_id: PROJECT_ID },
        ],
      }),
    });
    const { data } = await call(client, "search_work_items", { query: "login", limit: 50 });
    expect(api.calls.at(-1)?.query).toMatchObject({ search: "login", limit: "50", workspace_search: "true" });
    expect(data[0]).toMatchObject({ key: "WEB-12", url: "https://pm.example.com/acme/browse/WEB-12/" });
  });
});

describe("comments, tags and time", () => {
  const base = `/workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}`;

  it("add_comment sends HTML", async () => {
    const { client, api } = await connect({
      [`POST ${base}/comments/`]: (c) => ({ status: 201, body: { id: "c1", ...(c.body as object) } }),
    });
    const { data } = await call(client, "add_comment", { work_item: "WEB-12", comment: "Looks good" });
    expect(api.calls.at(-1)?.body).toEqual({ comment_html: "<p>Looks good</p>" });
    expect(data).toMatchObject({ id: "c1", comment: "Looks good" });
  });

  it("add_comment replies inside a thread when reply_to_comment_id is given", async () => {
    const parent = "66666666-6666-4666-8666-666666666666";
    const { client, api } = await connect({
      [`POST ${base}/comments/`]: (c) => ({ status: 201, body: { id: "c2", ...(c.body as object) } }),
    });
    const { data } = await call(client, "add_comment", {
      work_item: "WEB-12",
      comment: "Done",
      reply_to_comment_id: parent,
    });
    expect(api.calls.at(-1)?.body).toEqual({ comment_html: "<p>Done</p>", parent });
    expect(data).toMatchObject({ id: "c2", reply_to_comment_id: parent, comment: "Done" });
  });

  it("list_comments exposes the thread of every comment", async () => {
    const { client } = await connect({
      [`GET ${base}/comments/`]: () => ({
        results: [
          { id: "c1", comment_html: "<p>Root</p>", parent: null },
          { id: "c2", comment_html: "<p>Reply</p>", parent: "c1" },
        ],
      }),
    });
    const { data } = await call(client, "list_comments", { work_item: "WEB-12" });
    expect(data.results.map((item: any) => [item.id, item.reply_to_comment_id])).toEqual([
      ["c1", null],
      ["c2", "c1"],
    ]);
  });

  it("set_work_item_tags resolves names", async () => {
    const { client, api } = await connect({
      [`PUT ${base}/tags/`]: (c) => ({ tag_ids: (c.body as any).tag_ids, tags: [{ id: TAG_ID, name: "Backend" }] }),
    });
    const { data } = await call(client, "set_work_item_tags", { work_item: "WEB-12", tags: ["backend"] });
    expect(api.calls.at(-1)?.body).toEqual({ tag_ids: [TAG_ID] });
    expect(data.tags).toEqual([{ id: TAG_ID, name: "Backend", color: undefined }]);
  });

  it("set_work_item_tags reports unknown tags without calling PUT", async () => {
    const { client, api } = await connect();
    const result = await call(client, "set_work_item_tags", { work_item: "WEB-12", tags: ["nope"] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("list_tags");
    expect(api.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("log_time parses durations", async () => {
    const { client, api } = await connect({
      [`POST ${base}/worklogs/`]: (c) => ({ status: 201, body: { id: "w1", ...(c.body as object) } }),
    });
    const { data } = await call(client, "log_time", {
      work_item: "WEB-12",
      duration: "1h30m",
      description: "review",
      logged_on: "2026-10-08",
    });
    expect(api.calls.at(-1)?.body).toEqual({ duration_minutes: 90, description: "review", logged_on: "2026-10-08" });
    expect(data.duration_minutes).toBe(90);
  });

  it("log_time rejects invalid durations before calling the API", async () => {
    const { client, api } = await connect();
    const result = await call(client, "log_time", { work_item: "WEB-12", duration: "forever" });
    expect(result.isError).toBe(true);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("time_report passes filters", async () => {
    const { client, api } = await connect({
      [`GET /workspaces/${WS}/time-report/`]: () => ({ total_minutes: 30, results: [] }),
    });
    await call(client, "time_report", { project: "WEB", user: "me", group_by: "day", date_from: "2026-10-01" });
    expect(api.calls.at(-1)?.query).toEqual({
      project_id: PROJECT_ID,
      user_id: "me",
      group_by: "day",
      date_from: "2026-10-01",
    });
  });
});

describe("planning tools", () => {
  it("add_work_items_to_cycle resolves keys and cycle names", async () => {
    const cycleId = "66666666-6666-4666-8666-666666666666";
    const { client, api } = await connect({
      [`GET /workspaces/${WS}/projects/${PROJECT_ID}/cycles/`]: () => ({
        results: [{ id: cycleId, name: "Sprint 5" }],
      }),
      [`POST /workspaces/${WS}/projects/${PROJECT_ID}/cycles/${cycleId}/cycle-issues/`]: () => ({
        status: 201,
        body: [],
      }),
    });
    const { data } = await call(client, "add_work_items_to_cycle", {
      project: "WEB",
      cycle: "Sprint 5",
      work_items: ["WEB-12"],
    });
    expect(api.calls.at(-1)?.body).toEqual({ issues: [ISSUE_ID] });
    expect(data.added).toEqual([ISSUE_ID]);
  });

  it("triage_intake maps actions to statuses", async () => {
    const { client, api } = await connect({
      [`PATCH /workspaces/${WS}/projects/${PROJECT_ID}/intake-issues/${ISSUE_ID}/`]: (c) => ({ body: c.body }),
    });
    const snoozeWithoutDate = await call(client, "triage_intake", {
      project: "WEB",
      work_item: ISSUE_ID,
      action: "snooze",
    });
    expect(snoozeWithoutDate.isError).toBe(true);
    const { data } = await call(client, "triage_intake", { project: "WEB", work_item: ISSUE_ID, action: "accept" });
    expect(api.calls.at(-1)?.body).toEqual({ status: 1 });
    expect(data.status).toBe(1);
  });
});

describe("monthly hours limits", () => {
  const MODULE_ID = "77777777-7777-4777-8777-777777777777";

  it("get_time_budget reports the project limit and what counts towards it", async () => {
    const { client } = await connect({
      [`GET /workspaces/${WS}/projects/${PROJECT_ID}/time-budget/`]: () => ({
        month: "2026-10-01",
        limit_minutes: 600,
        count_module_tasks: true,
        count_other_tasks: false,
        include_subtasks: true,
        total_minutes: 450,
        module_minutes: 450,
        other_minutes: 90,
        reached: false,
      }),
    });
    const { data } = await call(client, "get_time_budget", { project: "WEB" });
    expect(data).toMatchObject({
      scope: "project",
      month: "2026-10",
      limit_hours: 10,
      used_hours: 7.5,
      remaining_hours: 2.5,
      reached: false,
      counts_module_tasks: true,
      counts_other_tasks: false,
      module_hours: 7.5,
      other_hours: 1.5,
    });
  });

  it("get_time_budget reads a module by name and handles a missing limit", async () => {
    const { client } = await connect({
      [`GET /workspaces/${WS}/projects/${PROJECT_ID}/modules/`]: () => ({
        results: [{ id: MODULE_ID, name: "Billing" }],
      }),
      [`GET /workspaces/${WS}/projects/${PROJECT_ID}/modules/${MODULE_ID}/time-budget/`]: () => ({
        month: "2026-10-01",
        limit_minutes: null,
        include_subtasks: true,
        total_minutes: 90,
        reached: false,
      }),
    });
    const { data } = await call(client, "get_time_budget", { project: "WEB", module: "Billing" });
    expect(data).toMatchObject({ scope: "module", limit_hours: null, remaining_hours: null, used_hours: 1.5 });
    expect(data.counts_module_tasks).toBeUndefined();
  });
});

describe("tokens for several workspaces", () => {
  it("list_workspaces tells the agent which workspaces it can use", async () => {
    const { client } = await connect(
      {
        "GET /users/me/workspaces/": () => [
          { slug: "acme", name: "Acme", extra: 1 },
          { slug: "beta", name: "Beta" },
        ],
      },
      { workspace: null }
    );
    const { data } = await call(client, "list_workspaces");
    expect(data).toEqual([
      { slug: "acme", name: "Acme" },
      { slug: "beta", name: "Beta" },
    ]);
  });

  it("without a workspace the error points to list_workspaces", async () => {
    const { client } = await connect({}, { workspace: null });
    const result = await call(client, "list_projects");
    expect(result.isError).toBe(true);
    expect(result.text).toContain("list_workspaces");
  });
});
