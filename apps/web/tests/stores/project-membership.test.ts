import { beforeEach, expect, test, vi } from "vitest";
import { EUserPermissions } from "@plane/constants";
import type { RootStore } from "@/plane-web/store/root.store";
import { BaseUserPermissionStore } from "@/store/user/base-permissions.store";

const { leaveRequest, refreshProjects, removeFavorite, memberMe, projectRoles } = vi.hoisted(() => ({
  leaveRequest: vi.fn(),
  refreshProjects: vi.fn(),
  removeFavorite: vi.fn(),
  memberMe: vi.fn(),
  projectRoles: vi.fn(),
}));
vi.mock("@/services/user.service", () => ({ default: { leaveProject: leaveRequest } }));
vi.mock("@/services/project/project-member.service", () => ({ default: { projectMemberMe: memberMe } }));
vi.mock("@/services/workspace.service", () => ({
  WorkspaceService: class {
    workspaceMemberMe = vi.fn();
    getWorkspaceUserProjectsRole = projectRoles;
  },
}));

class PermissionStore extends BaseUserPermissionStore {
  getProjectRoleByWorkspaceSlugAndProjectId = (slug: string, projectId?: string) =>
    this.getProjectRole(slug, projectId);
  fetchWorkspaceLevelProjectEntities = vi.fn();
}

function createStore() {
  const projectMap = { project: { id: "project", network: 0 } };
  const user = { data: { id: "user", is_instance_admin: false } };
  const store = new PermissionStore({
    projectRoot: {
      project: {
        projectMap,
        fetchProjects: refreshProjects,
        invalidateProjectRequests: vi.fn(),
        projectAnalyticsCountMap: {},
      },
    },
    favorite: { removeFavoriteFromStore: removeFavorite },
    user,
  } as unknown as RootStore);
  store.workspaceProjectsPermissions = { workspace: { project: EUserPermissions.MEMBER } };
  return { store, projectMap, user };
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

test("a delayed membership response cannot restore membership after leaving", async () => {
  const { store } = createStore();
  let resolve!: (membership: { id: string; role: number }) => void;
  memberMe.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const request = store.fetchUserProjectInfo("workspace", "project");
  await store.leaveProject("workspace", "project");
  resolve({ id: "membership", role: 15 });
  await request;
  expect(store.workspaceProjectsPermissions.workspace.project).toBeUndefined();
  expect(store.projectUserInfo.workspace?.project).toBeUndefined();
});

test("a delayed workspace role response cannot restore membership after leaving", async () => {
  const { store } = createStore();
  let resolve!: (roles: { project: number }) => void;
  projectRoles.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const request = store.fetchUserProjectPermissions("workspace");
  await store.leaveProject("workspace", "project");
  resolve({ project: 15 });
  await request;
  expect(store.workspaceProjectsPermissions.workspace.project).toBeUndefined();
});

test("denied membership removes cached private project data", async () => {
  const { store, projectMap } = createStore();
  memberMe.mockRejectedValueOnce({ status: 403 });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(store.fetchUserProjectInfo("workspace", "project")).rejects.toEqual({ status: 403 });
  expect(projectMap.project).toBeUndefined();
  expect(store.workspaceProjectsPermissions.workspace.project).toBeUndefined();
  log.mockRestore();
});

test("stale technical workspace membership is not an administrator role", () => {
  const { store } = createStore();
  store.workspaceUserInfo.workspace = { role: 20, is_instance_admin_access: true } as never;
  expect(store.getWorkspaceRoleByWorkspaceSlug("workspace")).toBeUndefined();
  expect(store.getProjectRoleByWorkspaceSlugAndProjectId("workspace", "project")).toBe(EUserPermissions.MEMBER);
});

test("current instance administrators keep effective admin permissions with an explicit member role", () => {
  const { store, user } = createStore();
  store.workspaceUserInfo.workspace = { role: 15, is_instance_admin_access: false } as never;
  user.data.is_instance_admin = true;
  expect(store.getWorkspaceRoleByWorkspaceSlug("workspace")).toBe(EUserPermissions.ADMIN);
  expect(store.getProjectRoleByWorkspaceSlugAndProjectId("workspace", "project")).toBe(EUserPermissions.ADMIN);
});
