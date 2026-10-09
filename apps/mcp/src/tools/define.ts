import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";

import { ApiError } from "../api-client";
import { ToolInputError, type ToolContext } from "../context";

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const IDEMPOTENT_WRITE: ToolAnnotations = { ...WRITE, idempotentHint: true };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

export const workspaceArg = {
  workspace_slug: z
    .string()
    .optional()
    .describe("Workspace slug. Optional when the server or client has a default workspace."),
};

export interface ToolDefinition<S extends ZodRawShape = ZodRawShape> {
  name: string;
  title: string;
  description: string;
  /** API token scope needed (documentation only, enforced by the API) */
  scope: string;
  input: S;
  annotations: ToolAnnotations;
  run: (args: z.objectOutputType<S & typeof workspaceArg, z.ZodTypeAny>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends ZodRawShape>(definition: ToolDefinition<S>): ToolDefinition<S> {
  return definition;
}

export function toolResult(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }] };
}

export function toolError(error: unknown): CallToolResult {
  let message: string;
  if (error instanceof ApiError || error instanceof ToolInputError) message = error.message;
  else if (error instanceof z.ZodError) message = `Invalid input: ${error.issues.map((i) => i.message).join("; ")}`;
  else message = "Unexpected error while calling Gizmo.";
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function registerToolDefinitions(server: McpServer, ctx: ToolContext, definitions: ToolDefinition<any>[]) {
  for (const definition of definitions) {
    const inputSchema = { ...definition.input, ...workspaceArg };
    const description = `${definition.description}\n\nRequired token scope: ${definition.scope}.`;
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description,
        inputSchema,
        annotations: { title: definition.title, ...definition.annotations },
      },
      (async (args: Record<string, unknown>) => {
        const toolCtx: ToolContext = { ...ctx, api: ctx.api.withTool(definition.name) };
        try {
          return toolResult(await definition.run(args as never, toolCtx));
        } catch (error) {
          if (!(error instanceof ApiError) && !(error instanceof ToolInputError)) {
            console.error(`[mcp] tool ${definition.name} failed`, error);
          }
          return toolError(error);
        }
      }) as never
    );
  }
}
