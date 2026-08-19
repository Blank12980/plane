/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// hooks
import { IntakeIcon } from "@plane/propel/icons";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";
// icons

type TIssueInboxActivity = { activityId: string; ends: "top" | "bottom" | undefined };

export const IssueInboxActivity = observer(function IssueInboxActivity(props: TIssueInboxActivity) {
  const { activityId, ends } = props;
  // hooks
  const {
    activity: { getActivityById },
  } = useIssueDetail();

  const activity = getActivityById(activityId);

  const getInboxActivityMessage = () => {
    switch (activity?.verb) {
      case "-1":
        return "отклонил(а) этот рабочий элемент из входящих.";
      case "0":
        return "отложил(а) этот рабочий элемент.";
      case "1":
        return "принял(а) этот рабочий элемент из входящих.";
      case "2":
        return "отклонил(а) этот рабочий элемент из входящих, отметив дубликат.";
      default:
        return "обновил(а) статус входящего рабочего элемента.";
    }
  };

  if (!activity) return <></>;
  return (
    <IssueActivityBlockComponent
      icon={<IntakeIcon className="h-4 w-4 flex-shrink-0 text-secondary" />}
      activityId={activityId}
      ends={ends}
    >
      <>{getInboxActivityMessage()}</>
    </IssueActivityBlockComponent>
  );
});
