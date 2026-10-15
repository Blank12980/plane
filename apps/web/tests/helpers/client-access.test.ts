/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { expect, test } from "vitest";
import { canClientAccessWorkspacePath } from "@/helpers/client-access";

test("clients can open their resource portal", () => {
  expect(canClientAccessWorkspacePath("/team/client", "team")).toBe(true);
});

test("workspace administration and other workspaces are outside client navigation", () => {
  for (const path of [
    "/team",
    "/team/settings/members",
    "/team/analytics",
    "/other/client",
    "/team/projects",
    "/team/client-fake",
  ]) {
    expect(canClientAccessWorkspacePath(path, "team")).toBe(false);
  }
});
