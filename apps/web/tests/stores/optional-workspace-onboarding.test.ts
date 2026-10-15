/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { expect, test, vi } from "vitest";
import type { RootStore } from "@/plane-web/store/root.store";
import { ProfileStore } from "@/store/user/profile.store";

const { updateProfile, finishOnboarding, getProfile } = vi.hoisted(() => ({
  updateProfile: vi.fn().mockResolvedValue({}),
  finishOnboarding: vi.fn().mockResolvedValue(undefined),
  getProfile: vi.fn(),
}));

vi.mock("@/services/user.service", () => ({
  UserService: class {
    updateCurrentUserProfile = updateProfile;
    updateUserOnBoard = finishOnboarding;
    getCurrentUserProfile = getProfile;
  },
}));

test("onboarding can finish with no workspace and no workspace creation request", async () => {
  const refreshSettings = vi.fn().mockResolvedValue({});
  const store = new ProfileStore({
    workspaceRoot: { workspaces: {} },
    user: { userSettings: { fetchCurrentUserSettings: refreshSettings } },
  } as unknown as RootStore);
  getProfile.mockResolvedValue({ ...store.data });
  await store.finishUserOnboarding();
  expect(finishOnboarding).toHaveBeenCalledOnce();
  expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ last_workspace_id: undefined }));
  expect(getProfile).toHaveBeenCalledOnce();
  expect(refreshSettings).toHaveBeenCalledWith(true);
  expect(store.data.is_onboarded).toBe(true);
});
