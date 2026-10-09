/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { IssueWorkLogProperty } from "@/components/issues/worklog/property";

type TIssueWorklogProperty = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
};

export function IssueWorklogProperty(props: TIssueWorklogProperty) {
  return <IssueWorkLogProperty {...props} />;
}
