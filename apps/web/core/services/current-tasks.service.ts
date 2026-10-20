/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TCurrentTasksResponse } from "@plane/types";
import { APIService } from "@/services/api.service";

/** Work items assigned to the signed-in user ("current tasks" on the home page, "new tasks" in the bell). */
export class CurrentTasksService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async list(workspaceSlug: string, includeCompleted = false): Promise<TCurrentTasksResponse> {
    return this.get(`/api/workspaces/${workspaceSlug}/current-tasks/`, {
      params: includeCompleted ? { include_completed: 1 } : undefined,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  /** The user got acquainted with the tasks: without ids every task that is still new stops being new. */
  async markSeen(workspaceSlug: string, issueIds?: string[]): Promise<{ updated: number }> {
    return this.post(`/api/workspaces/${workspaceSlug}/current-tasks/seen/`, issueIds ? { issue_ids: issueIds } : {})
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }
}

export const currentTasksService = new CurrentTasksService();
