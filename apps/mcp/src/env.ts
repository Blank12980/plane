export interface McpConfig {
  port: number;
  apiBaseUrl: string;
  appBaseUrl: string | undefined;
  defaultWorkspaceSlug: string | undefined;
  allowedOrigins: string[];
  apiTimeoutMs: number;
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const appBaseUrl = env.APP_BASE_URL ? trimSlash(env.APP_BASE_URL) : undefined;
  const allowedOrigins = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => trimSlash(origin.trim()))
    .filter(Boolean);
  if (appBaseUrl) {
    try {
      allowedOrigins.push(new URL(appBaseUrl).origin);
    } catch {
      // ignore invalid APP_BASE_URL, links will simply not be generated
    }
  }
  return {
    port: Number(env.PORT ?? 3000),
    apiBaseUrl: trimSlash(env.API_BASE_URL ?? "http://api:8000"),
    appBaseUrl,
    defaultWorkspaceSlug: env.DEFAULT_WORKSPACE_SLUG || undefined,
    allowedOrigins,
    apiTimeoutMs: Number(env.API_TIMEOUT_MS ?? 20000),
  };
}
