/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
import { useForm, Controller } from "react-hook-form";
// gizmo imports
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { EditorRefApi } from "@plane/editor";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { cn, isCommentEmpty } from "@plane/utils";
// components
import { LiteTextEditor } from "@/components/editor/lite-text";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import { FileService } from "@/services/file.service";
// local imports
import { CommentAttachmentButton, CommentAttachmentList, useCommentAttachments } from "./attachments";

type TCommentCreate = {
  entityId: string;
  workspaceSlug: string;
  activityOperations: TCommentsOperations;
  showToolbarInitially?: boolean;
  projectId?: string;
  onSubmitCallback?: (elementId: string) => void;
  parentCommentId?: string;
  replyToCommentId?: string;
  access?: TIssueComment["access"];
};

// services
const fileService = new FileService();

export const CommentCreate = observer(function CommentCreate(props: TCommentCreate) {
  const {
    workspaceSlug,
    entityId,
    activityOperations,
    showToolbarInitially = false,
    projectId,
    onSubmitCallback,
    parentCommentId,
    replyToCommentId,
    access,
  } = props;
  // states
  const [uploadedAssetIds, setUploadedAssetIds] = useState<string[]>([]);
  // refs
  const editorRef = useRef<EditorRefApi>(null);
  const pendingCommentRef = useRef<Partial<TIssueComment> | null>(null);
  // comment attachments
  const { pendingAttachments, uploadStatus, isUploading, uploadFiles, removeAttachment, clearPendingAttachments } =
    useCommentAttachments({ activityOperations });
  // store hooks
  const workspaceStore = useWorkspace();
  // derived values
  const workspaceId = workspaceStore.getWorkspaceBySlug(workspaceSlug)?.id as string;
  // form info
  const {
    handleSubmit,
    control,
    watch,
    formState: { isSubmitting },
    reset,
  } = useForm<Partial<TIssueComment>>({
    defaultValues: {
      comment_html: "<p></p>",
      access,
    },
  });

  const onSubmit = async (formData: Partial<TIssueComment>) => {
    // wait for every attachment to finish uploading before the comment is created
    if (isUploading) return;
    try {
      const payload: Partial<TIssueComment> = {
        ...formData,
        ...(parentCommentId ? { parent: parentCommentId, access } : {}),
      };
      const comment = pendingCommentRef.current ?? (await activityOperations.createComment(payload));
      if (!comment?.id) throw new Error("Comment was not created");
      if (pendingCommentRef.current) await activityOperations.updateComment(comment.id, payload);
      pendingCommentRef.current = comment;
      // Retrying a failed attachment upload must reuse the comment that already exists.
      await activityOperations.bindCommentAttachments(comment.id, pendingAttachments);
      clearPendingAttachments();
      if (uploadedAssetIds.length > 0) {
        if (projectId) {
          await fileService.updateBulkProjectAssetsUploadStatus(workspaceSlug, projectId.toString(), entityId, {
            asset_ids: uploadedAssetIds,
          });
        } else {
          await fileService.updateBulkWorkspaceAssetsUploadStatus(workspaceSlug, entityId, {
            asset_ids: uploadedAssetIds,
          });
        }
        setUploadedAssetIds([]);
      }
      reset({
        comment_html: "<p></p>",
        access,
      });
      editorRef.current?.clearEditor();
      pendingCommentRef.current = null;
      onSubmitCallback?.(comment.id);
    } catch (error) {
      console.error(error);
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось отправить комментарий",
        message: "Текст сохранён. Попробуйте ещё раз.",
      });
    }
  };

  const commentHTML = watch("comment_html");
  const hasAttachments = pendingAttachments.length > 0;
  const isEmpty = isCommentEmpty(commentHTML ?? undefined) && !hasAttachments;

  return (
    <div
      className={cn("sticky bottom-0 z-[4] bg-surface-1 sm:static")}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          !e.shiftKey &&
          !e.ctrlKey &&
          !e.metaKey &&
          !isEmpty &&
          !isSubmitting &&
          !isUploading &&
          editorRef.current?.isEditorReadyToDiscard()
        )
          handleSubmit(onSubmit)(e);
      }}
    >
      <Controller
        name="access"
        control={control}
        render={({ field: { onChange: onAccessChange, value: accessValue } }) => (
          <Controller
            name="comment_html"
            control={control}
            render={({ field: { value, onChange } }) => (
              <LiteTextEditor
                editable
                workspaceId={workspaceId}
                id={"add_comment_" + entityId + (replyToCommentId ? `_${replyToCommentId}` : "")}
                value={"<p></p>"}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                onEnterKeyPress={(e) => {
                  if (!isEmpty && !isSubmitting && !isUploading) {
                    handleSubmit(onSubmit)(e);
                  }
                }}
                ref={editorRef}
                initialValue={value ?? "<p></p>"}
                containerClassName="min-h-min"
                onChange={(comment_json, comment_html) => onChange(comment_html)}
                accessSpecifier={accessValue ?? access ?? EIssueCommentAccessSpecifier.INTERNAL}
                handleAccessChange={parentCommentId ? undefined : onAccessChange}
                isSubmitting={isSubmitting}
                uploadFile={async (blockId, file) => {
                  const { asset_id } = await activityOperations.uploadCommentAsset(blockId, file);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                duplicateFile={async (assetId: string) => {
                  const { asset_id } = await activityOperations.duplicateCommentAsset(assetId);
                  setUploadedAssetIds((prev) => [...prev, asset_id]);
                  return asset_id;
                }}
                showToolbarInitially={showToolbarInitially}
                allowEmptySubmit={hasAttachments}
                extraToolbarActions={<CommentAttachmentButton onFilesSelected={uploadFiles} disabled={isSubmitting} />}
                parentClassName="p-2"
                displayConfig={{
                  fontSize: "small-font",
                }}
              />
            )}
          />
        )}
      />
      <CommentAttachmentList
        attachments={pendingAttachments}
        uploadStatus={uploadStatus}
        onRemove={removeAttachment}
        disabled={isSubmitting}
        className="px-2 pb-2"
      />
    </div>
  );
});
