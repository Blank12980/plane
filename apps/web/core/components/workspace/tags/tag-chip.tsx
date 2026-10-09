/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkspaceTag } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";

type Props = {
  tag: Pick<TWorkspaceTag, "name" | "color" | "image_url">;
  className?: string;
};

/** A tag as a small pill: its image when it has one, otherwise a dot in its colour, then the name. */
export function TagChip(props: Props) {
  const { tag, className } = props;
  const imageUrl = tag.image_url ? getFileURL(tag.image_url) : undefined;

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-subtle bg-layer-2 py-0.5 pr-2 pl-1.5 text-body-xs-regular text-secondary",
        className
      )}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" className="size-4 shrink-0 rounded-full object-cover" />
      ) : tag.color ? (
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
      ) : null}
      <span className="truncate">{tag.name}</span>
    </span>
  );
}
