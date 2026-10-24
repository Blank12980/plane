/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
// gizmo imports
import { CORE_EXTENSIONS } from "@plane/utils";
// constants
import { CORE_EDITOR_META } from "@/constants/meta";
// extensions
import { ECustomImageStatus } from "@/extensions/custom-image/types";
// plane editor imports
import { NODE_FILE_MAP } from "@/plane-editor/constants/utility";
// types
import type { TFileHandler } from "@/types";
// local imports
import type { NodeFileMapType } from "../../../ce/constants/utility";
import type { TFileNode } from "./types";

const DELETE_PLUGIN_KEY = new PluginKey("delete-utility");

/**
 * A pasted image stays in the "duplicating" state until its copy is created, and in the "duplication-failed" state if
 * that never happens. Until then its `src` is the asset it was copied from, which is owned by another place (another
 * work item, page or comment), so it must never be deleted when this node is replaced by its copy or removed.
 */
const isCopyOfAnotherAsset = (node: ProseMirrorNode): boolean =>
  node.type.name === CORE_EXTENSIONS.CUSTOM_IMAGE &&
  (node.attrs.status === ECustomImageStatus.DUPLICATING || node.attrs.status === ECustomImageStatus.DUPLICATION_FAILED);

export const TrackFileDeletionPlugin = (editor: Editor, deleteHandler: TFileHandler["delete"]): Plugin =>
  new Plugin({
    key: DELETE_PLUGIN_KEY,
    appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
      const newFileSources: {
        [nodeType: string]: Set<string> | undefined;
      } = {};
      if (!transactions.some((tr) => tr.docChanged)) return null;
      if (transactions.some((tr) => tr.getMeta(CORE_EDITOR_META.SKIP_FILE_DELETION))) return null;

      newState.doc.descendants((node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
        if (nodeFileSetDetails) {
          if (newFileSources[nodeType]) {
            newFileSources[nodeType].add(node.attrs.src);
          } else {
            newFileSources[nodeType] = new Set([node.attrs.src]);
          }
        }
      });

      const removedFiles: TFileNode[] = [];

      // iterate through all the nodes in the old state
      oldState.doc.descendants((node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const isAValidNode = NODE_FILE_MAP[nodeType];
        // if the node doesn't match, then return as no point in checking
        if (!isAValidNode) return;
        // the asset of a not yet duplicated node belongs to somewhere else, don't touch it
        if (isCopyOfAnotherAsset(node)) return;
        // Check if the node has been deleted or replaced
        if (!newFileSources[nodeType]?.has(node.attrs.src)) {
          removedFiles.push(node as TFileNode);
        }
      });

      removedFiles.forEach(async (node) => {
        const nodeType = node.type.name as keyof NodeFileMapType;
        const src = node.attrs.src;
        const nodeFileSetDetails = NODE_FILE_MAP[nodeType];
        if (!nodeFileSetDetails || !src) return;
        try {
          editor.storage[nodeType]?.[nodeFileSetDetails.fileSetName]?.set(src, true);
          // update assets list storage value
          editor.commands.updateAssetsList?.({
            idToRemove: node.attrs.id,
          });
          await deleteHandler(src);
        } catch (error) {
          console.error("Error deleting file via delete utility plugin:", error);
        }
      });

      return null;
    },
  });
