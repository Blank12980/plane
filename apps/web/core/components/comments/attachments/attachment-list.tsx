/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// gizmo imports
import type { TCommentAttachment, TCommentAttachmentUploadStatus } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
// local imports
import { CommentAttachmentChip } from "./attachment-chip";

type Props = {
  attachments: TCommentAttachment[];
  uploadStatus?: TCommentAttachmentUploadStatus[];
  onRemove?: (attachmentId: string) => void;
  disabled?: boolean;
  className?: string;
};

export const CommentAttachmentList = observer(function CommentAttachmentList(props: Props) {
  const { attachments, uploadStatus = [], onRemove, disabled = false, className } = props;

  if (attachments.length === 0 && uploadStatus.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {attachments.map((attachment) => (
        <CommentAttachmentChip
          key={attachment.id}
          name={attachment.attributes?.name ?? ""}
          size={attachment.attributes?.size ?? attachment.size}
          href={getFileURL(attachment.asset_url)}
          disabled={disabled}
          onRemove={onRemove ? () => onRemove(attachment.id) : undefined}
        />
      ))}
      {uploadStatus.map((upload) => (
        <CommentAttachmentChip key={upload.id} name={upload.name} size={upload.size} progress={upload.progress} />
      ))}
    </div>
  );
});
