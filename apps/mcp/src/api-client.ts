export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | undefined | null;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly path: string
  ) {
    super(ApiError.describe(status, body));
    this.name = "ApiError";
  }

  static describe(status: number, body: unknown): string {
    let detail = "";
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const message = record.error ?? record.detail ?? record.message;
      detail = typeof message === "string" ? message : JSON.stringify(body);
    } else if (typeof body === "string" && body.length > 0) {
      detail = body.slice(0, 300);
    }
    const hint =
      status === 401
        ? "The API token is missing, invalid or expired."
        : status === 403
          ? "Access denied: check the token scopes, workspace binding and your role in the project."
          : status === 404
            ? "Not found (or not visible to this token)."
            : status === 429
              ? "Rate limit of this API token exceeded, retry later."
              : "";
    return [`Gizmo API returned ${status}.`, hint, detail].filter(Boolean).join(" ");
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Name of the MCP tool doing the call, forwarded for the API audit log */
  toolName?: string;
}

/** Thin client for the Gizmo public REST API (/api/v1). */
export class GizmoApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  withTool(toolName: string): GizmoApiClient {
    return new GizmoApiClient({ ...this.options, fetch: this.fetchImpl, toolName });
  }

  buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.options.baseUrl}/api/v1${cleanPath}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T = unknown>(
    method: string,
    path: string,
    { query, body }: { query?: Record<string, QueryValue>; body?: unknown } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      "X-Api-Key": this.options.apiKey,
      Accept: "application/json",
      "User-Agent": "gizmo-mcp",
    };
    if (this.options.toolName) headers["X-Mcp-Tool"] = this.options.toolName;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(this.buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "error",
      });
      // The timeout covers the response body too, not just receipt of the headers.
      text = await response.text();
    } catch (error) {
      if ((error as Error)?.name === "AbortError") {
        throw new ApiError(504, `Gizmo API did not answer within ${this.timeoutMs} ms`, path);
      }
      throw new ApiError(502, `Gizmo API is unreachable: ${(error as Error)?.message ?? error}`, path);
    } finally {
      clearTimeout(timer);
    }

    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) throw new ApiError(response.status, data, path);
    return data as T;
  }

  get<T = unknown>(path: string, query?: Record<string, QueryValue>) {
    return this.request<T>("GET", path, { query });
  }
  post<T = unknown>(path: string, body?: unknown) {
    return this.request<T>("POST", path, { body: body ?? {} });
  }
  patch<T = unknown>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, { body });
  }
  put<T = unknown>(path: string, body: unknown) {
    return this.request<T>("PUT", path, { body });
  }
  delete<T = unknown>(path: string) {
    return this.request<T>("DELETE", path);
  }
}
