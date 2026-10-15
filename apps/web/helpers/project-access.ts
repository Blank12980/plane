import type { IPartialProject, IProject, TProjectMembership } from "@plane/types";

export function isProjectVisible(
  project: IPartialProject,
  isAdministrator: boolean,
  hasCurrentMembership: boolean
): boolean {
  if (isAdministrator || project.network === 2) return true;
  if (project.is_member === false) return false;
  return hasCurrentMembership && (project.is_member === true || !!project.member_role);
}

export function canLeaveProject(
  project: IProject | undefined,
  membership: TProjectMembership | undefined,
  userId?: string
): boolean {
  if (typeof membership?.can_leave === "boolean") return membership.can_leave;
  if (typeof project?.can_leave === "boolean") return project.can_leave;
  if (membership?.is_instance_admin_access || membership?.id === null) return false;
  // Older APIs omit original_role, but a real membership still has an ID.
  if (membership?.id) return true;
  if (typeof project?.is_member === "boolean") return project.is_member;
  return !!userId && !!project?.members?.includes(userId);
}
