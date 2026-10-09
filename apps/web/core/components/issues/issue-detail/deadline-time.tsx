/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Clock } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { TimeInput } from "@plane/ui";
import { getDeadlineParts } from "@plane/utils";
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";

type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled: boolean };

export const IssueDeadlineTime = observer(function IssueDeadlineTime({
  workspaceSlug,
  projectId,
  issueId,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const {
    issue: { getIssueById, updateDeadline },
  } = useIssueDetail();
  const issue = getIssueById(issueId);
  if (!issue) return null;
  const zone = user?.user_timezone ?? "UTC";
  const parts = issue.deadline_at ? getDeadlineParts(issue.deadline_at, zone) : undefined;
  const date = parts?.date ?? issue.target_date;

  return (
    <SidebarPropertyListItem icon={Clock} label={t("deadline.time")}>
      <div className="min-w-0 grow" title={date ? zone : t("deadline.select_date_first")}>
        <TimeInput
          key={`${issueId}:${date}`}
          value={parts?.time ?? null}
          label={t("deadline.time")}
          clearLabel={t("deadline.clear_time")}
          disabled={disabled || !date || !user}
          onCommit={async (time) => {
            await updateDeadline(
              workspaceSlug,
              projectId,
              issueId,
              // A datetime without an offset is interpreted in the user's profile timezone by the API.
              time && date ? `${date}T${time}:00` : null
            );
          }}
          onError={(error) => {
            console.error("Failed to update deadline", error);
            setToast({ type: TOAST_TYPE.ERROR, title: t("common.error.label"), message: t("deadline.save_failed") });
          }}
        />
        {date && <span className="px-1.5 text-10 text-secondary">{zone}</span>}
      </div>
    </SidebarPropertyListItem>
  );
});
