import { describe, expect, it } from "vitest";

import { ToolInputError, type ToolContext } from "../src/context";
import { GizmoApiClient } from "../src/api-client";
import { loadConfig } from "../src/env";
import {
  clampPerPage,
  paginated,
  parseDuration,
  resolveProject,
  resolveState,
  resolveWorkspace,
  stripHtml,
  textToHtml,
} from "../src/helpers";
import { mockApi, PROJECT_ID, STATE_ID, WS } from "./mock-api";

const ctx = (defaultWorkspaceSlug?: string, headerWorkspaceSlug?: string) =>
  ({ config: { ...loadConfig({}), defaultWorkspaceSlug }, headerWorkspaceSlug }) as unknown as ToolContext;

describe("parseDuration", () => {
  it.each([
    [90, 90],
    ["45", 45],
    ["45m", 45],
    ["1h", 60],
    ["1h30m", 90],
    ["1.5h", 90],
    ["1,5h", 90],
    ["1:30", 90],
    ["2h 15m", 135],
  ])("parses %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["", "abc", "0", "25h", "-1", "1:60", 0, -1, 1441, 1.5, NaN, Infinity])("rejects %s", (input) => {
    expect(() => parseDuration(input)).toThrow(ToolInputError);
  });
});

describe("text helpers", () => {
  it("converts plain text to escaped HTML paragraphs", () => {
    expect(textToHtml("Hello <script>\nworld\n\nNext")).toBe("<p>Hello &lt;script&gt;<br />world</p><p>Next</p>");
  });
  it("keeps HTML as is", () => {
    expect(textToHtml("<p>ok</p>")).toBe("<p>ok</p>");
  });
  it("strips HTML", () => {
    expect(stripHtml("<p>a &amp; b</p><p>c</p>")).toBe("a & b\nc");
  });
});

describe("pagination", () => {
  function lookupContext(routes: Parameters<typeof mockApi>[0]) {
    const api = mockApi(routes);
    return {
      api,
      context: {
        config: loadConfig({}),
        api: new GizmoApiClient({ baseUrl: "http://api:8000", apiKey: "test", fetch: api.fetch }),
      },
    };
  }

  it("resolves projects and named resources on later pages", async () => {
    const { context } = lookupContext({
      [`GET /workspaces/${WS}/projects/`]: ({ query }) =>
        query.cursor
          ? { results: [{ id: PROJECT_ID, identifier: "WEB" }] }
          : { results: [], next_cursor: "next", next_page_results: true },
      [`GET /workspaces/${WS}/projects/${PROJECT_ID}/states/`]: ({ query }) =>
        query.cursor
          ? { results: [{ id: STATE_ID, name: "Done" }] }
          : { results: [], next_cursor: "next", next_page_results: true },
    });
    expect(await resolveProject(context, WS, "WEB")).toBe(PROJECT_ID);
    expect(await resolveState(context, WS, PROJECT_ID, "Done")).toBe(STATE_ID);
  });

  it("stops when the API repeats a pagination cursor", async () => {
    const { context, api } = lookupContext({
      [`GET /workspaces/${WS}/projects/`]: () => ({ results: [], next_cursor: "same", next_page_results: true }),
    });
    await expect(resolveProject(context, WS, "WEB")).rejects.toThrow("pagination limit");
    expect(api.calls).toHaveLength(2);
  });

  it("clamps page size", () => {
    expect(clampPerPage(undefined)).toBe(25);
    expect(clampPerPage(5000)).toBe(100);
  });
  it("exposes next_cursor only when there is a next page", () => {
    expect(paginated({ results: [1], next_page_results: true, next_cursor: "25:1:0" }).next_cursor).toBe("25:1:0");
    expect(paginated({ results: [1], next_page_results: false, next_cursor: "25:1:0" }).next_cursor).toBeNull();
  });
});

describe("resolveWorkspace", () => {
  it("prefers argument, then header, then default", () => {
    expect(resolveWorkspace(ctx("def", "hdr"), "arg")).toBe("arg");
    expect(resolveWorkspace(ctx("def", "hdr"))).toBe("hdr");
    expect(resolveWorkspace(ctx("def"))).toBe("def");
  });
  it("fails without any workspace and on invalid slugs", () => {
    expect(() => resolveWorkspace(ctx())).toThrow(ToolInputError);
    expect(() => resolveWorkspace(ctx(), "../etc")).toThrow(ToolInputError);
  });
});

describe("loadConfig", () => {
  it.each([
    { PORT: "abc" },
    { PORT: "65536" },
    { API_TIMEOUT_MS: "0" },
    { API_TIMEOUT_MS: "NaN" },
    { API_BASE_URL: "file:///tmp/api" },
    { API_BASE_URL: "http://user:pass@api" },
    { APP_BASE_URL: "javascript:alert(1)" },
    { MCP_ALLOWED_ORIGINS: "https://app.test/path" },
  ])("rejects invalid configuration %o", (env) => {
    expect(() => loadConfig(env)).toThrow();
  });
  it("adds the app origin to allowed origins", () => {
    const config = loadConfig({ APP_BASE_URL: "https://pm.example.com/", MCP_ALLOWED_ORIGINS: "https://a.test" });
    expect(config.allowedOrigins).toEqual(["https://a.test", "https://pm.example.com"]);
    expect(config.apiBaseUrl).toBe("http://api:8000");
  });
});
