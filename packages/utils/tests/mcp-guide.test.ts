/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMcpAgentPrompt, buildMcpOAuthConfigs, mcpOAuthMetadataUrl } from "../src/mcp-guide.ts";

const endpoint = "https://gizmo.example.com/mcp";

test("the prompt offers OAuth first when the administrator allows it, and keeps the token as a fallback", () => {
  const prompt = buildMcpAgentPrompt({ endpoint, token: "plane_api_secret", workspaceSlug: "acme", oauth: true });
  assert.match(prompt, /Способ 1\. OAuth, без токена/);
  assert.match(prompt, /Способ 2\. Токен/);
  assert.ok(prompt.indexOf("Способ 1") < prompt.indexOf("Способ 2"));
  // OAuth: only the URL, nothing secret
  assert.match(prompt, /claude mcp add --transport http --scope user gizmo https:\/\/gizmo\.example\.com\/mcp\n/);
  assert.match(prompt, /\.well-known\/oauth-protected-resource\/mcp/);
  assert.match(prompt, /ChatGPT/);
  assert.match(prompt, /Авторизация: OAuth|авторизация — OAuth/);
  // the token variant is still complete
  assert.match(prompt, /Authorization: Bearer plane_api_secret/);
  assert.match(prompt, /X-Workspace-Slug: acme/);
});

test("without OAuth the prompt only describes the token", () => {
  const prompt = buildMcpAgentPrompt({ endpoint, token: "plane_api_secret", workspaceSlug: "acme" });
  assert.doesNotMatch(prompt, /OAuth/);
  assert.match(prompt, /Авторизация по токену/);
  assert.match(prompt, /Authorization: Bearer plane_api_secret/);
});

test("without a token the agent is told to ask for one only if it falls back to the token", () => {
  const withOAuth = buildMcpAgentPrompt({ endpoint, oauth: true });
  assert.match(withOAuth, /если выбираешь этот способ, попроси меня вставить токен/);
  const plain = buildMcpAgentPrompt({ endpoint });
  assert.match(plain, /: попроси меня вставить токен/);
  assert.match(plain, /<ВАШ_ТОКЕН>/);
});

test("the metadata address is derived from the MCP address", () => {
  assert.equal(mcpOAuthMetadataUrl(endpoint), "https://gizmo.example.com/.well-known/oauth-protected-resource/mcp");
  assert.equal(
    mcpOAuthMetadataUrl("https://gizmo.example.com/mcp/"),
    "https://gizmo.example.com/.well-known/oauth-protected-resource/mcp"
  );
});

test("OAuth snippets never contain a token or headers", () => {
  const configs = buildMcpOAuthConfigs(endpoint);
  assert.deepEqual(
    configs.map((config) => config.id),
    ["chatgpt", "claude-code-oauth", "cursor-oauth", "vscode-oauth"]
  );
  for (const config of configs) {
    assert.ok(config.snippet.includes(endpoint), config.id);
    assert.doesNotMatch(config.snippet, /Bearer|headers|Authorization:/i, config.id);
  }
});
