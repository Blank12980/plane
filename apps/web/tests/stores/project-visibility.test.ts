import { observable } from "mobx";
import { beforeEach, expect, test, vi } from "vitest";
import type { TProject } from "@/plane-web/types/projects";
import type { CoreRootStore } from "@/store/root.store";
import { ProjectStore } from "@/store/project/project.store";

const { getProjects, getProjectsLite, getProject } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  getProjectsLite: vi.fn(),
  getProject: vi.fn(),
}));
vi.mock("@plane/utils", () => ({ orderProjects: (projects: TProject[]) => projects, shouldFilterProject: () => true }));
vi.mock("@/services/issue", () => ({ IssueService: vi.fn(), IssueLabelService: vi.fn() }));
vi.mock("@/services/project", () => ({
  ProjectService: class {
    getProjects = getProjects;
    getProjectsLite = getProjectsLite;
    getProject = getProject;
  },
  ProjectStateService: vi.fn(),
  ProjectArchiveService: vi.fn(),
}));

function createStore() {
  const user = observable({
    data: { id: "user", is_instance_admin: false },
    permission: {
      workspaceProjectsPermissions: { workspace: { joined: 15 } } as Record<string, Record<string, number>>,
      projectUserInfo: {} as Record<string, Record<string, unknown>>,
      workspaceRole: 15,
      getWorkspaceRoleByWorkspaceSlug() {
        return this.workspaceRole;
      },
    },
  });
  const store = new ProjectStore({
    user,
    workspaceRoot: {
      currentWorkspace: { id: "workspace-id", slug: "workspace" },
      getWorkspaceBySlug: () => ({ id: "workspace-id" }),
    },
    projectRoot: {
      projectFilter: { currentWorkspaceDisplayFilters: {}, currentWorkspaceFilters: {}, searchQuery: "" },
    },
    favorite: { removeFavoriteFromStore: vi.fn() },
  } as unknown as CoreRootStore);
  return { store, user };
}

function project(id: string, fields: Partial<TProject> = {}): TProject {
  return { id, workspace: "workspace-id", name: id, identifier: id, network: 0, ...fields } as TProject;
}

beforeEach(() => vi.clearAllMocks());

test("all project list selectors hide private projects without current membership", () => {
  const { store } = createStore();
  store.projectMap = {
    public: project("public", { network: 2 }),
    joined: project("joined", { member_role: 15, is_member: true }),
    hidden: project("hidden", { member_role: 20, is_favorite: true }),
    archived: project("archived", { member_role: 20, archived_at: "2026-01-01" }),
  };
  expect(store.workspaceProjectIds).toEqual(["public", "joined"]);
  expect(store.filteredProjectIds).toEqual(["public", "joined"]);
  expect(store.archivedProjectIds).toEqual([]);
  expect(store.joinedProjectIds).toEqual(["joined"]);
  expect(store.favoriteProjectIds).toEqual([]);
});

test("workspace and instance administrators still see every private project", () => {
  const { store, user } = createStore();
  store.projectMap.hidden = project("hidden", { is_member: false });
  expect(store.workspaceProjectIds).toEqual([]);
  user.permission.workspaceRole = 20;
  expect(store.workspaceProjectIds).toEqual(["hidden"]);
  user.permission.workspaceRole = 15;
  user.data.is_instance_admin = true;
  expect(store.workspaceProjectIds).toEqual(["hidden"]);
});

test("latest list response removes a formerly visible private project", async () => {
  const { store } = createStore();
  store.projectMap.hidden = project("hidden");
  getProjects.mockResolvedValueOnce([project("public", { network: 2 })]);
  await store.fetchProjects("workspace");
  expect(store.projectMap.hidden).toBeUndefined();
  expect(store.workspaceProjectIds).toEqual(["public"]);
});

test("an old detail response cannot restore project data after leaving before roles load", async () => {
  const { store } = createStore();
  let resolve!: (value: TProject) => void;
  getProject.mockReturnValueOnce(
    new Promise<TProject>((done) => {
      resolve = done;
    })
  );
  const request = store.fetchProjectDetails("workspace", "hidden");
  store.invalidateProjectRequests("workspace", "hidden");
  resolve(project("hidden", { member_role: 15, can_leave: true }));
  await request;
  expect(store.projectMap.hidden).toBeUndefined();
});

test("an older list response cannot replace the list refreshed after departure", async () => {
  const { store } = createStore();
  let resolve!: (value: TProject[]) => void;
  getProjectsLite.mockReturnValueOnce(
    new Promise<TProject[]>((done) => {
      resolve = done;
    })
  );
  const oldRequest = store.fetchPartialProjects("workspace");
  store.invalidateProjectRequests("workspace", "hidden");
  getProjects.mockResolvedValueOnce([]);
  await store.fetchProjects("workspace");
  resolve([project("hidden", { member_role: 15, can_leave: true })]);
  await oldRequest;
  expect(store.projectMap.hidden).toBeUndefined();
});

test("project responses from a previous account do not populate current account data", async () => {
  const { store, user } = createStore();
  let resolve!: (value: TProject[]) => void;
  getProjects.mockReturnValueOnce(
    new Promise<TProject[]>((done) => {
      resolve = done;
    })
  );
  const request = store.fetchProjects("workspace");
  user.data.id = "another-user";
  resolve([project("hidden", { member_role: 15 })]);
  await request;
  expect(store.projectMap.hidden).toBeUndefined();
});
