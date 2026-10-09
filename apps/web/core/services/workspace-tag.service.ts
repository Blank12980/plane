/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TWorkspaceTag, TWorkspaceTagPayload } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export class WorkspaceTagService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async getTags(workspaceSlug: string): Promise<TWorkspaceTag[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/tags/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async createTag(workspaceSlug: string, data: TWorkspaceTagPayload): Promise<TWorkspaceTag> {
    return this.post(`/api/workspaces/${workspaceSlug}/tags/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async updateTag(workspaceSlug: string, tagId: string, data: Partial<TWorkspaceTagPayload>): Promise<TWorkspaceTag> {
    return this.patch(`/api/workspaces/${workspaceSlug}/tags/${tagId}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteTag(workspaceSlug: string, tagId: string): Promise<void> {
    return this.delete(`/api/workspaces/${workspaceSlug}/tags/${tagId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async getIssueTagIds(workspaceSlug: string, projectId: string, issueId: string): Promise<string[]> {
    return this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/tags/`)
      .then((response) => response?.data?.tag_ids ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Replaces the whole set of tags attached to a work item. */
  async setIssueTagIds(workspaceSlug: string, projectId: string, issueId: string, tagIds: string[]): Promise<string[]> {
    return this.put(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/tags/`, {
      tag_ids: tagIds,
    })
      .then((response) => response?.data?.tag_ids ?? [])
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
