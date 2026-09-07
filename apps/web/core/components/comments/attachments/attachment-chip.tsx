/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { CloseIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { cn, convertBytesToSize, getFileExtension } from "@plane/utils";
// components
import { getFileIcon } from "@/components/icons";

type Props = {
  name: string;
  size: number;
  href?: string;
  /** Upload progress in percent, only set while the file is being uploaded. */
  progress?: number;
  onRemove?: () => void;
  disabled?: boolean;
};

export function CommentAttachmentChip(props: Props) {
  const { name, size, href, progress, onRemove, disabled = false } = props;
  // derived values
  const fileExtension = getFileExtension(name);
  const isUploading = progress !== undefined;

  const content = (
    <>
      <span className="flex size-4 shrink-0 items-center justify-center">{getFileIcon(fileExtension, 16)}</span>
      <Tooltip tooltipContent={name}>
        <span className="max-w-40 truncate text-secondary">{name}</span>
      </Tooltip>
      <span className="shrink-0 text-placeholder">{convertBytesToSize(size)}</span>
    </>
  );

  return (
    <div
      className={cn(
        "relative flex items-center gap-2 overflow-hidden rounded-md border border-subtle bg-surface-1 px-2 py-1 text-11",
        {
          "opacity-70": isUploading,
        }
      )}
    >
      {isUploading && (
        <span
          className="absolute inset-y-0 left-0 bg-accent-primary/10 transition-[width] duration-200"
          style={{ width: `${progress}%` }}
        />
      )}
      {href && !isUploading ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="relative flex items-center gap-2 overflow-hidden"
        >
          {content}
        </a>
      ) : (
        <span className="relative flex items-center gap-2 overflow-hidden">{content}</span>
      )}
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="relative shrink-0 text-tertiary transition-colors hover:text-danger-primary"
        >
          <CloseIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
