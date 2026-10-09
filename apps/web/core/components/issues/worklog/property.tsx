/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Clock } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
// gizmo imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { formatMinutesAsDuration } from "@plane/utils";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
// services
import { IssueWorkLogService } from "@/services/issue/issue_worklog.service";
// local imports
import { IssueWorkLogModal } from "./modal";

const workLogService = new IssueWorkLogService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
};

/** Sidebar row with the total time spent on a work item; opens the time tracking dialog. */
export const IssueWorkLogProperty = observer(function IssueWorkLogProperty(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled } = props;
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();
  // states
  const [isOpen, setIsOpen] = useState(false);
  // guests cannot see work logs at all
  const canTrackTime = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );

  const { data: workLogs, mutate } = useSWR(canTrackTime ? `ISSUE_WORKLOGS_${issueId}` : null, () =>
    workLogService.getWorkLogs(workspaceSlug, projectId, issueId)
  );

  if (!canTrackTime) return null;

  const totalMinutes = (workLogs ?? []).reduce((sum, log) => sum + log.duration_minutes, 0);

  return (
    <>
      <IssueWorkLogModal
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueId={issueId}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        readOnly={disabled}
        workLogs={workLogs}
        onChanged={() => mutate()}
      />
      <SidebarPropertyListItem icon={Clock} label={t("worklog.time_spent")}>
        <button
          type="button"
          className="flex h-7.5 w-full items-center rounded-sm px-2 text-left text-body-xs-regular hover:bg-layer-transparent-hover"
          onClick={() => setIsOpen(true)}
        >
          {totalMinutes > 0 ? (
            formatMinutesAsDuration(totalMinutes, {
              hours: t("worklog.units.hours"),
              minutes: t("worklog.units.minutes"),
            })
          ) : (
            <span className="text-placeholder">{disabled ? t("none") : t("worklog.add_time")}</span>
          )}
        </button>
      </SidebarPropertyListItem>
    </>
  );
});
