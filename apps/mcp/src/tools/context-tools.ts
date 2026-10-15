import { z } from "zod";

import {
  listOf,
  pageQuery,
  paginated,
  resolveProject,
  resolveWorkspace,
  summarizeProject,
  MAX_PER_PAGE,
} from "../helpers";
import { READ_ONLY, WRITE, defineTool } from "./define";

const project = z.string().describe("Project id (UUID) or identifier, e.g. WEB");
const perPage = z.number().int().min(1).max(MAX_PER_PAGE).optional().describe(`Page size (max ${MAX_PER_PAGE})`);
const cursor = z.string().optional().describe("Cursor from next_cursor of a previous call");

export const contextTools = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description: "Returns the user that owns the API token and the workspace the tools will use by default.",
    scope: "read",
    input: {},
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const me = (await ctx.api.get<Record<string, unknown>>("/users/me/")) ?? {};
      let workspace: string | null = null;
      try {
        workspace = resolveWorkspace(ctx, args.workspace_slug);
      } catch {
        workspace = null;
      }
      return {
        user: {
          id: me.id,
          display_name: me.display_name,
          first_name: me.first_name,
          last_name: me.last_name,
          email: me.email,
          is_bot: me.is_bot,
        },
        workspace_slug: workspace,
      };
    },
  }),
  defineTool({
    name: "list_projects",
    title: "List projects",
    description: "Lists projects of the workspace that the token's user can see.",
    scope: "read",
    input: { per_page: perPage, cursor },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const data = await ctx.api.get(`/workspaces/${slug}/projects/`, pageQuery(args.per_page, args.cursor));
      return paginated(data, summarizeProject);
    },
  }),
  defineTool({
    name: "get_project",
    title: "Get project",
    description: "Returns details of one project.",
    scope: "read",
    input: { project },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      return ctx.api.get(`/workspaces/${slug}/projects/${projectId}/`);
    },
  }),
  defineTool({
    name: "list_members",
    title: "List members",
    description:
      "Lists members of a project (when project is given) or of the whole workspace (workspace admin only). Use the ids as assignees.",
    scope: "read",
    input: { project: project.optional() },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const path = args.project
        ? `/workspaces/${slug}/projects/${await resolveProject(ctx, slug, args.project)}/members/`
        : `/workspaces/${slug}/members/`;
      return listOf(await ctx.api.get(path)).map((member) => ({
        id: member.id ?? member.member,
        display_name: member.display_name,
        first_name: member.first_name,
        last_name: member.last_name,
        email: member.email,
        role: member.role,
      }));
    },
  }),
  defineTool({
    name: "list_states",
    title: "List states",
    description: "Lists workflow states of a project (id, name, group: backlog/unstarted/started/completed/cancelled).",
    scope: "read",
    input: { project },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      const data = await ctx.api.get(`/workspaces/${slug}/projects/${projectId}/states/`, { per_page: MAX_PER_PAGE });
      return listOf(data).map((state) => ({
        id: state.id,
        name: state.name,
        group: state.group,
        color: state.color,
        default: state.default,
      }));
    },
  }),
  defineTool({
    name: "list_labels",
    title: "List labels",
    description: "Lists labels of a project.",
    scope: "read",
    input: { project },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      const data = await ctx.api.get(`/workspaces/${slug}/projects/${projectId}/labels/`, { per_page: MAX_PER_PAGE });
      return listOf(data).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        parent: label.parent,
      }));
    },
  }),
  defineTool({
    name: "create_label",
    title: "Create label",
    description: "Creates a label in a project.",
    scope: "issues:write",
    input: {
      project,
      name: z.string().min(1).max(255),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe("Hex color like #3a86ff"),
      description: z.string().optional(),
    },
    annotations: WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      return ctx.api.post(`/workspaces/${slug}/projects/${projectId}/labels/`, {
        name: args.name,
        color: args.color,
        description: args.description,
      });
    },
  }),
];
