/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { pull, concat, update, uniq, set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// Gizmo Imports
import type {
  TCommentAttachment,
  TIssueComment,
  TIssueCommentMap,
  TIssueCommentIdMap,
  TIssueServiceType,
} from "@plane/types";
// services
import { IssueCommentAttachmentService, IssueCommentService } from "@/services/issue";
// types
import type { IIssueDetail } from "./root.store";

export type TCommentLoader = "fetch" | "create" | "update" | "delete" | "mutate" | undefined;

export interface IIssueCommentStoreActions {
  fetchComments: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType?: TCommentLoader
  ) => Promise<TIssueComment[]>;
  createComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  updateComment: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => Promise<any>;
  removeComment: (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => Promise<any>;
  uploadCommentAttachment: (
    workspaceSlug: string,
    projectId: string,
    file: File,
    commentId?: string,
    onProgress?: (progress: number) => void
  ) => Promise<TCommentAttachment>;
  removeCommentAttachment: (
    workspaceSlug: string,
    projectId: string,
    attachmentId: string,
    commentId?: string
  ) => Promise<void>;
  bindCommentAttachments: (
    workspaceSlug: string,
    projectId: string,
    commentId: string,
    attachments: TCommentAttachment[]
  ) => Promise<void>;
}

export interface IIssueCommentStore extends IIssueCommentStoreActions {
  // observables
  loader: TCommentLoader;
  comments: TIssueCommentIdMap;
  commentMap: TIssueCommentMap;
  // helper methods
  getCommentsByIssueId: (issueId: string) => string[] | undefined;
  getCommentById: (activityId: string) => TIssueComment | undefined;
  getCommentAttachmentsByCommentId: (commentId: string) => TCommentAttachment[];
}

export class IssueCommentStore implements IIssueCommentStore {
  // observables
  loader: TCommentLoader = "fetch";
  comments: TIssueCommentIdMap = {};
  commentMap: TIssueCommentMap = {};
  serviceType;
  // root store
  rootIssueDetail: IIssueDetail;
  // services
  issueCommentService;
  issueCommentAttachmentService;

  constructor(rootStore: IIssueDetail, serviceType: TIssueServiceType) {
    makeObservable(this, {
      // observables
      loader: observable.ref,
      comments: observable,
      commentMap: observable,
      // actions
      fetchComments: action,
      createComment: action,
      updateComment: action,
      removeComment: action,
      uploadCommentAttachment: action,
      removeCommentAttachment: action,
      bindCommentAttachments: action,
    });
    // root store
    this.serviceType = serviceType;
    this.rootIssueDetail = rootStore;
    // services
    this.issueCommentService = new IssueCommentService(serviceType);
    this.issueCommentAttachmentService = new IssueCommentAttachmentService();
  }

  // helper methods
  getCommentsByIssueId = (issueId: string) => {
    if (!issueId) return undefined;
    return this.comments[issueId] ?? undefined;
  };

  getCommentById = (commentId: string) => {
    if (!commentId) return undefined;
    return this.commentMap[commentId] ?? undefined;
  };

  getCommentAttachmentsByCommentId = (commentId: string) => this.commentMap[commentId]?.attachment_details ?? [];

  fetchComments = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    loaderType: TCommentLoader = "fetch"
  ) => {
    this.loader = loaderType;

    let props = {};
    const _commentIds = this.getCommentsByIssueId(issueId);
    if (_commentIds && _commentIds.length > 0) {
      const _comment = this.getCommentById(_commentIds[_commentIds.length - 1]);
      if (_comment) props = { created_at__gt: _comment.created_at };
    }

    const comments = await this.issueCommentService.getIssueComments(workspaceSlug, projectId, issueId, props);

    const commentIds = comments.map((comment) => comment.id);
    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return commentIds;
        return uniq(concat(_commentIds, commentIds));
      });
      comments.forEach((comment) => {
        this.rootIssueDetail.commentReaction.applyCommentReactions(comment.id, comment?.comment_reactions || []);
        set(this.commentMap, comment.id, { ...comment, attachment_details: comment.attachment_details ?? [] });
      });
      this.loader = undefined;
    });

    return comments;
  };

  createComment = async (workspaceSlug: string, projectId: string, issueId: string, data: Partial<TIssueComment>) => {
    const response = await this.issueCommentService.createIssueComment(workspaceSlug, projectId, issueId, data);

    runInAction(() => {
      update(this.comments, issueId, (_commentIds) => {
        if (!_commentIds) return [response.id];
        return uniq(concat(_commentIds, [response.id]));
      });
      set(this.commentMap, response.id, { ...response, attachment_details: response.attachment_details ?? [] });
    });

    return response;
  };

  updateComment = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    commentId: string,
    data: Partial<TIssueComment>
  ) => {
    try {
      runInAction(() => {
        Object.keys(data).forEach((key) => {
          set(this.commentMap, [commentId, key], data[key as keyof TIssueComment]);
        });
      });

      const response = await this.issueCommentService.patchIssueComment(
        workspaceSlug,
        projectId,
        issueId,
        commentId,
        data
      );

      runInAction(() => {
        set(this.commentMap, [commentId, "updated_at"], response.updated_at);
        set(this.commentMap, [commentId, "edited_at"], response.edited_at);
      });

      return response;
    } catch (error) {
      this.rootIssueDetail.activity.fetchActivities(workspaceSlug, projectId, issueId);
      throw error;
    }
  };

  removeComment = async (workspaceSlug: string, projectId: string, issueId: string, commentId: string) => {
    const response = await this.issueCommentService.deleteIssueComment(workspaceSlug, projectId, issueId, commentId);

    runInAction(() => {
      pull(this.comments[issueId], commentId);
      delete this.commentMap[commentId];
    });

    return response;
  };

  /**
   * Uploads a file to a comment. `commentId` is undefined while a new comment is
   * being composed - the asset stays unbound until `bindCommentAttachments` runs.
   */
  uploadCommentAttachment = async (
    workspaceSlug: string,
    projectId: string,
    file: File,
    commentId?: string,
    onProgress?: (progress: number) => void
  ) => {
    const attachment = await this.issueCommentAttachmentService.uploadCommentAttachment(
      workspaceSlug,
      projectId,
      file,
      commentId,
      (progressEvent) => onProgress?.(Math.round((progressEvent.progress ?? 0) * 100))
    );

    if (commentId && this.commentMap[commentId]) {
      runInAction(() => {
        update(this.commentMap[commentId], "attachment_details", (attachments: TCommentAttachment[] = []) =>
          uniq(concat(attachments, [attachment]))
        );
      });
    }

    return attachment;
  };

  removeCommentAttachment = async (
    workspaceSlug: string,
    projectId: string,
    attachmentId: string,
    commentId?: string
  ) => {
    await this.issueCommentAttachmentService.deleteCommentAttachment(workspaceSlug, projectId, attachmentId);

    if (commentId && this.commentMap[commentId]) {
      runInAction(() => {
        set(
          this.commentMap[commentId],
          "attachment_details",
          this.getCommentAttachmentsByCommentId(commentId).filter((attachment) => attachment.id !== attachmentId)
        );
      });
    }
  };

  bindCommentAttachments = async (
    workspaceSlug: string,
    projectId: string,
    commentId: string,
    attachments: TCommentAttachment[]
  ) => {
    if (attachments.length === 0) return;

    await this.issueCommentAttachmentService.bindCommentAttachments(
      workspaceSlug,
      projectId,
      commentId,
      attachments.map((attachment) => attachment.id)
    );

    if (this.commentMap[commentId]) {
      runInAction(() => {
        update(this.commentMap[commentId], "attachment_details", (existing: TCommentAttachment[] = []) =>
          uniq(concat(existing, attachments))
        );
      });
    }
  };
}
