/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TIssueWorkLog, TIssueWorkLogPayload } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export class IssueWorkLogService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private baseUrl(workspaceSlug: string, projectId: string, issueId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/worklogs/`;
  }

  async getWorkLogs(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueWorkLog[]> {
    return this.get(this.baseUrl(workspaceSlug, projectId, issueId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createWorkLog(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: TIssueWorkLogPayload
  ): Promise<TIssueWorkLog> {
    return this.post(this.baseUrl(workspaceSlug, projectId, issueId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateWorkLog(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    workLogId: string,
    data: Partial<TIssueWorkLogPayload>
  ): Promise<TIssueWorkLog> {
    return this.patch(`${this.baseUrl(workspaceSlug, projectId, issueId)}${workLogId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteWorkLog(workspaceSlug: string, projectId: string, issueId: string, workLogId: string): Promise<void> {
    return this.delete(`${this.baseUrl(workspaceSlug, projectId, issueId)}${workLogId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
