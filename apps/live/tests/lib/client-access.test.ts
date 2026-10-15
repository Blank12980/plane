/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { beforeEach, expect, test, vi } from "vitest";
import { onAuthenticate } from "../../src/lib/auth";
import type { HocusPocusServerContext } from "../../src/types";

const { currentUser, fetchCollaborationAccess } = vi.hoisted(() => ({
  currentUser: vi.fn(),
  fetchCollaborationAccess: vi.fn(),
}));
vi.mock("@/services/user.service", () => ({
  UserService: class {
    currentUser = currentUser;
  },
}));
vi.mock("@/services/page/handler", () => ({ getPageService: () => ({ fetchCollaborationAccess }) }));
vi.mock("@plane/logger", () => ({ logger: { error: vi.fn() } }));

function request() {
  return {
    requestHeaders: { cookie: "session=test" },
    requestParameters: new URLSearchParams({
      documentType: "project_page",
      projectId: "project",
      workspaceSlug: "team",
    }),
    context: {} as HocusPocusServerContext,
    token: JSON.stringify({ id: "user", cookie: "session=test" }),
    documentName: "page",
    connection: { readOnly: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser.mockResolvedValue({ id: "user", display_name: "User" });
});

test("a login alone cannot join a cached collaborative page", async () => {
  fetchCollaborationAccess.mockRejectedValue(new Error("Access denied"));
  await expect(onAuthenticate(request())).rejects.toThrow("Access denied");
  expect(fetchCollaborationAccess).toHaveBeenCalledWith("page");
});

test("the server controls read-only collaboration", async () => {
  fetchCollaborationAccess.mockResolvedValue({ read_only: true });
  const payload = request();
  await onAuthenticate(payload);
  expect(payload.connection.readOnly).toBe(true);
});
