/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { FC, ReactNode } from "react";
import {
  RotateCcw,
  Network,
  Inbox,
  AlignLeft,
  Paperclip,
  Type,
  FileText,
  Hash,
  Clock,
  Bell,
  GitBranch,
  Timer,
  ListTodo,
  Layers,
} from "lucide-react";
// components

import {
  LinkIcon,
  ArchiveIcon,
  CycleIcon,
  GlobeIcon,
  DueDatePropertyIcon,
  EstimatePropertyIcon,
  GridLayoutIcon,
  IntakeIcon,
  LabelPropertyIcon,
  MembersPropertyIcon,
  ModuleIcon,
  PriorityPropertyIcon,
  StartDatePropertyIcon,
  StatePropertyIcon,
} from "@plane/propel/icons";
import { store } from "@/lib/store-context";
import type { TProjectActivity } from "@/plane-web/types";

type ActivityIconMap = {
  [key: string]: FC<{ className?: string }>;
};
export const iconsMap: ActivityIconMap = {
  priority: PriorityPropertyIcon,
  archived_at: ArchiveIcon,
  restored: RotateCcw,
  link: LinkIcon,
  start_date: StartDatePropertyIcon,
  target_date: DueDatePropertyIcon,
  label: LabelPropertyIcon,
  inbox: Inbox,
  description: AlignLeft,
  assignee: MembersPropertyIcon,
  attachment: Paperclip,
  name: Type,
  state: StatePropertyIcon,
  estimate: EstimatePropertyIcon,
  cycle: CycleIcon,
  module: ModuleIcon,
  page: FileText,
  network: GlobeIcon,
  identifier: Hash,
  timezone: Clock,
  is_project_updates_enabled: Bell,
  is_epic_enabled: GridLayoutIcon,
  is_workflow_enabled: GitBranch,
  is_time_tracking_enabled: Timer,
  is_issue_type_enabled: ListTodo,
  default: Network,
  module_view: ModuleIcon,
  cycle_view: CycleIcon,
  issue_views_view: Layers,
  page_view: FileText,
  intake_view: IntakeIcon,
};

export const messages = (activity: TProjectActivity): { message: string | ReactNode; customUserName?: string } => {
  const activityType = activity.field;
  const newValue = activity.new_value;
  const oldValue = activity.old_value;
  const verb = activity.verb;
  const workspaceDetail = store.workspaceRoot.getWorkspaceById(activity.workspace);

  const getBooleanActionText = (value: string | undefined) => {
    if (value === "true") return "включил(а)";
    if (value === "false") return "отключил(а)";
    return verb;
  };

  switch (activityType) {
    case "priority":
      return {
        message: (
          <>
            установил(а) приоритет <span className="font-medium text-primary">{newValue || "нет"}</span>
          </>
        ),
      };
    case "archived_at":
      return {
        message: newValue === "restore" ? "восстановил(а) проект" : "архивировал(а) проект",
        customUserName: newValue === "archive" ? "Gizmo" : undefined,
      };
    case "name":
      return {
        message: (
          <>
            переименовал(а) проект в <span className="font-medium text-primary">{newValue}</span>
          </>
        ),
      };
    case "description":
      return {
        message: newValue ? "обновил(а) описание проекта" : "удалил(а) описание проекта",
      };
    case "start_date":
      return {
        message: (
          <>
            {newValue ? (
              <>
                установил(а) дату начала <span className="font-medium text-primary">{newValue}</span>
              </>
            ) : (
              "удалил(а) дату начала"
            )}
          </>
        ),
      };
    case "target_date":
      return {
        message: (
          <>
            {newValue ? (
              <>
                установил(а) срок <span className="font-medium text-primary">{newValue}</span>
              </>
            ) : (
              "удалил(а) срок"
            )}
          </>
        ),
      };
    case "state":
      return {
        message: (
          <>
            установил(а) статус <span className="font-medium text-primary">{newValue || "нет"}</span>
          </>
        ),
      };
    case "estimate":
      return {
        message: (
          <>
            {newValue ? (
              <>
                установил(а) оценку <span className="font-medium text-primary">{newValue}</span>
              </>
            ) : (
              <>
                удалил(а) оценку
                {oldValue && (
                  <>
                    {" "}
                    <span className="font-medium text-primary">{oldValue}</span>
                  </>
                )}
              </>
            )}
          </>
        ),
      };
    case "cycles":
      return {
        message: (
          <>
            <span>
              {verb === "removed" ? "убрал(а) проект из цикла" : `${verb} проект в цикл`}{" "}
            </span>
            {verb !== "removed" ? (
              <a
                href={`/${workspaceDetail?.slug}/projects/${activity.project}/cycles/${activity.new_identifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex font-medium text-primary"
              >
                {activity.new_value}
              </a>
            ) : (
              <span className="font-medium text-primary">{activity.old_value || "Неизвестный цикл"}</span>
            )}
          </>
        ),
      };
    case "modules":
      return {
        message: (
          <>
            <span>
              {verb === "removed" ? "убрал(а) проект из модуля" : `${verb} проект в модуль`}{" "}
            </span>
            <span className="font-medium text-primary">
              {verb === "removed" ? oldValue : newValue || "Неизвестный модуль"}
            </span>
          </>
        ),
      };
    case "labels":
      return {
        message: (
          <>
            {verb} метку{" "}
            <span className="font-medium text-primary">{newValue || oldValue || "Без названия"}</span>
          </>
        ),
      };
    case "inbox":
      return {
        message: <>{newValue ? "включил(а)" : "отключил(а)"} входящие</>,
      };
    case "page":
      return {
        message: (
          <>
            {newValue ? "создал(а)" : "удалил(а)"} страницу проекта{" "}
            <span className="font-medium text-primary">{newValue || oldValue || "Без названия"}</span>
          </>
        ),
      };
    case "network":
      return {
        message: <>{newValue ? "включил(а)" : "отключил(а)"} сетевой доступ</>,
      };
    case "identifier":
      return {
        message: (
          <>
            обновил(а) идентификатор проекта на <span className="font-medium text-primary">{newValue || "нет"}</span>
          </>
        ),
      };
    case "timezone":
      return {
        message: (
          <>
            изменил(а) часовой пояс проекта на <span className="font-medium text-primary">{newValue || "по умолчанию"}</span>
          </>
        ),
      };
    case "module_view":
    case "cycle_view":
    case "issue_views_view":
    case "page_view":
    case "intake_view":
      return {
        message: (
          <>
            {getBooleanActionText(newValue)} представление {activityType.replace(/_view$/, "").replace(/_/g, " ")}
          </>
        ),
      };
    case "is_project_updates_enabled":
      return {
        message: <>{getBooleanActionText(newValue)} обновления проекта</>,
      };
    case "is_epic_enabled":
      return {
        message: <>{getBooleanActionText(newValue)} эпики</>,
      };
    case "is_workflow_enabled":
      return {
        message: <>{getBooleanActionText(newValue)} свой рабочий процесс</>,
      };
    case "is_time_tracking_enabled":
      return {
        message: <>{getBooleanActionText(newValue)} учёт времени</>,
      };
    case "is_issue_type_enabled":
      return {
        message: <>{getBooleanActionText(newValue)} типы рабочих элементов</>,
      };
    default:
      return {
        message: `${verb} ${activityType?.replace(/_/g, " ")} `,
      };
  }
};
