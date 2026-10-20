import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";

import { GizmoApiClient, type FetchLike } from "./api-client";
import type { McpConfig } from "./env";
import { bearerChallenge, isOAuthToken, TokenVerifier } from "./oauth";
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
  router.use(originGuard(config.allowedOrigins));
  const verifier = new TokenVerifier(config, fetch);

  router.get("/health", (_req, res) => {
    res.json({ status: "OK", name: SERVER_NAME, version: SERVER_VERSION });
  });

  const handleMcpRequest = async (req: Request, res: Response) => {
    const token = extractToken(req);
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      // The challenge also tells OAuth capable clients (ChatGPT, ...) where to find the authorization server.
      res.setHeader("WWW-Authenticate", bearerChallenge(req, config));
      jsonRpcError(
        res,
        401,
        -32001,
        "Missing Gizmo credentials: send Authorization: Bearer <API token or OAuth access token> or X-Api-Key."
      );
      return;
    }
    // OAuth access tokens are short lived. A client only refreshes one after an HTTP 401 from this endpoint, so the
    // token is checked here instead of surfacing as a tool error. The same call tells which workspace it belongs to.
    let tokenWorkspace: string | undefined;
    if (isOAuthToken(token)) {
      const result = await verifier.verify(token);
      if (!result.ok) {
        if (result.reason === "invalid") {
          res.setHeader(
            "WWW-Authenticate",
            bearerChallenge(req, config, { code: "invalid_token", description: result.message })
          );
          jsonRpcError(res, 401, -32001, result.message);
        } else {
          jsonRpcError(res, 503, -32603, result.message);
        }
        return;
      }
      // ChatGPT cannot send an X-Workspace-Slug header: a token bound to one workspace (or a user who has only one)
      // does not need to name it.
      tokenWorkspace =
        result.info.workspace ?? (result.info.workspaces.length === 1 ? result.info.workspaces[0] : undefined);
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
      headerWorkspaceSlug: typeof workspaceHeader === "string" ? workspaceHeader : tokenWorkspace,
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

  router.post("/", express.json({ limit: MAX_BODY }), (req, res) => {
    void handleMcpRequest(req, res);
  });

  // Stateless server: no server-initiated streams and no sessions to delete.
  router.get("/", (_req, res) => jsonRpcError(res, 405, -32000, "Method not allowed"));
  router.delete("/", (_req, res) => jsonRpcError(res, 405, -32000, "Method not allowed"));

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (error as { type?: string })?.type;
    if (type === "entity.parse.failed") jsonRpcError(res, 400, -32700, "Parse error");
    else if (type === "entity.too.large") jsonRpcError(res, 413, -32000, "Request body is too large");
    else next(error);
  });

  app.use("/mcp", router);
  return app;
}
