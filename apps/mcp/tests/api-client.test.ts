import { describe, expect, it } from "vitest";

import { ApiError, GizmoApiClient } from "../src/api-client";
import { mockApi } from "./mock-api";

describe("GizmoApiClient", () => {
  it("forwards the token as X-Api-Key and tags the tool name", async () => {
    const api = mockApi({ "GET /users/me/": () => ({ id: "u1" }) });
    const client = new GizmoApiClient({ baseUrl: "http://api:8000", apiKey: "plane_api_x", fetch: api.fetch });
    await client.withTool("whoami").get("/users/me/", { per_page: 10, cursor: undefined });
    expect(api.calls[0].headers["x-api-key"]).toBe("plane_api_x");
    expect(api.calls[0].headers["x-mcp-tool"]).toBe("whoami");
    expect(api.calls[0].query).toEqual({ per_page: "10" });
  });

  it("maps API errors to helpful messages", async () => {
    const api = mockApi({
      "POST /x/": () => ({ status: 403, body: { detail: "This API token is missing the 'issues:write' scope." } }),
    });
    const client = new GizmoApiClient({ baseUrl: "http://api:8000", apiKey: "k", fetch: api.fetch });
    const error = (await client.post("/x/", {}).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.message).toContain("issues:write");
    expect(error.message).toContain("scopes");
  });

  it("reports unreachable API and timeouts", async () => {
    const failing = new GizmoApiClient({
      baseUrl: "http://api:8000",
      apiKey: "k",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(failing.get("/x/")).rejects.toMatchObject({ status: 502 });

    const slow = new GizmoApiClient({
      baseUrl: "http://api:8000",
      apiKey: "k",
      timeoutMs: 10,
      fetch: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        }),
    });
    await expect(slow.get("/x/")).rejects.toMatchObject({ status: 504 });
  });
});
