/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type ClientResource = {
  resource_type: "issue" | "page";
  resource_id: string;
  name: string;
  project_id: string;
  project_name: string;
};

export type ClientGrant = ClientResource & { id: string; identifier?: string | null };
export type ClientResourceDetail = ClientGrant & {
  description_html: string;
  status?: string | null;
  priority?: string;
  target_date?: string | null;
  deadline_at?: string | null;
  attachments: { id: string; name: string; url: string }[];
  comments?: { id: string; html: string; author: string; created_at: string }[];
};
export type ClientSummary = {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  issue_count: number;
  page_count: number;
};
export type ClientCandidate = {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  /** Workspace role: 3 = client, 5 = guest, 15 = member. */
  role: number;
};
export type ClientCandidatesResponse = {
  project: { id: string; name: string; identifier: string };
  /** Clients of the workspace that are not in the project yet. */
  clients: ClientCandidate[];
  /** Members who could be made clients (workspace administrators only). */
  members: ClientCandidate[];
  can_promote: boolean;
};
export type ClientListResponse = {
  /** Workspace administrators can also turn a member into a client. */
  can_promote: boolean;
  /** Set when the list is scoped to one project (project settings), null for the whole workspace. */
  project: { id: string; name: string; identifier: string } | null;
  clients: ClientSummary[];
};
export type ClientAccessResponse = {
  grants: ClientGrant[];
  resources: ClientResource[];
  projects: { id: string; name: string; identifier: string }[];
  has_more: boolean;
};

export class ClientAccessService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async listClients(slug: string, projectId?: string): Promise<ClientListResponse> {
    return (
      await this.get(`/api/workspaces/${slug}/clients/`, { params: projectId ? { project_id: projectId } : undefined })
    ).data;
  }

  async candidates(slug: string, projectId: string, search: string): Promise<ClientCandidatesResponse> {
    return (
      await this.get(`/api/workspaces/${slug}/clients/candidates/`, {
        params: { project_id: projectId, search: search || undefined },
      })
    ).data;
  }

  async addToProject(
    slug: string,
    projectId: string,
    payload: { client_ids: string[]; promote_member_ids: string[] }
  ): Promise<{ linked: number; promoted: number }> {
    return (await this.post(`/api/workspaces/${slug}/clients/project-links/`, { project_id: projectId, ...payload }))
      .data;
  }

  async removeFromProject(slug: string, projectId: string, clientId: string): Promise<void> {
    await this.delete(`/api/workspaces/${slug}/clients/project-links/${clientId}/`, {
      params: { project_id: projectId },
    });
  }

  async getAccess(
    slug: string,
    clientId: string,
    params: { type: "issue" | "page"; search: string; project_id: string; page: number }
  ): Promise<ClientAccessResponse> {
    // an empty project means "all projects": the parameter is left out instead of being sent empty
    const query = { ...params, project_id: params.project_id || undefined };
    return (await this.get(`/api/workspaces/${slug}/clients/${clientId}/access/`, { params: query })).data;
  }

  async grant(slug: string, clientId: string, resource: ClientResource): Promise<ClientGrant> {
    return (await this.post(`/api/workspaces/${slug}/clients/${clientId}/access/`, resource)).data;
  }

  async revoke(slug: string, clientId: string, grantId: string): Promise<void> {
    await this.delete(`/api/workspaces/${slug}/clients/${clientId}/access/${grantId}/`);
  }

  async resources(slug: string): Promise<ClientGrant[]> {
    return (await this.get(`/api/workspaces/${slug}/client-resources/`)).data;
  }

  async detail(slug: string, grantId: string): Promise<ClientResourceDetail> {
    return (await this.get(`/api/workspaces/${slug}/client-resources/${grantId}/`)).data;
  }
}

export const clientAccessService = new ClientAccessService();
