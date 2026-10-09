/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { observer } from "mobx-react";
// gizmo imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkspaceTag } from "@plane/types";
import { AlertModalCore } from "@plane/ui";
// hooks
import { useWorkspaceTag } from "@/hooks/store/use-workspace-tag";

type Props = {
  workspaceSlug: string;
  tag: TWorkspaceTag | null;
  isOpen: boolean;
  onClose: () => void;
};

export const DeleteTagModal = observer(function DeleteTagModal(props: Props) {
  const { workspaceSlug, tag, isOpen, onClose } = props;
  const { t } = useTranslation();
  // store hooks
  const { deleteTag } = useWorkspaceTag();
  // states
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!tag) return;
    setIsDeleting(true);
    try {
      await deleteTag(workspaceSlug, tag.id);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("success"),
        message: t("workspace_settings.settings.tags.toasts.deleted"),
      });
      onClose();
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("error"),
        message: t("workspace_settings.settings.tags.toasts.error"),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AlertModalCore
      handleClose={onClose}
      handleSubmit={handleDelete}
      isSubmitting={isDeleting}
      isOpen={isOpen}
      title={t("workspace_settings.settings.tags.delete_title")}
      content={t("workspace_settings.settings.tags.delete_description", { name: tag?.name ?? "" })}
    />
  );
});
