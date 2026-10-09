/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Clock } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useUser } from "@/hooks/store/user";
import { IssueActivityBlockComponent } from "./helpers/activity-block";

type Props = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueDeadlineActivity = observer(function IssueDeadlineActivity({ activityId, ends }: Props) {
  const { t } = useTranslation();
  const { data: user } = useUser();
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return null;
  const zone = user?.user_timezone ?? "UTC";

  return (
    <IssueActivityBlockComponent
      icon={<Clock size={14} className="text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      {activity.new_value ? t("deadline.activity_set") : t("deadline.activity_removed")}
      {activity.new_value && (
        <span className="ml-1 font-medium text-primary">
          {new Date(activity.new_value).toLocaleString(undefined, { timeZone: zone })} ({zone})
        </span>
      )}
    </IssueActivityBlockComponent>
  );
});
