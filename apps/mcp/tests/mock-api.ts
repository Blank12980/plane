import type { FetchLike } from "../src/api-client";

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown } | unknown;

/** Minimal fake of the Gizmo /api/v1 used instead of the network. Routes are "METHOD /path/". */
export function mockApi(routes: Record<string, Handler>) {
  const calls: RecordedCall[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(input);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    );
    const call: RecordedCall = {
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${method} ${path}`];
    if (!handler) return new Response(JSON.stringify({ error: "not mocked" }), { status: 404 });
    const result = handler(call) as { status?: number; body?: unknown } | undefined;
    const isEnvelope = result && typeof result === "object" && ("status" in result || "body" in result);
    const status = isEnvelope ? (result.status ?? 200) : 200;
    const body = isEnvelope ? result.body : result;
    return new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

export const WS = "acme";
export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
export const STATE_ID = "33333333-3333-4333-8333-333333333333";
export const TAG_ID = "44444444-4444-4444-8444-444444444444";
export const USER_ID = "55555555-5555-4555-8555-555555555555";

export const issue = {
  id: ISSUE_ID,
  sequence_id: 12,
  name: "Fix login",
  description_html: "<p>Steps <b>to</b> reproduce</p>",
  state: STATE_ID,
  priority: "high",
  assignees: [USER_ID],
  labels: [],
  project: PROJECT_ID,
  deadline_at: null,
};

export const baseRoutes: Record<string, Handler> = {
  [`GET /workspaces/${WS}/projects/`]: () => ({
    results: [{ id: PROJECT_ID, identifier: "WEB", name: "Web" }],
    next_page_results: false,
    total_results: 1,
  }),
  [`GET /workspaces/${WS}/work-items/WEB-12/`]: () => issue,
  [`GET /workspaces/${WS}/projects/${PROJECT_ID}/work-items/${ISSUE_ID}/`]: () => issue,
  [`GET /workspaces/${WS}/projects/${PROJECT_ID}/states/`]: () => ({
    results: [{ id: STATE_ID, name: "In Progress", group: "started" }],
  }),
  [`GET /workspaces/${WS}/tags/`]: () => [{ id: TAG_ID, name: "Backend", color: "#112233" }],
  "GET /users/me/": () => ({ id: USER_ID, display_name: "agent", email: "agent@example.com", is_bot: true }),
};
