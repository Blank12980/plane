/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { AxiosRequestConfig } from "axios";
import { API_BASE_URL } from "@plane/constants";
// gizmo imports
import { getFileMetaDataForUpload, generateFileUploadPayload } from "@plane/services";
import type { TCommentAttachment, TCommentAttachmentUploadResponse } from "@plane/types";
// services
import { APIService } from "@/services/api.service";
import { FileUploadService } from "@/services/file-upload.service";

export class IssueCommentAttachmentService extends APIService {
  private fileUploadService: FileUploadService;

  constructor() {
    super(API_BASE_URL);
    this.fileUploadService = new FileUploadService();
  }

  private async updateCommentAttachmentUploadStatus(
    workspaceSlug: string,
    projectId: string,
    attachmentId: string
  ): Promise<TCommentAttachment> {
    return this.patch(
      `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/comment-attachments/${attachmentId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /**
   * Uploads a file and returns the created asset. `commentId` is omitted while a
   * new comment is being composed - the asset is bound to the comment once it exists.
   */
  async uploadCommentAttachment(
    workspaceSlug: string,
    projectId: string,
    file: File,
    commentId?: string,
    uploadProgressHandler?: AxiosRequestConfig["onUploadProgress"]
  ): Promise<TCommentAttachment> {
    const fileMetaData = await getFileMetaDataForUpload(file);
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/comment-attachments/`, {
      ...fileMetaData,
      comment_id: commentId,
    })
      .then(async (response) => {
        const signedURLResponse: TCommentAttachmentUploadResponse = response?.data;
        const fileUploadPayload = generateFileUploadPayload(signedURLResponse, file);
        await this.fileUploadService.uploadFile(
          signedURLResponse.upload_data.url,
          fileUploadPayload,
          uploadProgressHandler
        );
        return await this.updateCommentAttachmentUploadStatus(workspaceSlug, projectId, signedURLResponse.asset_id);
      })
      .catch((error) => {
        throw error?.response?.data ?? error;
      });
  }

  async getCommentAttachments(
    workspaceSlug: string,
    projectId: string,
    commentId: string
  ): Promise<TCommentAttachment[]> {
    return this.get(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/comment-attachments/`, {
      params: { comment_id: commentId },
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async deleteCommentAttachment(workspaceSlug: string, projectId: string, attachmentId: string): Promise<void> {
    return this.delete(
      `/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/comment-attachments/${attachmentId}/`
    )
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Binds already uploaded assets to the comment they were composed in. */
  async bindCommentAttachments(
    workspaceSlug: string,
    projectId: string,
    commentId: string,
    assetIds: string[]
  ): Promise<void> {
    return this.post(`/api/assets/v2/workspaces/${workspaceSlug}/projects/${projectId}/${commentId}/bulk/`, {
      asset_ids: assetIds,
    })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
