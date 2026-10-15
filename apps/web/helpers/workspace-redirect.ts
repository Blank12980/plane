/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IWorkspace } from "@plane/types";
import { EUserWorkspaceRoles } from "@plane/types";

export function getWorkspaceHomeUrl(
  workspaces: Record<string, Pick<IWorkspace, "slug" | "role">>,
  preferredSlug?: string | null,
  isInstanceAdmin = false
): string {
  const available = Object.values(workspaces);
  const workspace = available.find((item) => item.slug === preferredSlug) ?? available[0];
  if (!workspace) return "/invitations";
  return !isInstanceAdmin && workspace.role === EUserWorkspaceRoles.CLIENT
    ? `/${workspace.slug}/client`
    : `/${workspace.slug}`;
}
