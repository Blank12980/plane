import type { QueryValue } from "./api-client";
import { ToolInputError, type ToolContext } from "./context";

export const MAX_PER_PAGE = 100;
export const DEFAULT_PER_PAGE = 25;
export const MAX_SEARCH_RESULTS = 50;
const MAX_DESCRIPTION_CHARS = 4000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORK_ITEM_KEY_RE = /^([A-Za-z0-9]{1,12})-(\d+)$/;

export const isUuid = (value: string) => UUID_RE.test(value.trim());

type Json = Record<string, unknown>;

export function resolveWorkspace(ctx: ToolContext, explicit?: string): string {
  const slug = explicit?.trim() || ctx.headerWorkspaceSlug?.trim() || ctx.config.defaultWorkspaceSlug;
  if (!slug) {
    throw new ToolInputError(
      "No workspace given. Pass workspace_slug, send the X-Workspace-Slug header or set DEFAULT_WORKSPACE_SLUG."
    );
  }
  if (!/^[a-z0-9_-]+$/i.test(slug)) throw new ToolInputError(`Invalid workspace slug: ${slug}`);
  return slug;
}

export function clampPerPage(perPage?: number): number {
  if (!perPage || perPage < 1) return DEFAULT_PER_PAGE;
  return Math.min(Math.floor(perPage), MAX_PER_PAGE);
}

export function pageQuery(perPage?: number, cursor?: string): Record<string, QueryValue> {
  return { per_page: clampPerPage(perPage), cursor };
}

/** Normalises the API's cursor pagination envelope (or a plain list) into a compact shape. */
export function paginated<T>(data: unknown, map: (item: Json) => T = (item) => item as T) {
  if (Array.isArray(data)) return { results: data.map((item) => map(item as Json)), next_cursor: null };
  const envelope = (data ?? {}) as Json;
  const results = Array.isArray(envelope.results) ? (envelope.results as Json[]) : [];
  return {
    results: results.map(map),
    total_results: envelope.total_results ?? envelope.total_count,
    next_cursor: envelope.next_page_results ? envelope.next_cursor : null,
  };
}

export function listOf(data: unknown): Json[] {
  if (Array.isArray(data)) return data as Json[];
  const envelope = (data ?? {}) as Json;
  return Array.isArray(envelope.results) ? (envelope.results as Json[]) : [];
}

export function stripHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text (or simple markdown) to the HTML the editor stores. HTML input is passed through. */
export function textToHtml(text: string): string {
  const trimmed = text.trim();
  if (/^<([a-z][a-z0-9]*)[\s>]/i.test(trimmed)) return trimmed;
  const paragraphs = trimmed.split(/\n{2,}/).map((block) => escapeHtml(block).replace(/\n/g, "<br />"));
  return paragraphs.map((block) => `<p>${block}</p>`).join("");
}

/** Accepts 90, "90", "90m", "1h", "1h30m", "1.5h", "1:30" and returns minutes. */
export function parseDuration(value: string | number): number {
  if (typeof value === "number") return Math.round(value);
  const input = value.trim().toLowerCase().replace(/\s+/g, "");
  let minutes: number | undefined;
  if (/^\d+$/.test(input)) minutes = Number(input);
  else if (/^\d+:\d{1,2}$/.test(input)) {
    const [h, m] = input.split(":").map(Number);
    minutes = h * 60 + m;
  } else {
    const match = input.match(/^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+)m(?:in)?)?$/);
    if (match && (match[1] || match[2])) {
      minutes = Math.round(Number((match[1] ?? "0").replace(",", ".")) * 60) + Number(match[2] ?? 0);
    }
  }
  if (minutes === undefined || !Number.isFinite(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new ToolInputError(
      `Invalid duration "${value}". Use minutes (90) or forms like 1h30m, 1.5h, 1:30 (max 24h).`
    );
  }
  return minutes;
}

export function workItemUrl(ctx: ToolContext, slug: string, key: string | undefined): string | undefined {
  if (!ctx.config.appBaseUrl || !key) return undefined;
  return `${ctx.config.appBaseUrl}/${slug}/browse/${key}/`;
}

const pick = (item: Json, keys: string[]) => {
  const out: Json = {};
  for (const key of keys) if (item[key] !== undefined) out[key] = item[key];
  return out;
};

export function summarizeWorkItem(item: Json, opts: { identifier?: string; withDescription?: boolean } = {}) {
  const summary: Json = pick(item, [
    "id",
    "sequence_id",
    "name",
    "state",
    "priority",
    "assignees",
    "labels",
    "parent",
    "start_date",
    "target_date",
    "deadline_at",
    "completed_at",
    "estimate_point",
    "project",
    "created_at",
    "updated_at",
  ]);
  const projectIdentifier =
    opts.identifier ?? ((item.project_detail as Json | undefined)?.identifier as string | undefined);
  if (projectIdentifier && item.sequence_id !== undefined) summary.key = `${projectIdentifier}-${item.sequence_id}`;
  if (opts.withDescription) {
    const text = stripHtml(item.description_html);
    summary.description =
      text.length > MAX_DESCRIPTION_CHARS ? `${text.slice(0, MAX_DESCRIPTION_CHARS)}… [truncated]` : text;
  }
  return summary;
}

export function summarizeProject(project: Json) {
  return pick(project, [
    "id",
    "identifier",
    "name",
    "description",
    "network",
    "cycle_view",
    "module_view",
    "intake_view",
    "archived_at",
    "total_members",
  ]);
}

export function summarizeComment(comment: Json) {
  return {
    ...pick(comment, ["id", "actor", "created_at", "updated_at", "edited_at", "access"]),
    comment: stripHtml(comment.comment_html),
  };
}

export async function resolveProject(ctx: ToolContext, slug: string, ref: string): Promise<string> {
  const value = ref.trim();
  if (isUuid(value)) return value;
  const projects = listOf(await ctx.api.get(`/workspaces/${slug}/projects/`, { per_page: MAX_PER_PAGE }));
  const match = projects.find(
    (project) => String(project.identifier).toLowerCase() === value.toLowerCase() || project.name === value
  );
  if (!match) throw new ToolInputError(`Project "${ref}" not found. Use list_projects to see available projects.`);
  return String(match.id);
}

export interface ResolvedWorkItem {
  id: string;
  projectId: string;
  item: Json;
  key?: string;
}

/** Resolves a work item given as PROJ-123 or as UUID (the UUID form needs the project). */
export async function resolveWorkItem(
  ctx: ToolContext,
  slug: string,
  ref: string,
  project?: string
): Promise<ResolvedWorkItem> {
  const value = ref.trim();
  const keyMatch = value.match(WORK_ITEM_KEY_RE);
  if (keyMatch) {
    const item = await ctx.api.get<Json>(`/workspaces/${slug}/work-items/${keyMatch[1].toUpperCase()}-${keyMatch[2]}/`);
    return {
      id: String(item.id),
      projectId: String(item.project ?? item.project_id),
      item,
      key: `${keyMatch[1].toUpperCase()}-${keyMatch[2]}`,
    };
  }
  if (!isUuid(value)) throw new ToolInputError(`"${ref}" is neither a work item key like PROJ-123 nor a UUID.`);
  if (!project) throw new ToolInputError("When the work item is given as UUID, pass project (id or identifier) too.");
  const projectId = await resolveProject(ctx, slug, project);
  const item = await ctx.api.get<Json>(`/workspaces/${slug}/projects/${projectId}/work-items/${value}/`);
  return { id: value, projectId, item };
}

export async function resolveWorkItemIds(
  ctx: ToolContext,
  slug: string,
  refs: string[],
  projectId: string
): Promise<string[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (isUuid(ref)) return ref.trim();
      const resolved = await resolveWorkItem(ctx, slug, ref);
      if (resolved.projectId !== projectId) throw new ToolInputError(`${ref} belongs to another project.`);
      return resolved.id;
    })
  );
}

async function resolveByName(
  ctx: ToolContext,
  path: string,
  refs: string[],
  kind: string,
  listTool: string
): Promise<string[]> {
  if (refs.every(isUuid)) return refs.map((ref) => ref.trim());
  const items = listOf(await ctx.api.get(path, { per_page: MAX_PER_PAGE }));
  return refs.map((ref) => {
    if (isUuid(ref)) return ref.trim();
    const match = items.find((item) => String(item.name).toLowerCase() === ref.trim().toLowerCase());
    if (!match) throw new ToolInputError(`${kind} "${ref}" not found. Use ${listTool} to see available values.`);
    return String(match.id);
  });
}

export async function resolveState(ctx: ToolContext, slug: string, projectId: string, ref: string) {
  const [id] = await resolveByName(
    ctx,
    `/workspaces/${slug}/projects/${projectId}/states/`,
    [ref],
    "State",
    "list_states"
  );
  return id;
}

export function resolveLabels(ctx: ToolContext, slug: string, projectId: string, refs: string[]) {
  return resolveByName(ctx, `/workspaces/${slug}/projects/${projectId}/labels/`, refs, "Label", "list_labels");
}

export function resolveTags(ctx: ToolContext, slug: string, refs: string[]) {
  return resolveByName(ctx, `/workspaces/${slug}/tags/`, refs, "Tag", "list_tags");
}

export function resolveCycle(ctx: ToolContext, slug: string, projectId: string, ref: string) {
  return resolveByName(ctx, `/workspaces/${slug}/projects/${projectId}/cycles/`, [ref], "Cycle", "list_cycles").then(
    ([id]) => id
  );
}

export function resolveModule(ctx: ToolContext, slug: string, projectId: string, ref: string) {
  return resolveByName(ctx, `/workspaces/${slug}/projects/${projectId}/modules/`, [ref], "Module", "list_modules").then(
    ([id]) => id
  );
}
