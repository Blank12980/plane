import type { TIssueComment } from "@plane/types";

export function groupCommentReplies(comments: TIssueComment[]) {
  const ids = new Set(comments.map((comment) => comment.id));
  const replies: Record<string, TIssueComment[]> = {};
  const roots: TIssueComment[] = [];
  for (const comment of comments) {
    if (comment.parent && comment.parent !== comment.id && ids.has(comment.parent)) {
      (replies[comment.parent] ??= []).push(comment);
    } else roots.push(comment);
  }
  Object.values(replies).forEach((thread) => thread.sort((a, b) => a.created_at.localeCompare(b.created_at)));
  return { roots, replies };
}
