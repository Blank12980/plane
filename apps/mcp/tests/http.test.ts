import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { loadConfig } from "../src/env";
import { USER_ID, WS, baseRoutes, mockApi } from "./mock-api";

let server: Server | undefined;

async function start() {
  const api = mockApi(baseRoutes);
  const app = createApp({
    config: loadConfig({ APP_BASE_URL: "https://pm.example.com", API_BASE_URL: "http://api:8000" }),
    fetch: api.fetch,
  });
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

const rpc = (id: number, method: string, params: object = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("HTTP transport", () => {
  it("serves the health check", async () => {
    const { url } = await start();
    const response = await fetch(`${url}/mcp/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "OK", name: "gizmo" });
  });

  it("requires a token", async () => {
    const { url } = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers, body: rpc(1, "tools/list") });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("rejects foreign browser origins but allows the app origin", async () => {
    const { url } = await start();
    const foreign = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer t", Origin: "https://evil.example" },
      body: rpc(1, "tools/list"),
    });
    expect(foreign.status).toBe(403);
    const own = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer t", Origin: "https://pm.example.com" },
      body: rpc(1, "tools/list"),
    });
    expect(own.status).toBe(200);
  });

  it("does not offer server streams or sessions (stateless)", async () => {
    const { url } = await start();
    expect((await fetch(`${url}/mcp`, { headers: { Authorization: "Bearer t" } })).status).toBe(405);
    expect((await fetch(`${url}/mcp`, { method: "DELETE", headers: { Authorization: "Bearer t" } })).status).toBe(405);
  });

  it.each(["GET", "DELETE"])("checks the origin for %s too", async (method) => {
    const { url } = await start();
    const response = await fetch(`${url}/mcp`, { method, headers: { Origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  it.each([
    ["{", 400, -32700],
    [JSON.stringify({ text: "x".repeat(1024 * 1024) }), 413, -32000],
  ])("returns a JSON-RPC error for invalid request bodies", async (body, status, code) => {
    const { url } = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { ...headers, Authorization: "Bearer t" },
      body: String(body),
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code }, id: null });
  });

  it("keeps tokens isolated between simultaneous callers", async () => {
    const { url, api } = await start();
    await Promise.all(
      ["first", "second"].map(async (token, index) => {
        const response = await fetch(`${url}/mcp`, {
          method: "POST",
          headers: { ...headers, Authorization: `Bearer ${token}` },
          body: rpc(index + 1, "tools/call", { name: "whoami", arguments: {} }),
        });
        expect(response.status).toBe(200);
      })
    );
    expect(api.calls.map((call) => call.headers["x-api-key"]).toSorted()).toEqual(["first", "second"]);
  });

  it("works end to end with the SDK client and forwards the bearer token as X-Api-Key", async () => {
    const { url, api } = await start();
    const client = new Client({ name: "e2e", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
      requestInit: { headers: { Authorization: "Bearer plane_api_secret", "X-Workspace-Slug": WS } },
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(30);
    const result = (await client.callTool({ name: "whoami", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0].text)).toMatchObject({ user: { id: USER_ID }, workspace_slug: WS });
    expect(api.calls.at(-1)?.headers["x-api-key"]).toBe("plane_api_secret");
    expect(api.calls.at(-1)?.headers["x-mcp-tool"]).toBe("whoami");
    await client.close();
  });
});
