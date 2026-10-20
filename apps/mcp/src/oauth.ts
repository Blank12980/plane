import { createHash } from "node:crypto";
import type { Request } from "express";

import { ApiError, GizmoApiClient, type FetchLike } from "./api-client";
import type { McpConfig } from "./env";

/** Access tokens issued by the OAuth authorization server of Gizmo (see apps/api plane.utils.oauth). */
export const OAUTH_TOKEN_PREFIX = "plane_oauth_";

const CACHE_SECONDS = 30;
const MAX_CACHE_ENTRIES = 1000;

export interface TokenInfo {
  source: string | null;
  scopes: string[];
  /** Workspace the token is bound to, if any */
  workspace: string | null;
  /** Workspaces the token can work in */
  workspaces: string[];
}

export function isOAuthToken(token: string): boolean {
  return token.startsWith(OAUTH_TOKEN_PREFIX);
}

/** The public origin of this instance: configured, or taken from the proxy headers of the request. */
export function publicOrigin(req: Request, config: McpConfig): string {
  if (config.appBaseUrl) return new URL(config.appBaseUrl).origin;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim();
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = ((Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? req.headers.host ?? "")
    .split(",")[0]
    .trim();
  return `${proto === "http" || proto === "https" ? proto : req.protocol}://${host}`;
}

/** The WWW-Authenticate challenge of RFC 9728 that points OAuth capable clients (ChatGPT, ...) to the metadata. */
export function bearerChallenge(req: Request, config: McpConfig, error?: { code: string; description: string }) {
  const parts = ['realm="gizmo-mcp"'];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  parts.push(`resource_metadata="${publicOrigin(req, config)}/.well-known/oauth-protected-resource/mcp"`);
  return `Bearer ${parts.join(", ")}`;
}

export type Verification =
  | { ok: true; info: TokenInfo }
  | { ok: false; reason: "invalid" | "unavailable"; message: string };

/**
 * Checks an OAuth access token before a request is served. The token is also checked by the API on every call, but
 * only an HTTP 401 from this server makes an OAuth client refresh the token, so expiry has to surface here.
 */
export class TokenVerifier {
  private readonly cache = new Map<string, { until: number; info: TokenInfo }>();

  constructor(
    private readonly config: McpConfig,
    private readonly fetch?: FetchLike
  ) {}

  async verify(token: string): Promise<Verification> {
    const key = createHash("sha256").update(token).digest("hex");
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return { ok: true, info: cached.info };
    this.cache.delete(key);

    const api = new GizmoApiClient({
      baseUrl: this.config.apiBaseUrl,
      apiKey: token,
      fetch: this.fetch,
      timeoutMs: this.config.apiTimeoutMs,
    }).withTool("oauth_token_check");
    try {
      const data = await api.get<Partial<TokenInfo> & { active?: boolean }>("/users/me/token/");
      if (data.active === false) return { ok: false, reason: "invalid", message: "The access token is not active." };
      const info: TokenInfo = {
        source: data.source ?? null,
        scopes: Array.isArray(data.scopes) ? data.scopes : [],
        workspace: data.workspace ?? null,
        workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
      };
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
      this.cache.set(key, { until: Date.now() + CACHE_SECONDS * 1000, info });
      return { ok: true, info };
    } catch (error) {
      // The API answers a token it does not accept with 401 (or 403 when MCP or OAuth was switched off).
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return { ok: false, reason: "invalid", message: "The access token is invalid, expired or revoked." };
      }
      return { ok: false, reason: "unavailable", message: "The Gizmo API is not reachable." };
    }
  }
}
