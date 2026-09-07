/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useState } from "react";
import { v4 as uuidv4 } from "uuid";
// gizmo imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TCommentAttachment, TCommentAttachmentUploadStatus, TCommentsOperations } from "@plane/types";
// gizmo web hooks
import { useFileSize } from "@/plane-web/hooks/use-file-size";

type TProps = {
  activityOperations: TCommentsOperations;
  /** Only set when the comment already exists - uploads are then bound right away. */
  commentId?: string;
};

export type TCommentAttachmentHelpers = {
  /** Assets uploaded for a comment that has not been created yet. */
  pendingAttachments: TCommentAttachment[];
  uploadStatus: TCommentAttachmentUploadStatus[];
  isUploading: boolean;
  uploadFiles: (files: File[]) => Promise<void>;
  removeAttachment: (attachmentId: string) => Promise<void>;
  clearPendingAttachments: () => void;
};

export const useCommentAttachments = (props: TProps): TCommentAttachmentHelpers => {
  const { activityOperations, commentId } = props;
  // states
  const [pendingAttachments, setPendingAttachments] = useState<TCommentAttachment[]>([]);
  const [uploadStatusMap, setUploadStatusMap] = useState<Record<string, TCommentAttachmentUploadStatus>>({});
  // hooks
  const { maxFileSize } = useFileSize();
  const { t } = useTranslation();

  const uploadFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        if (file.size > maxFileSize) {
          setToast({
            title: t("common.error.label"),
            type: TOAST_TYPE.ERROR,
            message: t("issue.comments.attachment.size_error", {
              size: Math.round(maxFileSize / 1024 / 1024),
            }),
          });
          continue;
        }

        const tempId = uuidv4();
        setUploadStatusMap((prev) => ({
          ...prev,
          [tempId]: { id: tempId, name: file.name, progress: 0, size: file.size, type: file.type },
        }));

        try {
          const attachment = await activityOperations.uploadCommentAttachment(file, commentId, (progress) =>
            setUploadStatusMap((prev) => (prev[tempId] ? { ...prev, [tempId]: { ...prev[tempId], progress } } : prev))
          );
          // A comment that does not exist yet cannot own the asset, so keep it
          // around until the comment is created and the assets are bound to it.
          if (!commentId) setPendingAttachments((prev) => [...prev, attachment]);
        } catch {
          // the operation already reports the failure to the user
        } finally {
          setUploadStatusMap((prev) => {
            const next = { ...prev };
            delete next[tempId];
            return next;
          });
        }
      }
    },
    [activityOperations, commentId, maxFileSize, t]
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      await activityOperations.removeCommentAttachment(attachmentId, commentId);
      if (!commentId) setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
    },
    [activityOperations, commentId]
  );

  const clearPendingAttachments = useCallback(() => setPendingAttachments([]), []);

  const uploadStatus = Object.values(uploadStatusMap);

  return {
    pendingAttachments,
    uploadStatus,
    isUploading: uploadStatus.length > 0,
    uploadFiles,
    removeAttachment,
    clearPendingAttachments,
  };
};
