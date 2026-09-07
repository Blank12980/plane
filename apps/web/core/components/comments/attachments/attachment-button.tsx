/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef } from "react";
import { Paperclip } from "lucide-react";
// gizmo imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";

type Props = {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
};

export function CommentAttachmentButton(props: Props) {
  const { onFilesSelected, disabled = false, className } = props;
  // refs
  const inputRef = useRef<HTMLInputElement>(null);
  // hooks
  const { t } = useTranslation();

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onFilesSelected(files);
          // allow selecting the same file again
          e.target.value = "";
        }}
      />
      <Tooltip tooltipContent={t("issue.comments.attachment.add")}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "grid aspect-square place-items-center rounded-xs p-1 text-placeholder hover:bg-layer-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <Paperclip className="size-3.5" strokeWidth={2.5} />
        </button>
      </Tooltip>
    </>
  );
}
