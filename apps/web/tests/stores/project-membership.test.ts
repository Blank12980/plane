import { beforeEach, expect, test, vi } from "vitest";
import { EUserPermissions } from "@plane/constants";
import type { RootStore } from "@/plane-web/store/root.store";
import { BaseUserPermissionStore } from "@/store/user/base-permissions.store";

const { leaveRequest, refreshProjects, removeFavorite } = vi.hoisted(() => ({
  leaveRequest: vi.fn(),
  refreshProjects: vi.fn(),
  removeFavorite: vi.fn(),
}));
vi.mock("@/services/user.service", () => ({ default: { leaveProject: leaveRequest } }));
vi.mock("@/services/project/project-member.service", () => ({ default: {} }));
vi.mock("@/services/workspace.service", () => ({
  WorkspaceService: class {
    workspaceMemberMe = vi.fn();
  },
}));

class PermissionStore extends BaseUserPermissionStore {
  getProjectRoleByWorkspaceSlugAndProjectId = (slug: string, projectId?: string) =>
    this.getProjectRole(slug, projectId);
  fetchWorkspaceLevelProjectEntities = vi.fn();
}

function createStore() {
  const projectMap = { project: { id: "project", network: 0 } };
  const store = new PermissionStore({
    projectRoot: { project: { projectMap, fetchProjects: refreshProjects } },
    favorite: { removeFavoriteFromStore: removeFavorite },
  } as unknown as RootStore);
  store.workspaceProjectsPermissions = { workspace: { project: EUserPermissions.MEMBER } };
  return { store, projectMap };
}

beforeEach(() => {
  vi.clearAllMocks();
  leaveRequest.mockResolvedValue(undefined);
  refreshProjects.mockResolvedValue([]);
});

test("successful departure clears permissions and private data and refreshes discoverable projects", async () => {
  const { store, projectMap } = createStore();
  await store.leaveProject("workspace", "project");
  expect(store.workspaceProjectsPermissions.workspace.project).toBeUndefined();
  expect(projectMap.project).toBeUndefined();
  expect(refreshProjects).toHaveBeenCalledWith("workspace");
  expect(removeFavorite).toHaveBeenCalledWith("project");
});

test("a rejected departure preserves membership and project data", async () => {
  const { store, projectMap } = createStore();
  leaveRequest.mockRejectedValueOnce(new Error("last admin"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(store.leaveProject("workspace", "project")).rejects.toThrow("last admin");
  expect(store.workspaceProjectsPermissions.workspace.project).toBe(EUserPermissions.MEMBER);
  expect(projectMap.project).toBeDefined();
  expect(refreshProjects).not.toHaveBeenCalled();
  expect(removeFavorite).not.toHaveBeenCalled();
  log.mockRestore();
});

test("a list refresh failure does not turn a completed departure into a failure", async () => {
  const { store } = createStore();
  refreshProjects.mockRejectedValueOnce(new Error("network"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(store.leaveProject("workspace", "project")).resolves.toBeUndefined();
  expect(store.workspaceProjectsPermissions.workspace.project).toBeUndefined();
  log.mockRestore();
});
