import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";

import { GizmoApiClient, type FetchLike } from "./api-client";
import type { McpConfig } from "./env";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server";

export interface AppOptions {
  config: McpConfig;
  fetch?: FetchLike;
}

const MAX_BODY = "1mb";
const MAX_TOKEN_LENGTH = 512;

function jsonRpcError(res: Response, status: number, code: number, message: string) {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

/** Extracts the caller's Gizmo API token from `Authorization: Bearer` or `X-Api-Key`. */
export function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.trim()) return apiKey.trim();
  return undefined;
}

/** Rejects browser requests from origins that are not explicitly allowed (DNS rebinding / CSRF protection). */
export function originGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin.replace(/\/+$/, ""))) return next();
    jsonRpcError(res, 403, -32000, `Origin ${origin} is not allowed`);
  };
}

export function createApp({ config, fetch }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");

  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({ status: "OK", name: SERVER_NAME, version: SERVER_VERSION });
  });

  const handleMcpRequest = async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="gizmo-mcp"');
      jsonRpcError(res, 401, -32001, "Missing Gizmo API token: send Authorization: Bearer <token> or X-Api-Key.");
      return;
    }
    const workspaceHeader = req.headers["x-workspace-slug"];
    const api = new GizmoApiClient({
      baseUrl: config.apiBaseUrl,
      apiKey: token,
      fetch,
      timeoutMs: config.apiTimeoutMs,
    });
    // Stateless mode: a fresh server + transport per request, nothing is shared between callers.
    const server = createMcpServer({
      api,
      config,
      headerWorkspaceSlug: typeof workspaceHeader === "string" ? workspaceHeader : undefined,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request failed", error);
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  };

  router.post("/", originGuard(config.allowedOrigins), express.json({ limit: MAX_BODY }), (req, res) => {
    void handleMcpRequest(req, res);
  });

  // Stateless server: no server-initiated streams and no sessions to delete.
  router.get("/", (_req, res) => jsonRpcError(res, 405, -32000, "Method not allowed"));
  router.delete("/", (_req, res) => jsonRpcError(res, 405, -32000, "Method not allowed"));

  app.use("/mcp", router);
  return app;
}
