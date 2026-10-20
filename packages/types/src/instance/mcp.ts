/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Instance wide MCP policy, edited by instance administrators in God Mode. */
export type TMcpPolicy = {
  /** Master switch: when off, MCP tokens and the MCP server are rejected by the API. */
  enabled: boolean;
  /** Whether users may create MCP tokens for themselves in their profile settings. */
  allow_user_tokens: boolean;
  /** API token scopes users may grant to a token created in the profile settings. */
  allowed_scopes: string[];
  /** Longest token lifetime in days (0 = unlimited). */
  max_token_days: number;
  /** Rate limit of tokens created in the profile settings, e.g. 120/min. */
  default_rate_limit: string;
};

export type TMcpPolicyUpdate = Partial<TMcpPolicy>;

export type TMcpHealth = {
  status: "ok" | "unavailable";
  version: string | null;
  name: string | null;
};

export type TMcpStats = {
  tokens_total: number;
  tokens_active: number;
  tokens_used_24h: number;
  calls_24h: number;
  calls_24h_truncated: boolean;
  errors_24h: number;
  top_tools: { tool: string; calls: number }[];
};

/** God Mode overview of the MCP server. */
export type TMcpOverview = {
  settings: TMcpPolicy;
  available_scopes: string[];
  /** Public URL of the MCP endpoint, e.g. https://gizmo.example.com/mcp */
  endpoint: string;
  health: TMcpHealth;
  stats: TMcpStats;
};

export type TMcpToken = {
  id: string;
  label: string;
  description: string;
  user: { id: string; display_name: string; email: string; is_bot: boolean };
  workspace: { slug: string; name: string } | null;
  scopes: string[];
  allowed_rate_limit: string;
  last_used: string | null;
  expired_at: string | null;
  created_at: string;
  /** An administrator (or the owner) switched the token off. */
  revoked: boolean;
  expired: boolean;
  /** Usable right now: neither revoked nor expired. */
  is_active: boolean;
};

/** The secret is returned only once, in the response that creates the token. */
export type TMcpTokenCreated = TMcpToken & { token: string };

export type TMcpCall = {
  id: string;
  tool: string | null;
  method: string;
  path: string;
  status: number;
  created_at: string;
};

/** What the profile settings need to connect an agent on behalf of the signed-in user. */
export type TMcpUserOverview = {
  enabled: boolean;
  allow_user_tokens: boolean;
  endpoint: string;
  policy: Pick<TMcpPolicy, "allowed_scopes" | "max_token_days" | "default_rate_limit">;
  workspaces: { slug: string; name: string }[];
  tokens: TMcpToken[];
};

export type TMcpUserTokenCreate = {
  label: string;
  workspace_slug: string;
  scopes: string[];
  expires_in_days?: number | null;
};
