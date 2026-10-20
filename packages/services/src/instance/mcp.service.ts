/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// gizmo imports
import { API_BASE_URL } from "@plane/constants";
import type {
  TMcpCall,
  TMcpOverview,
  TMcpPolicyUpdate,
  TMcpToken,
  TMcpTokenCreated,
  TMcpUserOverview,
  TMcpUserTokenCreate,
} from "@plane/types";
// api service
import { APIService } from "../api.service";

/**
 * MCP (Model Context Protocol) management.
 * - `admin*` methods are used by God Mode and require an instance administrator.
 * - `user*` methods are used by the profile settings and act on behalf of the signed-in user.
 * @extends {APIService}
 */
export class McpService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  // ---- God Mode ------------------------------------------------------------------------------------------------
  /** Policy, health and usage numbers. */
  async adminOverview(): Promise<TMcpOverview> {
    return this.get("/api/instances/mcp/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async adminUpdateSettings(data: TMcpPolicyUpdate): Promise<TMcpOverview> {
    return this.patch("/api/instances/mcp/", data)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Every MCP token of the instance. */
  async adminTokens(): Promise<TMcpToken[]> {
    return this.get("/api/instances/mcp/tokens/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Revokes (is_active=false) or restores (is_active=true) a token. */
  async adminSetTokenActive(tokenId: string, isActive: boolean): Promise<TMcpToken> {
    return this.patch(`/api/instances/mcp/tokens/${tokenId}/`, { is_active: isActive })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async adminDeleteToken(tokenId: string): Promise<void> {
    return this.delete(`/api/instances/mcp/tokens/${tokenId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Recent tool calls (tool name, status, time; never secrets). */
  async adminActivity(limit = 50): Promise<TMcpCall[]> {
    return this.get("/api/instances/mcp/activity/", { params: { limit } })
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  // ---- profile settings ------------------------------------------------------------------------------------------
  async userOverview(): Promise<TMcpUserOverview> {
    return this.get("/api/users/me/mcp/")
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async userCreateToken(data: TMcpUserTokenCreate): Promise<TMcpTokenCreated> {
    return this.post("/api/users/me/mcp/tokens/", data)
      .then((response) => response.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async userDeleteToken(tokenId: string): Promise<void> {
    return this.delete(`/api/users/me/mcp/tokens/${tokenId}/`)
      .then(() => undefined)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
