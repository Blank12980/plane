import { z } from "zod";

import { resolveModule, resolveProject, resolveWorkspace } from "../helpers";
import { READ_ONLY, defineTool } from "./define";

type Json = Record<string, unknown>;

const hours = (minutes: unknown) => Math.round((Number(minutes ?? 0) / 60) * 100) / 100;

function describeBudget(scope: "project" | "module", data: Json) {
  const limit = data.limit_minutes === null || data.limit_minutes === undefined ? null : Number(data.limit_minutes);
  const used = Number(data.total_minutes ?? 0);
  return {
    scope,
    month: String(data.month ?? "").slice(0, 7),
    limit_hours: limit === null ? null : hours(limit),
    used_hours: hours(used),
    remaining_hours: limit === null ? null : hours(Math.max(limit - used, 0)),
    reached: Boolean(data.reached),
    // what counts towards the limit
    include_subtasks: data.include_subtasks,
    ...(scope === "project"
      ? {
          counts_module_tasks: data.count_module_tasks,
          counts_other_tasks: data.count_other_tasks,
          module_hours: hours(data.module_minutes),
          other_hours: hours(data.other_minutes),
        }
      : {}),
  };
}

export const timeBudgetTools = [
  defineTool({
    name: "get_time_budget",
    title: "Get monthly hours limit",
    description:
      "Shows the monthly hours limit of a project, or of one module when module is given: the limit, the hours used this month and what counts towards it (module tasks, standalone tasks, sub-tasks). The limit is reported to project members once per month when it is reached.",
    scope: "read",
    input: {
      project: z.string().describe("Project id (UUID) or identifier, e.g. WEB"),
      module: z.string().optional().describe("Module id or name; omit to get the limit of the whole project"),
    },
    annotations: READ_ONLY,
    run: async (args, ctx) => {
      const slug = resolveWorkspace(ctx, args.workspace_slug);
      const projectId = await resolveProject(ctx, slug, args.project);
      if (args.module) {
        const moduleId = await resolveModule(ctx, slug, projectId, args.module);
        const data = await ctx.api.get<Json>(
          `/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/time-budget/`
        );
        return describeBudget("module", data ?? {});
      }
      const data = await ctx.api.get<Json>(`/workspaces/${slug}/projects/${projectId}/time-budget/`);
      return describeBudget("project", data ?? {});
    },
  }),
];
