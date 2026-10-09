/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Plus } from "lucide-react";
import { observer } from "mobx-react";
import useSWR from "swr";
// gizmo imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkspaceTag } from "@plane/types";
import { CustomSearchSelect } from "@plane/ui";
// components
import { TagChip } from "@/components/workspace/tags/tag-chip";
// hooks
import { useWorkspaceTag } from "@/hooks/store/use-workspace-tag";
// services
import { WorkspaceTagService } from "@/services/workspace-tag.service";

const tagService = new WorkspaceTagService();

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  disabled: boolean;
};

/** Shows the workspace tags attached to a work item and lets members change them. */
export const IssueTagSelect = observer(function IssueTagSelect(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled } = props;
  const { t } = useTranslation();
  // store hooks
  const { getWorkspaceTags, getTagById, fetchWorkspaceTags } = useWorkspaceTag();

  useSWR(`WORKSPACE_TAGS_${workspaceSlug}`, () => fetchWorkspaceTags(workspaceSlug), {
    revalidateIfStale: false,
    revalidateOnFocus: false,
  });
  const { data: tagIds, mutate } = useSWR(`ISSUE_TAGS_${issueId}`, () =>
    tagService.getIssueTagIds(workspaceSlug, projectId, issueId)
  );

  // derived values
  const workspaceTags = getWorkspaceTags(workspaceSlug) ?? [];
  // a tag deleted in settings can still be in a cached id list
  const selectedTags = (tagIds ?? [])
    .map((tagId) => getTagById(tagId))
    .filter((tag): tag is TWorkspaceTag => Boolean(tag));
  const selectedIds = selectedTags.map((tag) => tag.id);

  const handleChange = async (nextIds: string[]) => {
    try {
      await mutate(tagService.setIssueTagIds(workspaceSlug, projectId, issueId, nextIds), {
        optimisticData: nextIds,
        rollbackOnError: true,
        revalidate: false,
      });
    } catch (_error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("error"), message: t("tags.update_failed") });
    }
  };

  const options = workspaceTags.map((tag) => ({
    value: tag.id,
    query: tag.name,
    content: <TagChip tag={tag} />,
  }));

  return (
    <div className="flex min-h-7.5 w-full flex-wrap items-center gap-1 px-2">
      {selectedTags.map((tag) => (
        <TagChip key={tag.id} tag={tag} />
      ))}
      {!disabled ? (
        <CustomSearchSelect
          multiple
          value={selectedIds}
          onChange={(ids: string[]) => void handleChange(ids)}
          options={options}
          noResultsMessage={workspaceTags.length === 0 ? t("tags.none_in_workspace") : undefined}
          noChevron
          customButton={
            <span className="flex items-center gap-1 rounded-sm px-1 py-0.5 text-body-xs-regular text-placeholder hover:bg-layer-transparent-hover">
              <Plus className="size-3" />
              {selectedTags.length === 0 && t("tags.add")}
            </span>
          }
          placement="bottom-start"
        />
      ) : (
        selectedTags.length === 0 && <span className="text-body-xs-regular text-placeholder">{t("none")}</span>
      )}
    </div>
  );
});
