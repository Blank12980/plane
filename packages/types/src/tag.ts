/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** A tag defined in workspace settings; any work item of the workspace can use it. */
export type TWorkspaceTag = {
  id: string;
  workspace: string;
  name: string;
  /** Hex colour, an empty string when no colour was chosen. */
  color: string;
  /** Relative asset url, `null` when the tag has no image. */
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

export type TWorkspaceTagPayload = {
  name: string;
  color?: string;
};
