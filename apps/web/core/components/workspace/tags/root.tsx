/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
// gizmo imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { EmptyStateCompact } from "@plane/propel/empty-state";
import type { TWorkspaceTag } from "@plane/types";
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useWorkspaceTag } from "@/hooks/store/use-workspace-tag";
// local imports
import { DeleteTagModal } from "./delete-tag-modal";
import { TagChip } from "./tag-chip";
import { TagFormModal } from "./tag-form-modal";

type Props = {
  workspaceSlug: string;
};

export const WorkspaceTagsRoot = observer(function WorkspaceTagsRoot(props: Props) {
  const { workspaceSlug } = props;
  const { t } = useTranslation();
  // store hooks
  const { getWorkspaceTags, fetchWorkspaceTags } = useWorkspaceTag();
  // states
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [tagToEdit, setTagToEdit] = useState<TWorkspaceTag | null>(null);
  const [tagToDelete, setTagToDelete] = useState<TWorkspaceTag | null>(null);

  useSWR(`WORKSPACE_TAGS_${workspaceSlug}`, () => fetchWorkspaceTags(workspaceSlug), {
    revalidateIfStale: false,
    revalidateOnFocus: false,
  });

  const tags = getWorkspaceTags(workspaceSlug);

  const openCreate = () => {
    setTagToEdit(null);
    setIsFormOpen(true);
  };

  return (
    <div className="w-full">
      <TagFormModal
        workspaceSlug={workspaceSlug}
        tag={tagToEdit}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
      />
      <DeleteTagModal
        workspaceSlug={workspaceSlug}
        tag={tagToDelete}
        isOpen={Boolean(tagToDelete)}
        onClose={() => setTagToDelete(null)}
      />
      <SettingsHeading
        title={t("workspace_settings.settings.tags.heading")}
        description={t("workspace_settings.settings.tags.description")}
        control={
          <Button variant="primary" size="lg" onClick={openCreate}>
            {t("workspace_settings.settings.tags.add_tag")}
          </Button>
        }
      />
      {tags && tags.length === 0 ? (
        <EmptyStateCompact
          assetKey="label"
          title={t("workspace_settings.settings.tags.empty.title")}
          description={t("workspace_settings.settings.tags.empty.description")}
          actions={[{ label: t("workspace_settings.settings.tags.add_tag"), onClick: openCreate }]}
          align="start"
          rootClassName="py-20"
        />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {tags?.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-layer-2 px-4 py-3"
            >
              <TagChip tag={tag} className="text-body-sm-medium" />
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={t("edit")}
                  className="rounded-sm p-1.5 text-tertiary hover:bg-layer-2-hover hover:text-secondary"
                  onClick={() => {
                    setTagToEdit(tag);
                    setIsFormOpen(true);
                  }}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={t("delete")}
                  className="rounded-sm p-1.5 text-tertiary hover:bg-layer-2-hover hover:text-danger-primary"
                  onClick={() => setTagToDelete(tag)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
