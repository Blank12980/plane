/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
// types
import type { TWorkspaceTag, TWorkspaceTagPayload } from "@plane/types";
// services
import { WorkspaceTagService } from "@/services/workspace-tag.service";

export interface IWorkspaceTagStore {
  // observables
  tagMap: Record<string, TWorkspaceTag>;
  // tag ids per workspace slug, present once the workspace tags were fetched
  workspaceTagIds: Record<string, string[]>;
  // computed actions
  getWorkspaceTags: (workspaceSlug: string) => TWorkspaceTag[] | undefined;
  getTagById: (tagId: string) => TWorkspaceTag | undefined;
  // fetch actions
  fetchWorkspaceTags: (workspaceSlug: string) => Promise<TWorkspaceTag[]>;
  // crud actions
  createTag: (workspaceSlug: string, data: TWorkspaceTagPayload) => Promise<TWorkspaceTag>;
  updateTag: (workspaceSlug: string, tagId: string, data: Partial<TWorkspaceTagPayload>) => Promise<TWorkspaceTag>;
  deleteTag: (workspaceSlug: string, tagId: string) => Promise<void>;
  /** Re-reads the tags of a workspace, e.g. after an image was uploaded outside of the store. */
  refreshTags: (workspaceSlug: string) => Promise<void>;
}

export class WorkspaceTagStore implements IWorkspaceTagStore {
  tagMap: Record<string, TWorkspaceTag> = {};
  workspaceTagIds: Record<string, string[]> = {};
  // services
  private tagService = new WorkspaceTagService();

  constructor() {
    makeObservable(this, {
      tagMap: observable,
      workspaceTagIds: observable,
      fetchWorkspaceTags: action,
      createTag: action,
      updateTag: action,
      deleteTag: action,
      refreshTags: action,
    });
  }

  /** Tags of a workspace sorted by name, `undefined` until they were fetched. */
  getWorkspaceTags = computedFn((workspaceSlug: string) => {
    const ids = this.workspaceTagIds[workspaceSlug];
    if (!ids) return undefined;
    const tags = ids.map((id) => this.tagMap[id]).filter((tag): tag is TWorkspaceTag => Boolean(tag));
    return sortBy(tags, (tag) => tag.name.toLowerCase());
  });

  getTagById = computedFn((tagId: string): TWorkspaceTag | undefined => this.tagMap[tagId]);

  fetchWorkspaceTags = async (workspaceSlug: string) => {
    const tags = await this.tagService.getTags(workspaceSlug);
    runInAction(() => {
      tags.forEach((tag) => {
        this.tagMap[tag.id] = tag;
      });
      this.workspaceTagIds[workspaceSlug] = tags.map((tag) => tag.id);
    });
    return tags;
  };

  refreshTags = async (workspaceSlug: string) => {
    await this.fetchWorkspaceTags(workspaceSlug);
  };

  createTag = async (workspaceSlug: string, data: TWorkspaceTagPayload) => {
    const tag = await this.tagService.createTag(workspaceSlug, data);
    runInAction(() => {
      this.tagMap[tag.id] = tag;
      this.workspaceTagIds[workspaceSlug] = [...(this.workspaceTagIds[workspaceSlug] ?? []), tag.id];
    });
    return tag;
  };

  updateTag = async (workspaceSlug: string, tagId: string, data: Partial<TWorkspaceTagPayload>) => {
    const tag = await this.tagService.updateTag(workspaceSlug, tagId, data);
    runInAction(() => {
      this.tagMap[tag.id] = tag;
    });
    return tag;
  };

  deleteTag = async (workspaceSlug: string, tagId: string) => {
    await this.tagService.deleteTag(workspaceSlug, tagId);
    runInAction(() => {
      delete this.tagMap[tagId];
      this.workspaceTagIds[workspaceSlug] = (this.workspaceTagIds[workspaceSlug] ?? []).filter((id) => id !== tagId);
    });
  };
}
