/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useRef, useState } from "react";
import { observer } from "mobx-react";
// gizmo imports
import type { EditorRefApi } from "@plane/editor";
import type { TIssueComment, TCommentsOperations } from "@plane/types";
import { Button } from "@plane/propel/button";
import { CommentCreate } from "../comment-create";
// gizmo web imports
import { CommentBlock, CommentCardDisplay } from "@/plane-web/components/comments";
// local imports
import { CommentQuickActions } from "../quick-actions";

type TCommentCard = {
  workspaceSlug: string;
  entityId: string;
  comment: TIssueComment | undefined;
  activityOperations: TCommentsOperations;
  ends: "top" | "bottom" | undefined;
  showAccessSpecifier: boolean;
  showCopyLinkOption: boolean;
  enableReplies: boolean;
  disabled?: boolean;
  projectId?: string;
  replies?: TIssueComment[];
  repliesByParent?: Record<string, TIssueComment[]>;
  depth?: number;
  /** Display name of the author this comment answers, shown above replies. */
  replyToName?: string;
};

/** Number of all replies below a comment, including nested ones. */
const countThreadReplies = (
  commentId: string,
  repliesByParent: Record<string, TIssueComment[]>,
  visited: Set<string> = new Set()
): number => {
  if (visited.has(commentId)) return 0;
  visited.add(commentId);
  return (repliesByParent[commentId] ?? []).reduce(
    (total, reply) => total + 1 + countThreadReplies(reply.id, repliesByParent, visited),
    0
  );
};

const pluralizeReplies = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ответ`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} ответа`;
  return `${count} ответов`;
};

export const CommentCard = observer(function CommentCard(props: TCommentCard) {
  const {
    workspaceSlug,
    entityId,
    comment,
    activityOperations,
    ends,
    showAccessSpecifier,
    showCopyLinkOption,
    disabled = false,
    projectId,
    enableReplies,
    replies = [],
    repliesByParent = {},
    depth = 0,
    replyToName,
  } = props;
  // states
  const [isEditing, setIsEditing] = useState(false);
  const [isReplying, setIsReplying] = useState(false);
  const [isThreadCollapsed, setIsThreadCollapsed] = useState(false);
  // refs
  const readOnlyEditorRef = useRef<EditorRefApi>(null);
  // derived values
  const workspaceId = comment?.workspace;

  if (!comment || !workspaceId) return null;

  const threadSize = countThreadReplies(comment.id, repliesByParent);

  return (
    <div>
      <CommentBlock comment={comment} ends={ends}>
        {depth > 0 && replyToName && (
          <p className="mb-2 text-12 text-tertiary">
            В ответ на <span className="font-medium text-secondary">{replyToName}</span>
          </p>
        )}
        <CommentCardDisplay
          activityOperations={activityOperations}
          entityId={entityId}
          comment={comment}
          disabled={disabled}
          projectId={projectId}
          readOnlyEditorRef={readOnlyEditorRef}
          showAccessSpecifier={showAccessSpecifier}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          isEditing={isEditing}
          setIsEditing={setIsEditing}
          renderQuickActions={() => (
            <CommentQuickActions
              activityOperations={activityOperations}
              comment={comment}
              setEditMode={() => setIsEditing(true)}
              showAccessSpecifier={showAccessSpecifier && !comment.parent && replies.length === 0}
              showCopyLinkOption={showCopyLinkOption}
            />
          )}
        />
        {enableReplies && !disabled && (
          <Button variant="tertiary" size="sm" onClick={() => setIsReplying(!isReplying)} aria-expanded={isReplying}>
            {isReplying ? "Отменить ответ" : "Ответить"}
          </Button>
        )}
        {isReplying && !disabled && (
          <div className="mt-2 whitespace-normal" aria-label="Ответ на комментарий">
            <CommentCreate
              workspaceSlug={workspaceSlug}
              entityId={entityId}
              projectId={projectId}
              activityOperations={activityOperations}
              parentCommentId={comment.id}
              replyToCommentId={comment.id}
              access={comment.access}
              showToolbarInitially
              onSubmitCallback={() => {
                setIsReplying(false);
                // show the new reply even if the thread was collapsed
                setIsThreadCollapsed(false);
              }}
            />
          </div>
        )}
      </CommentBlock>
      {replies.length > 0 && (
        <div
          className={
            depth < 3 ? "ml-5 border-l-2 border-accent-subtle pl-3 sm:ml-9" : "border-l-2 border-accent-subtle pl-2"
          }
          aria-label="Ветка комментариев"
        >
          <button
            type="button"
            className="py-1 text-12 text-tertiary hover:text-secondary"
            aria-expanded={!isThreadCollapsed}
            onClick={() => setIsThreadCollapsed((collapsed) => !collapsed)}
          >
            {isThreadCollapsed ? "Показать ветку" : "Скрыть ветку"} · {pluralizeReplies(threadSize)}
          </button>
          {!isThreadCollapsed &&
            replies.map((reply) => (
              <CommentCard
                key={reply.id}
                workspaceSlug={workspaceSlug}
                entityId={entityId}
                projectId={projectId}
                comment={reply}
                activityOperations={activityOperations}
                ends={undefined}
                showAccessSpecifier={false}
                showCopyLinkOption={showCopyLinkOption}
                enableReplies={enableReplies}
                disabled={disabled}
                replies={repliesByParent[reply.id]}
                repliesByParent={repliesByParent}
                depth={depth + 1}
                replyToName={comment.actor_detail?.display_name}
              />
            ))}
        </div>
      )}
    </div>
  );
});
