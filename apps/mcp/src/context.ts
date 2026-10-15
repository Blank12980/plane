import type { GizmoApiClient } from "./api-client";
import type { McpConfig } from "./env";

/** Per-request context: every MCP request is served with the caller's own API token. */
export interface ToolContext {
  api: GizmoApiClient;
  config: McpConfig;
  /** Workspace slug sent by the client in the X-Workspace-Slug header, if any */
  headerWorkspaceSlug?: string;
}

/** An error whose message is safe and useful to show to the model. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
