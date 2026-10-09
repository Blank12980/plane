import { z } from "zod";

import { ToolInputError } from "../context";
import {
  MAX_PER_PAGE,
  MAX_SEARCH_RESULTS,
  pageQuery,
  paginated,
  resolveLabels,
  resolveProject,
  resolveState,
  resolveWorkItem,
  resolveWorkspace,
  summarizeWorkItem,
  textToHtml,
  workItemUrl,
} from "../helpers";
import type { ToolContext } from "../context";
import { DESTRUCTIVE, READ_ONLY, WRITE, IDEMPOTENT_WRITE, defineTool } from "./define";

export const workItemRef = z.string().describe("Work item key like WEB-123, or its UUID (then also pass project)");
const project = z.string().describe("Project id (UUID) or identifier, e.g. WEB");
const priority = z.enum(["urgent", "high", "medium", "low", "none"]);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date in YYYY-MM-DD");
const deadline = z
  .string()
  .datetime({ offset: true })
  .or(date)
  .describe("Deadline as ISO date-time (2026-10-20T18:00:00+03:00) or date (YYYY-MM-DD, end of day UTC)");

export function normalizeDeadline(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value;
}

const editableFields = {
  description: z.string().optional().describe("Description as plain text/markdown or HTML"),
  state: z.string().optional().describe("State id or name (see list_states)"),
  priority: priority.optional(),
  assignees: z.array(z.string().uuid()).max(20).optional().describe("User ids (see list_members)"),
  labels: z.array(z.string()).max(20).optional().describe("Label ids or names (see list_labels)"),
  start_date: date.nullable().optional(),
  target_date: date.nullable().optional(),
  deadline_at: deadline.nullable().optional(),
  parent: z.string().uuid().nullable().optional().describe("Parent work item id"),
};

type EditableArgs = {
  name?: string;
  description?: string;
  state?: string;
  priority?: string;
  assignees?: string[];
  labels?: string[];
  start_date?: string | null;
  target_date?: string | null;
  deadline_at?: string | null;
  parent?: string | null;
};

async function buildPayload(ctx: ToolContext, slug: string, projectId: string, args: EditableArgs) {
  const payload: Record<string, unknown> = {};
  if (args.name !== undefined) payload.name = args.name;
  if (args.description !== undefined) payload.description_html = textToHtml(args.description);
  if (args.state !== undefined) payload.state = await resolveState(ctx, slug, projectId, args.state);
  if (args.priority !== undefined) payload.priority = args.priority;
  if (args.assignees !== undefined) payload.assignees = args.assignees;
  if (args.labels !== undefined) payload.labels = await resolveLabels(ctx, slug, projectId, args.labels);
  if (args.start_date !== undefined) payload.start_date = args.start_date;
  if (args.target_date !== undefined) payload.target_date = args.target_date;
  if (args.deadline_at !== undefined) payload.deadline_at = normalizeDeadline(args.deadline_at);
  if (args.parent !== undefined) payload.parent = args.parent;
  return payload;
}

export const workItemTools = [
  defineTool({
    name: "search_work_items",
    title: "Search work items",
    description: "Full text search over work item names and keys (e.g. 'login bug' or 'WEB-12').",
    scope: "read",
    input: {
      query: z.string().min(1).max(200),
      project: project.optional().describe("Limit the search to one project"),
      limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
    },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = args.project ? await resolveProject(ctx, slug, args.project) : undefined;
      const data = await ctx.api.get<{ issues?: Record<string, unknown>[] }>(`/workspaces/${slug}/work-items/search/`, {
        search: args.query,
        limit: Math.min(args.limit ?? 10, MAX_SEARCH_RESULTS),
        project_id: projectId,
        workspace_search: projectId ? "false" : "true",
      });
      return (data?.issues ?? []).map((issue) => {
        const key = `${issue.project__identifier}-${issue.sequence_id}`;
        return { id: issue.id, key, name: issue.name, project_id: issue.project_id, url: workItemUrl(ctx, slug, key) };
      });
    },
  }),
  defineTool({
    name: "get_work_item",
    title: "Get work item",
    description:
      "Returns a work item with its description. Accepts a key like WEB-123 or a UUID + project. " +
      "Optionally includes tags and logged time.",
    scope: "read",
    input: {
      work_item: workItemRef,
      project: project.optional(),
      include_tags: z.boolean().optional(),
      include_time: z.boolean().optional().describe("Include total logged minutes"),
    },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const resolved = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const result: Record<string, unknown> = {
        ...summarizeWorkItem(resolved.item, { withDescription: true }),
        ...(resolved.key ? { key: resolved.key } : {}),
      };
      const key = (result.key as string | undefined) ?? resolved.key;
      if (key) result.url = workItemUrl(ctx, slug, key);
      const base = `/workspaces/${slug}/projects/${resolved.projectId}/work-items/${resolved.id}`;
      if (args.include_tags) {
        const tags = await ctx.api.get<{ tags?: Record<string, unknown>[] }>(`${base}/tags/`);
        result.tags = (tags?.tags ?? []).map((tag) => ({ id: tag.id, name: tag.name }));
      }
      if (args.include_time) {
        const logs = await ctx.api.get<{ total_minutes?: number }>(`${base}/worklogs/`);
        result.logged_minutes = logs?.total_minutes ?? 0;
      }
      return result;
    },
  }),
  defineTool({
    name: "list_work_items",
    title: "List work items",
    description:
      "Lists work items of a project, newest first by default, with cursor pagination. " +
      "Filters state/priority/assignee are applied to the returned page only; use search_work_items for lookups.",
    scope: "read",
    input: {
      project,
      per_page: z.number().int().min(1).max(MAX_PER_PAGE).optional(),
      cursor: z.string().optional(),
      order_by: z
        .enum([
          "-created_at",
          "created_at",
          "-updated_at",
          "updated_at",
          "priority",
          "-priority",
          "sequence_id",
          "-sequence_id",
        ])
        .optional(),
      state: z.string().uuid().optional().describe("Only keep items in this state id"),
      priority: priority.optional(),
      assignee: z.string().uuid().optional().describe("Only keep items assigned to this user id"),
    },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      const data = await ctx.api.get(`/workspaces/${slug}/projects/${projectId}/work-items/`, {
        ...pageQuery(args.per_page, args.cursor),
        order_by: args.order_by,
      });
      const page = paginated(data, (item) => item);
      const results = page.results
        .filter((item) => !args.state || item.state === args.state)
        .filter((item) => !args.priority || item.priority === args.priority)
        .filter((item) => !args.assignee || (Array.isArray(item.assignees) && item.assignees.includes(args.assignee)))
        .map((item) => summarizeWorkItem(item));
      return { ...page, results };
    },
  }),
  defineTool({
    name: "create_work_item",
    title: "Create work item",
    description: "Creates a work item in a project.",
    scope: "issues:write",
    input: { project, name: z.string().min(1).max(255), ...editableFields },
    annotations: WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      const payload = await buildPayload(ctx, slug, projectId, args);
      const created = await ctx.api.post<Record<string, unknown>>(
        `/workspaces/${slug}/projects/${projectId}/work-items/`,
        payload
      );
      return summarizeWorkItem(created ?? {});
    },
  }),
  defineTool({
    name: "update_work_item",
    title: "Update work item",
    description:
      "Updates fields of a work item (name, description, state, priority, assignees, labels, dates, deadline_at).",
    scope: "issues:write",
    input: {
      work_item: workItemRef,
      project: project.optional(),
      name: z.string().min(1).max(255).optional(),
      ...editableFields,
    },
    annotations: IDEMPOTENT_WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const resolved = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const payload = await buildPayload(ctx, slug, resolved.projectId, args);
      if (Object.keys(payload).length === 0) throw new ToolInputError("Nothing to update.");
      const updated = await ctx.api.patch<Record<string, unknown>>(
        `/workspaces/${slug}/projects/${resolved.projectId}/work-items/${resolved.id}/`,
        payload
      );
      return summarizeWorkItem(updated ?? {});
    },
  }),
  defineTool({
    name: "set_deadline",
    title: "Set deadline",
    description: "Sets or clears (deadline_at: null) the deadline of a work item.",
    scope: "issues:write",
    input: { work_item: workItemRef, project: project.optional(), deadline_at: deadline.nullable() },
    annotations: IDEMPOTENT_WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const resolved = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const updated = await ctx.api.patch<Record<string, unknown>>(
        `/workspaces/${slug}/projects/${resolved.projectId}/work-items/${resolved.id}/`,
        { deadline_at: normalizeDeadline(args.deadline_at) }
      );
      return { id: resolved.id, deadline_at: updated?.deadline_at ?? null, target_date: updated?.target_date ?? null };
    },
  }),
  defineTool({
    name: "delete_work_item",
    title: "Delete work item",
    description:
      "Deletes a work item. Irreversible from the agent's point of view: only use when the user explicitly asked. " +
      "Pass confirm: true.",
    scope: "issues:delete",
    input: { work_item: workItemRef, project: project.optional(), confirm: z.literal(true) },
    annotations: DESTRUCTIVE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const resolved = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      await ctx.api.delete(`/workspaces/${slug}/projects/${resolved.projectId}/work-items/${resolved.id}/`);
      return { deleted: true, id: resolved.id, name: resolved.item.name };
    },
  }),
];
