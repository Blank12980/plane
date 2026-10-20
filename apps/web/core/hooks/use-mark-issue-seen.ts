/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { mutate } from "swr";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
// services
import { currentTasksService } from "@/services/current-tasks.service";

// A work item is reported once per session: opening it again changes nothing.
const reported = new Set<string>();

/**
 * Opening a work item that is assigned to the user is what "gets acquainted" with a new task: the task stops being
 * highlighted in the bell and on the home page.
 */
export function useMarkIssueSeen(workspaceSlug: string | undefined, issueId: string | undefined) {
  const { data: user } = useUser();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = issueId ? getIssueById(issueId) : undefined;
  const isAssignedToUser = !!user?.id && !!issue?.assignee_ids?.includes(user.id);

  useEffect(() => {
    if (!workspaceSlug || !issueId || !isAssignedToUser) return;
    const marker = `${workspaceSlug}/${issueId}`;
    if (reported.has(marker)) return;
    reported.add(marker);
    void (async () => {
      try {
        const { updated } = await currentTasksService.markSeen(workspaceSlug, [issueId]);
        if (updated > 0) {
          await mutate(
            (key) => Array.isArray(key) && ["CURRENT_TASKS", "WORKSPACE_UNREAD_NOTIFICATION_COUNT"].includes(key[0])
          );
        }
      } catch {
        // try again the next time the work item is opened
        reported.delete(marker);
      }
    })();
  }, [workspaceSlug, issueId, isAssignedToUser]);
}
