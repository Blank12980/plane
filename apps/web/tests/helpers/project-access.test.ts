import { expect, test } from "vitest";
import type { IPartialProject, IProject, TProjectMembership } from "@plane/types";
import { canLeaveProject, isProjectVisible } from "@/helpers/project-access";

test.each([0, 2])("administrators can discover all projects (%s)", (network) => {
  expect(isProjectVisible({ network, is_member: false } as IPartialProject, true, false)).toBe(true);
});

test("private projects need current membership even when stale data contains a role", () => {
  const project = { network: 0, member_role: 20 } as IPartialProject;
  expect(isProjectVisible(project, false, false)).toBe(false);
  expect(isProjectVisible(project, false, true)).toBe(true);
  expect(isProjectVisible({ ...project, is_member: false }, false, true)).toBe(false);
});

test("public projects remain discoverable without membership", () => {
  expect(isProjectVisible({ network: 2 } as IPartialProject, false, false)).toBe(true);
});

test("list membership makes the leave action available before membership details load", () => {
  expect(canLeaveProject({ can_leave: true } as IProject, undefined)).toBe(true);
  expect(canLeaveProject({ is_member: true } as IProject, undefined)).toBe(true);
  expect(canLeaveProject({ members: ["user"] } as IProject, undefined, "user")).toBe(true);
});

test("older member responses with an ID do not require original_role", () => {
  expect(canLeaveProject(undefined, { id: "membership", role: 15 } as TProjectMembership)).toBe(true);
});

test("technical administrator access does not display a leave action", () => {
  expect(canLeaveProject(undefined, { id: null, role: 20 } as TProjectMembership)).toBe(false);
  expect(canLeaveProject(undefined, { id: "technical", is_instance_admin_access: true } as TProjectMembership)).toBe(
    false
  );
  expect(canLeaveProject({ members: ["user"], can_leave: false } as IProject, undefined, "user")).toBe(false);
  expect(canLeaveProject({ can_leave: true } as IProject, { can_leave: false } as TProjectMembership)).toBe(false);
});
