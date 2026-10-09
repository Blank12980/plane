import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "./context";
import {
  listOf,
  MAX_PER_PAGE,
  resolveProject,
  resolveWorkItem,
  resolveWorkspace,
  summarizeProject,
  summarizeWorkItem,
} from "./helpers";

const json = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value, null, 2) }],
});

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export function registerResources(server: McpServer, ctx: ToolContext) {
  server.registerResource(
    "workspace-projects",
    new ResourceTemplate("gizmo://workspace/{slug}/projects", { list: undefined }),
    { title: "Projects of a workspace", mimeType: "application/json" },
    async (uri, { slug }) => {
      const workspace = resolveWorkspace(ctx, single(slug));
      const data = await ctx.api.get(`/workspaces/${workspace}/projects/`, { per_page: MAX_PER_PAGE });
      return json(uri, listOf(data).map(summarizeProject));
    }
  );

  server.registerResource(
    "workspace-tags",
    new ResourceTemplate("gizmo://workspace/{slug}/tags", { list: undefined }),
    { title: "Workspace tags", mimeType: "application/json" },
    async (uri, { slug }) => {
      const workspace = resolveWorkspace(ctx, single(slug));
      return json(uri, await ctx.api.get(`/workspaces/${workspace}/tags/`));
    }
  );

  for (const kind of ["states", "labels", "members"] as const) {
    server.registerResource(
      `project-${kind}`,
      new ResourceTemplate(`gizmo://project/{project}/${kind}`, { list: undefined }),
      {
        title: `Project ${kind}`,
        description: `Project ${kind}; {project} is the project id or identifier in the default workspace`,
        mimeType: "application/json",
      },
      async (uri, { project }) => {
        const workspace = resolveWorkspace(ctx);
        const projectId = await resolveProject(ctx, workspace, single(project));
        const data = await ctx.api.get(`/workspaces/${workspace}/projects/${projectId}/${kind}/`, {
          per_page: MAX_PER_PAGE,
        });
        return json(uri, listOf(data));
      }
    );
  }

  server.registerResource(
    "work-item",
    new ResourceTemplate("gizmo://work-item/{key}", { list: undefined }),
    { title: "Work item by key (PROJ-123)", mimeType: "application/json" },
    async (uri, { key }) => {
      const workspace = resolveWorkspace(ctx);
      const resolved = await resolveWorkItem(ctx, workspace, single(key));
      return json(uri, { key: resolved.key, ...summarizeWorkItem(resolved.item, { withDescription: true }) });
    }
  );
}
