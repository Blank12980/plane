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

  async getAccess(
    slug: string,
    clientId: string,
    params: { type: "issue" | "page"; search: string; project_id: string; page: number }
  ): Promise<ClientAccessResponse> {
    return (await this.get(`/api/workspaces/${slug}/clients/${clientId}/access/`, { params })).data;
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
