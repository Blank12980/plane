export interface McpConfig {
  port: number;
  apiBaseUrl: string;
  appBaseUrl: string | undefined;
  defaultWorkspaceSlug: string | undefined;
  allowedOrigins: string[];
  apiTimeoutMs: number;
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");

function httpUrl(name: string, value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, a query or a fragment.`);
  }
  return trimSlash(url.href);
}

function integer(name: string, value: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const appBaseUrl = env.APP_BASE_URL ? httpUrl("APP_BASE_URL", env.APP_BASE_URL) : undefined;
  const allowedOrigins = (env.MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      const value = httpUrl("MCP_ALLOWED_ORIGINS", origin);
      if (value !== new URL(value).origin) throw new Error("MCP_ALLOWED_ORIGINS must contain origins without paths.");
      return value;
    });
  if (appBaseUrl) {
    allowedOrigins.push(new URL(appBaseUrl).origin);
  }
  return {
    port: integer("PORT", env.PORT ?? "3000", 1, 65535),
    apiBaseUrl: httpUrl("API_BASE_URL", env.API_BASE_URL ?? "http://api:8000"),
    appBaseUrl,
    defaultWorkspaceSlug: env.DEFAULT_WORKSPACE_SLUG || undefined,
    allowedOrigins,
    apiTimeoutMs: integer("API_TIMEOUT_MS", env.API_TIMEOUT_MS ?? "20000", 1, 2147483647),
  };
}
