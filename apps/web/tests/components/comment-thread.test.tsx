import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TCommentsOperations, TIssueComment } from "@plane/types";
import { groupCommentReplies } from "@/helpers/comment-threads";
import { CommentCard } from "@/components/comments/card/root";

vi.mock("@plane/propel/button", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock("@/components/comments/comment-create", () => ({
  CommentCreate: ({ parentCommentId }: { parentCommentId?: string }) => <div data-testid="reply-form">{parentCommentId}</div>,
}));
vi.mock("@/components/comments/quick-actions", () => ({ CommentQuickActions: () => null }));
vi.mock("@/plane-web/components/comments", () => ({
  CommentBlock: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  CommentCardDisplay: ({ comment }: { comment: TIssueComment }) => <p data-comment={comment.id}>{comment.id}</p>,
}));

const comment = (id: string, parent: string | null, author: string, created = "2026-10-01T00:00:00Z") =>
  ({
    id,
    parent,
    workspace: "workspace",
    access: "INTERNAL",
    created_at: created,
    actor_detail: { display_name: author },
  }) as unknown as TIssueComment;

const comments = [
  comment("root", null, "Анна"),
  comment("reply-1", "root", "Борис", "2026-10-01T01:00:00Z"),
  comment("reply-2", "root", "Вера", "2026-10-01T02:00:00Z"),
  comment("nested", "reply-1", "Анна", "2026-10-01T03:00:00Z"),
];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(disabled = false) {
  const { roots, replies } = groupCommentReplies(comments);
  await act(async () =>
    root.render(
      <CommentCard
        workspaceSlug="space"
        entityId="issue"
        comment={roots[0]}
        activityOperations={{} as TCommentsOperations}
        ends={undefined}
        showAccessSpecifier={false}
        showCopyLinkOption={false}
        enableReplies
        disabled={disabled}
        replies={replies[roots[0].id]}
        repliesByParent={replies}
      />
    )
  );
}

const textOf = () => container.textContent ?? "";
const buttonByText = (text: string) => [...container.querySelectorAll("button")].find((item) => item.textContent === text);

test("a thread shows the whole branch with the author each reply answers", async () => {
  await render();
  expect(["root", "reply-1", "reply-2", "nested"].every((id) => container.querySelector(`[data-comment=${id}]`))).toBe(true);
  expect(textOf()).toContain("Скрыть ветку · 3 ответа");
  expect(textOf()).toContain("В ответ на Анна");
  expect(textOf()).toContain("В ответ на Борис");
});

test("the branch can be collapsed and expanded", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  expect(container.querySelector("[data-comment=reply-1]")).toBeNull();
  expect(container.querySelector("[data-comment=root]")).not.toBeNull();
  expect(textOf()).toContain("Показать ветку · 3 ответа");
  await act(async () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
  expect(container.querySelector("[data-comment=nested]")).not.toBeNull();
});

test("replying opens the form bound to the comment and read-only viewers cannot reply", async () => {
  await render();
  await act(async () => buttonByText("Ответить")!.click());
  expect(container.querySelector("[data-testid=reply-form]")?.textContent).toBe("root");

  await act(async () => root.unmount());
  root = createRoot(container);
  await render(true);
  expect(buttonByText("Ответить")).toBeUndefined();
});
