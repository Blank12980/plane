/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { describe, expect, it } from "vitest";
import { getWorkspaceHomeUrl } from "@/helpers/workspace-redirect";

describe("workspace home", () => {
  const workspaces = { one: { slug: "one", role: 15 }, two: { slug: "two", role: 15 } };

  it("lets users without a workspace wait for invitations", () => {
    expect(getWorkspaceHomeUrl({})).toBe("/invitations");
    expect(getWorkspaceHomeUrl({}, "deleted")).toBe("/invitations");
  });

  it("restores an available workspace and falls back after membership is revoked", () => {
    expect(getWorkspaceHomeUrl(workspaces, "two")).toBe("/two");
    expect(getWorkspaceHomeUrl(workspaces, "deleted")).toBe("/one");
  });

  it("opens the resource portal for a client", () => {
    expect(getWorkspaceHomeUrl({ client: { slug: "client", role: 3 } })).toBe("/client/client");
  });

  it("preserves the normal home for an instance administrator", () => {
    expect(getWorkspaceHomeUrl({ team: { slug: "team", role: 3 } }, "team", true)).toBe("/team");
  });
});
