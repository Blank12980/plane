/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLogoProps } from "./common";
import type { TIssuePriorities } from "./issues";

export type TRecentActivityFilterKeys = "all item" | "issue" | "page" | "project" | "workspace_page";
export type THomeWidgetKeys =
  | "quick_links"
  | "current_tasks"
  | "recents"
  | "my_stickies"
  | "quick_tutorial"
  | "new_at_plane";

/** What the "current tasks" list can be sorted by. */
export type TCurrentTaskSortField = "readiness" | "priority" | "due_date" | "updated_at" | "project";
export type TCurrentTaskSortRule = { field: TCurrentTaskSortField; direction: "asc" | "desc" };

/** Per user settings of the "current tasks" widget (stored in the widget preference). */
export type TCurrentTasksConfig = {
  sort?: TCurrentTaskSortRule[];
  show_completed?: boolean;
  /** How many tasks are shown before "show all". */
  limit?: number;
};

/** A work item assigned to the signed-in user. */
export type TCurrentTask = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  project_name: string;
  state_id: string | null;
  state_name: string | null;
  state_group: "backlog" | "unstarted" | "started" | "completed" | "cancelled" | null;
  state_color: string | null;
  priority: string;
  target_date: string | null;
  deadline_at: string | null;
  updated_at: string;
  assigned_at: string | null;
  /** Assigned by somebody else and not opened yet. */
  is_new: boolean;
};

export type TCurrentTasksResponse = {
  results: TCurrentTask[];
  has_more: boolean;
  new_count: number;
};

export type THomeWidgetProps = {
  workspaceSlug: string;
};

export type TPageEntityData = {
  id: string;
  name: string;
  logo_props: TLogoProps;
  project_id?: string;
  owned_by: string;
  project_identifier?: string;
};

export type TProjectEntityData = {
  id: string;
  name: string;
  logo_props: TLogoProps;
  project_members: string[];
  identifier: string;
};

export type TIssueEntityData = {
  id: string;
  name: string;
  state: string;
  priority: TIssuePriorities;
  assignees: string[];
  type: string | null;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  is_epic: boolean;
};

export type TActivityEntityData = {
  id: string;
  entity_name: "page" | "project" | "issue" | "workspace_page";
  entity_identifier: string;
  visited_at: string;
  entity_data: TPageEntityData | TProjectEntityData | TIssueEntityData;
};

export type TLinkEditableFields = {
  title: string;
  url: string;
};

export type TLink = TLinkEditableFields & {
  created_by_id: string;
  id: string;
  metadata: any;
  workspace_slug: string;

  //need
  created_at: Date;
};

export type TLinkMap = {
  [workspace_slug: string]: TLink;
};

export type TLinkIdMap = {
  [workspace_slug: string]: string[];
};

export type TWidgetEntityData = {
  key: THomeWidgetKeys;
  name: string;
  is_enabled: boolean;
  sort_order: number;
  /** Widget settings; only "current_tasks" has any. */
  config?: TCurrentTasksConfig;
};
