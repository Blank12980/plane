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
  /** Whether a user may create one token that works in every workspace they belong to. */
  allow_all_workspaces: boolean;
  /** Whether applications such as ChatGPT may connect through OAuth (the user approves them on a consent screen). */
  allow_oauth: boolean;
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
  /** Applications connected through OAuth right now. */
  oauth_connections: number;
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

/** Addresses of the OAuth authorization server of the MCP server (RFC 8414 / RFC 9728). */
export type TMcpOAuthEndpoints = {
  issuer: string;
  /** The MCP endpoint itself, the protected resource. */
  resource: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  revocation_endpoint: string;
  protected_resource_metadata: string;
  authorization_server_metadata: string;
};

/** An application (ChatGPT, ...) that a user connected through OAuth. */
export type TMcpOAuthConnection = {
  id: string;
  client_name: string;
  client_uri: string;
  /** null: works in every workspace of the user. */
  workspace: { slug: string; name: string } | null;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  /** When the connection stops working unless the application keeps refreshing it. */
  expires_at: string;
};

/** God Mode also shows whose connection it is. */
export type TMcpAdminOAuthConnection = TMcpOAuthConnection & {
  user: { id: string; display_name: string; email: string };
};

/** What the profile settings need to connect an agent on behalf of the signed-in user. */
export type TMcpUserOverview = {
  enabled: boolean;
  allow_user_tokens: boolean;
  endpoint: string;
  policy: Pick<
    TMcpPolicy,
    "allow_all_workspaces" | "allow_oauth" | "allowed_scopes" | "max_token_days" | "default_rate_limit"
  >;
  workspaces: { slug: string; name: string }[];
  tokens: TMcpToken[];
  oauth: {
    /** MCP is on and the administrator allows OAuth connections. */
    enabled: boolean;
    endpoints: TMcpOAuthEndpoints;
    connections: TMcpOAuthConnection[];
  };
};

/** The consent screen: what the application asks for and what the user can choose. */
export type TOAuthConsent = {
  client: { name: string; uri: string; redirect_uri: string; redirect_host: string };
  user: { display_name: string; email: string };
  scopes: { requested: string[]; allowed: string[]; default: string[] };
  workspaces: { slug: string; name: string }[];
  allow_all_workspaces: boolean;
  /** How long the connection stays valid without being used. */
  access_days: number;
  consent_token: string;
  expires_at: string;
};

export type TOAuthConsentDecision =
  | { decision: "deny"; consent_token: string }
  | {
      decision: "approve";
      consent_token: string;
      scopes: string[];
      all_workspaces: boolean;
      workspace_slug?: string;
    };

export type TMcpUserTokenCreate = {
  label: string;
  /** One workspace, or leave it out and set `all_workspaces`. */
  workspace_slug?: string;
  /** One token for every workspace the user belongs to. */
  all_workspaces?: boolean;
  scopes: string[];
  expires_in_days?: number | null;
};
