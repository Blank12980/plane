import { z } from "zod";

import { ToolInputError } from "../context";
import { parseDuration, resolveProject, resolveTags, resolveWorkItem, resolveWorkspace } from "../helpers";
import { DESTRUCTIVE, IDEMPOTENT_WRITE, READ_ONLY, WRITE, defineTool } from "./define";
import { workItemRef } from "./work-items";

const project = z.string().optional().describe("Project id or identifier (needed only for UUID work items)");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Date in YYYY-MM-DD");
const duration = z
  .union([z.number().int().min(1).max(1440), z.string().min(1).max(20)])
  .describe("Minutes (90) or a duration like 1h30m, 1.5h, 1:30");

const base = (slug: string, projectId: string, issueId: string) =>
  `/workspaces/${slug}/projects/${projectId}/work-items/${issueId}`;

type Json = Record<string, unknown>;

const summarizeWorklog = (log: Json) => ({
  id: log.id,
  duration_minutes: log.duration_minutes,
  logged_on: log.logged_on,
  description: log.description,
  logged_by: log.logged_by,
  logged_by_name: (log.logged_by_detail as Json | undefined)?.display_name,
});

const summarizeTag = (tag: Json) => ({ id: tag.id, name: tag.name, color: tag.color });

export const timeAndTagTools = [
  defineTool({
    name: "list_tags",
    title: "List tags",
    description: "Lists workspace tags (shared across all projects).",
    scope: "read",
    input: {},
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const data = await ctx.api.get<Json[]>(`/workspaces/${slug}/tags/`);
      return (data ?? []).map(summarizeTag);
    },
  }),
  defineTool({
    name: "create_tag",
    title: "Create tag",
    description: "Creates a workspace tag. Only workspace admins can do this.",
    scope: "tags:write",
    input: {
      name: z.string().min(1).max(100),
      color: z
        .string()
        .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
        .optional(),
    },
    annotations: WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const created = await ctx.api.post<Json>(`/workspaces/${slug}/tags/`, {
        name: args.name,
        color: args.color ?? "",
      });
      return summarizeTag(created ?? {});
    },
  }),
  defineTool({
    name: "set_work_item_tags",
    title: "Set work item tags",
    description: "Replaces the set of tags on a work item. Pass an empty list to remove all tags.",
    scope: "tags:write",
    input: {
      work_item: workItemRef,
      project,
      tags: z.array(z.string()).max(30).describe("Tag ids or names (see list_tags)"),
    },
    annotations: IDEMPOTENT_WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const item = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const tagIds = args.tags.length ? await resolveTags(ctx, slug, args.tags) : [];
      const result = await ctx.api.put<{ tags?: Json[] }>(`${base(slug, item.projectId, item.id)}/tags/`, {
        tag_ids: tagIds,
      });
      return { work_item_id: item.id, tags: (result?.tags ?? []).map(summarizeTag) };
    },
  }),
  defineTool({
    name: "log_time",
    title: "Log time",
    description: "Logs time spent on a work item for the token's own user.",
    scope: "worklogs:write",
    input: {
      work_item: workItemRef,
      project,
      duration,
      description: z.string().max(2000).optional(),
      logged_on: date.optional().describe("Day the work was done (default: today)"),
    },
    annotations: WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const item = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const created = await ctx.api.post<Json>(`${base(slug, item.projectId, item.id)}/worklogs/`, {
        duration_minutes: parseDuration(args.duration),
        description: args.description ?? "",
        ...(args.logged_on ? { logged_on: args.logged_on } : {}),
      });
      return summarizeWorklog(created ?? {});
    },
  }),
  defineTool({
    name: "list_worklogs",
    title: "List work logs",
    description: "Lists time entries of a work item with the total.",
    scope: "read",
    input: { work_item: workItemRef, project },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const item = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const data = await ctx.api.get<{ total_minutes?: number; results?: Json[] }>(
        `${base(slug, item.projectId, item.id)}/worklogs/`
      );
      return { total_minutes: data?.total_minutes ?? 0, results: (data?.results ?? []).map(summarizeWorklog) };
    },
  }),
  defineTool({
    name: "update_worklog",
    title: "Update work log",
    description: "Changes one of your own time entries.",
    scope: "worklogs:write",
    input: {
      work_item: workItemRef,
      project,
      worklog_id: z.string().uuid(),
      duration: duration.optional(),
      description: z.string().max(2000).optional(),
      logged_on: date.optional(),
    },
    annotations: IDEMPOTENT_WRITE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const item = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      const body: Json = {};
      if (args.duration !== undefined) body.duration_minutes = parseDuration(args.duration);
      if (args.description !== undefined) body.description = args.description;
      if (args.logged_on !== undefined) body.logged_on = args.logged_on;
      if (Object.keys(body).length === 0) throw new ToolInputError("Nothing to update.");
      const updated = await ctx.api.patch<Json>(
        `${base(slug, item.projectId, item.id)}/worklogs/${args.worklog_id}/`,
        body
      );
      return summarizeWorklog(updated ?? {});
    },
  }),
  defineTool({
    name: "delete_worklog",
    title: "Delete work log",
    description: "Deletes one of your own time entries.",
    scope: "worklogs:write",
    input: { work_item: workItemRef, project, worklog_id: z.string().uuid() },
    annotations: DESTRUCTIVE,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const item = await resolveWorkItem(ctx, slug, args.work_item, args.project);
      await ctx.api.delete(`${base(slug, item.projectId, item.id)}/worklogs/${args.worklog_id}/`);
      return { deleted: true, worklog_id: args.worklog_id };
    },
  }),
  defineTool({
    name: "time_report",
    title: "Time report",
    description:
      "Aggregated logged time for projects you are a member of, grouped by user, issue, project or day. " +
      "Use user: 'me' for your own time.",
    scope: "read",
    input: {
      date_from: date.optional(),
      date_to: date.optional(),
      project: z.string().optional().describe("Project id or identifier"),
      work_item: workItemRef.optional(),
      user: z.string().optional().describe("User id or 'me'"),
      group_by: z.enum(["user", "issue", "project", "day"]).optional(),
    },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = args.project ? await resolveProject(ctx, slug, args.project) : undefined;
      const issueId = args.work_item ? (await resolveWorkItem(ctx, slug, args.work_item, projectId)).id : undefined;
      return ctx.api.get(`/workspaces/${slug}/time-report/`, {
        date_from: args.date_from,
        date_to: args.date_to,
        project_id: projectId,
        issue_id: issueId,
        user_id: args.user,
        group_by: args.group_by ?? "user",
      });
    },
  }),
];
