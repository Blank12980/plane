/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { observer } from "mobx-react";
// gizmo imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssueWorkLog } from "@plane/types";
import { Avatar, EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import {
  MAX_WORKLOG_MINUTES,
  formatMinutesAsDuration,
  getFileURL,
  parseDurationToMinutes,
  renderFormattedDate,
  renderFormattedPayloadDate,
} from "@plane/utils";
// hooks
import { useUser, useUserPermissions } from "@/hooks/store/user";
// services
import { IssueWorkLogService } from "@/services/issue/issue_worklog.service";

const workLogService = new IssueWorkLogService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Members who may only look at the entries (e.g. archived work items). */
  readOnly: boolean;
  workLogs: TIssueWorkLog[] | undefined;
  /** Re-reads the entries after a change. */
  onChanged: () => Promise<unknown>;
};

const today = () => renderFormattedPayloadDate(new Date()) ?? "";

export const IssueWorkLogModal = observer(function IssueWorkLogModal(props: Props) {
  const { workspaceSlug, projectId, issueId, isOpen, onClose, readOnly, workLogs, onChanged } = props;
  const { t } = useTranslation();
  // store hooks
  const { data: currentUser } = useUser();
  const { allowPermissions } = useUserPermissions();
  // states
  const [editing, setEditing] = useState<TIssueWorkLog | null>(null);
  const [duration, setDuration] = useState("");
  const [loggedOn, setLoggedOn] = useState(today);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const units = { hours: t("worklog.units.hours"), minutes: t("worklog.units.minutes") };
  const isProjectAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    projectId
  );
  const totalMinutes = (workLogs ?? []).reduce((sum, log) => sum + log.duration_minutes, 0);

  const resetForm = () => {
    setEditing(null);
    setDuration("");
    setLoggedOn(today());
    setDescription("");
    setError(undefined);
  };

  // start from a blank form every time the modal is opened
  useEffect(() => {
    if (isOpen) resetForm();
  }, [isOpen]);

  const startEditing = (log: TIssueWorkLog) => {
    setEditing(log);
    setDuration(formatMinutesAsDuration(log.duration_minutes, { hours: "h", minutes: "m" }));
    setLoggedOn(log.logged_on);
    setDescription(log.description);
    setError(undefined);
  };

  const handleSubmit = async () => {
    const minutes = parseDurationToMinutes(duration);
    if (!minutes || minutes > MAX_WORKLOG_MINUTES) {
      setError(t("worklog.duration_invalid"));
      return;
    }
    if (!loggedOn || loggedOn > today()) {
      setError(t("worklog.date_in_future"));
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = { duration_minutes: minutes, logged_on: loggedOn, description: description.trim() };
      if (editing) await workLogService.updateWorkLog(workspaceSlug, projectId, issueId, editing.id, payload);
      else await workLogService.createWorkLog(workspaceSlug, projectId, issueId, payload);
      await onChanged();
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t(editing ? "worklog.toasts.updated" : "worklog.toasts.created"),
      });
      resetForm();
    } catch (_error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: t("worklog.toasts.failed") });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (log: TIssueWorkLog) => {
    try {
      await workLogService.deleteWorkLog(workspaceSlug, projectId, issueId, log.id);
      await onChanged();
      if (editing?.id === log.id) resetForm();
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("success"), message: t("worklog.toasts.deleted") });
    } catch (_error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: t("worklog.toasts.failed") });
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <div className="space-y-4 p-5" data-prevent-outside-click>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-h5-medium text-primary">{t("worklog.title")}</h3>
          <span className="text-body-sm-medium text-secondary">
            {t("worklog.total")}: {formatMinutesAsDuration(totalMinutes, units)}
          </span>
        </div>

        {!readOnly && (
          <form
            className="space-y-2 rounded-lg border border-subtle bg-layer-1 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="flex flex-wrap gap-2">
              <div className="min-w-32 flex-1">
                <Input
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  placeholder={t("worklog.duration_placeholder")}
                  aria-label={t("worklog.duration")}
                  hasError={Boolean(error)}
                  className="w-full"
                />
              </div>
              <Input
                type="date"
                value={loggedOn}
                max={today()}
                onChange={(event) => setLoggedOn(event.target.value)}
                aria-label={t("worklog.date")}
                className="w-40"
              />
            </div>
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("worklog.comment_placeholder")}
              maxLength={2000}
              className="w-full"
            />
            <p className={error ? "text-body-xs-regular text-danger-primary" : "text-body-xs-regular text-tertiary"}>
              {error ?? t("worklog.duration_hint")}
            </p>
            <div className="flex items-center justify-end gap-2">
              {editing && (
                <Button variant="secondary" type="button" onClick={resetForm}>
                  {t("cancel")}
                </Button>
              )}
              <Button variant="primary" type="submit" loading={isSubmitting}>
                {editing ? t("update") : t("worklog.log_time")}
              </Button>
            </div>
          </form>
        )}

        {workLogs && workLogs.length === 0 ? (
          <p className="py-4 text-center text-body-xs-regular text-tertiary">{t("worklog.empty")}</p>
        ) : (
          <ul className="max-h-80 divide-y divide-subtle overflow-y-auto">
            {workLogs?.map((log) => {
              const canManage = !readOnly && (log.logged_by === currentUser?.id || isProjectAdmin);
              return (
                <li key={log.id} className="flex items-start gap-3 py-2.5">
                  <Avatar
                    size="sm"
                    name={log.logged_by_detail.display_name}
                    src={getFileURL(log.logged_by_detail.avatar_url)}
                    className="shrink-0"
                  />
                  <div className="min-w-0 grow">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-body-xs-medium text-primary">
                        {log.logged_by_detail.display_name}
                      </span>
                      <span className="shrink-0 text-body-xs-regular text-tertiary">
                        {renderFormattedDate(log.logged_on)}
                      </span>
                    </div>
                    {log.description && (
                      <p className="text-body-xs-regular break-words text-secondary">{log.description}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-body-xs-medium text-primary">
                    {formatMinutesAsDuration(log.duration_minutes, units)}
                  </span>
                  {canManage && (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label={t("worklog.edit_entry")}
                        className="rounded-sm p-1 text-tertiary hover:bg-layer-2-hover hover:text-secondary"
                        onClick={() => startEditing(log)}
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("worklog.delete_entry")}
                        className="rounded-sm p-1 text-tertiary hover:bg-layer-2-hover hover:text-danger-primary"
                        onClick={() => void handleDelete(log)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </ModalCore>
  );
});
