/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IUserLite } from "./users";

/** Time a member spent on a work item. */
export type TIssueWorkLog = {
  id: string;
  issue: string;
  project: string;
  workspace: string;
  logged_by: string;
  logged_by_detail: IUserLite;
  duration_minutes: number;
  description: string;
  /** Day the work was done, `YYYY-MM-DD`. */
  logged_on: string;
  created_at: string;
  updated_at: string;
};

export type TIssueWorkLogPayload = {
  duration_minutes: number;
  description?: string;
  logged_on?: string;
};
