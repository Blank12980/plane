import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { loadConfig } from "../src/env";
import { isOAuthToken } from "../src/oauth";
import { USER_ID, WS, baseRoutes, mockApi } from "./mock-api";

let server: Server | undefined;

const OAUTH = "plane_oauth_abc123";

type Routes = Parameters<typeof mockApi>[0];

async function start(extra: Routes = {}, env: Record<string, string> = { APP_BASE_URL: "https://pm.example.com" }) {
  const api = mockApi({ ...baseRoutes, ...extra });
  const app = createApp({ config: loadConfig({ API_BASE_URL: "http://api:8000", ...env }), fetch: api.fetch });
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, api };
}

afterEach(async () => {
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
  server = undefined;
});

const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const rpc = (id: number, method: string, params: object = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const call = (url: string, token: string, name: string, args: object = {}, extra: Record<string, string> = {}) =>
  fetch(`${url}/mcp`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}`, ...extra },
    body: rpc(1, "tools/call", { name, arguments: args }),
  });
const textOf = async (response: Response) =>
  ((await response.json()) as { result: { content: { text: string }[] } }).result.content[0].text;

const tokenInfo =
  (patch: object = {}) =>
  () => ({
    active: true,
    source: "oauth",
    scopes: ["read"],
    workspace: null,
    workspaces: [WS],
    ...patch,
  });

describe("OAuth discovery challenge", () => {
  it("points a client without credentials to the protected resource metadata", async () => {
    const { url } = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers, body: rpc(1, "tools/list") });
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain('resource_metadata="https://pm.example.com/.well-known/oauth-protected-resource/mcp"');
  });

  it("takes the public address from the proxy headers when APP_BASE_URL is not set", async () => {
    const { url } = await start({}, {});
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...headers, "X-Forwarded-Proto": "https", "X-Forwarded-Host": "tracker.example.org" },
      body: rpc(1, "tools/list"),
    });
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://tracker.example.org/.well-known/oauth-protected-resource/mcp"'
    );
  });

  it("recognises OAuth access tokens by their prefix", () => {
    expect(isOAuthToken(OAUTH)).toBe(true);
    expect(isOAuthToken("plane_api_abc")).toBe(false);
  });
});

describe("OAuth access tokens", () => {
  it("answers an expired or revoked token with 401 invalid_token so that the client refreshes it", async () => {
    const { url, api } = await start({ "GET /users/me/token/": () => ({ status: 403, body: { detail: "expired" } }) });
    const response = await call(url, OAUTH, "whoami");
    expect(response.status).toBe(401);
    const challenge = response.headers.get("www-authenticate")!;
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain("resource_metadata=");
    // nothing else was asked of the API
    expect(api.calls.map((item) => item.path)).toEqual(["/users/me/token/"]);
  });

  it("does not call the token a bad one when the API is merely unreachable", async () => {
    const { url } = await start({ "GET /users/me/token/": () => ({ status: 502, body: "bad gateway" }) });
    const response = await call(url, OAUTH, "whoami");
    expect(response.status).toBe(503);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("serves a valid token and uses the workspace it is bound to when the client names none", async () => {
    const { url, api } = await start({ "GET /users/me/token/": tokenInfo({ workspace: WS, workspaces: [WS] }) });
    const response = await call(url, OAUTH, "whoami");
    expect(response.status).toBe(200);
    expect(JSON.parse(await textOf(response))).toMatchObject({ user: { id: USER_ID }, workspace_slug: WS });
    const check = api.calls.find((item) => item.path === "/users/me/token/")!;
    expect(check.headers["x-api-key"]).toBe(OAUTH);
    expect(api.calls.at(-1)?.headers["x-api-key"]).toBe(OAUTH);
  });

  it("uses the only workspace of the user for a token that is not bound", async () => {
    const { url } = await start({ "GET /users/me/token/": tokenInfo({ workspaces: [WS] }) });
    const body = JSON.parse(await textOf(await call(url, OAUTH, "whoami")));
    expect(body.workspace_slug).toBe(WS);
  });

  it("leaves the choice to the model when the user has several workspaces", async () => {
    const { url } = await start({ "GET /users/me/token/": tokenInfo({ workspaces: [WS, "beta"] }) });
    const body = JSON.parse(await textOf(await call(url, OAUTH, "whoami")));
    expect(body.workspace_slug ?? null).toBeNull();
    // an explicit header still wins
    const named = JSON.parse(await textOf(await call(url, OAUTH, "whoami", {}, { "X-Workspace-Slug": "beta" })));
    expect(named.workspace_slug).toBe("beta");
  });

  it("checks a token once for a short while, not on every request", async () => {
    const { url, api } = await start({ "GET /users/me/token/": tokenInfo() });
    await call(url, OAUTH, "whoami");
    await call(url, OAUTH, "whoami");
    expect(api.calls.filter((item) => item.path === "/users/me/token/")).toHaveLength(1);
  });

  it("does not add the check for regular API tokens", async () => {
    const { url, api } = await start();
    const response = await call(url, "plane_api_regular", "whoami", {}, { "X-Workspace-Slug": WS });
    expect(response.status).toBe(200);
    expect(api.calls.some((item) => item.path === "/users/me/token/")).toBe(false);
  });
});
