import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TCommentsOperations } from "@plane/types";
import { EIssueCommentAccessSpecifier } from "@plane/constants";
import { CommentCreate } from "@/components/comments/comment-create";

const { createComment, updateComment, bindAttachments, toast, clearEditor } = vi.hoisted(() => ({
  createComment: vi.fn(),
  updateComment: vi.fn(),
  bindAttachments: vi.fn(),
  toast: vi.fn(),
  clearEditor: vi.fn(),
}));
vi.mock("@/hooks/store/use-workspace", () => ({
  useWorkspace: () => ({ getWorkspaceBySlug: () => ({ id: "workspace" }) }),
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: toast }));
vi.mock("@/components/comments/attachments", () => ({
  CommentAttachmentButton: () => null,
  CommentAttachmentList: () => null,
  useCommentAttachments: () => ({ pendingAttachments: [], isUploading: false, clearPendingAttachments: vi.fn() }),
}));
vi.mock("@/components/editor/lite-text", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  return {
    LiteTextEditor: forwardRef(function TestEditor(
      props: {
        initialValue: string;
        onChange: (json: unknown, html: string) => void;
        onEnterKeyPress: (event: unknown) => void;
      },
      ref
    ) {
      useImperativeHandle(ref, () => ({ clearEditor, isEditorReadyToDiscard: () => false }));
      return (
        <>
          <textarea
            aria-label="Комментарий"
            value={props.initialValue}
            onChange={(event) => props.onChange({}, event.target.value)}
          />
          <button onClick={(event) => props.onEnterKeyPress(event)}>Отправить</button>
        </>
      );
    }),
  };
});
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  createComment.mockResolvedValue({ id: "reply" });
  updateComment.mockResolvedValue(undefined);
  bindAttachments.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () =>
    root.render(
      <CommentCreate
        workspaceSlug="space"
        entityId="issue"
        activityOperations={
          { createComment, updateComment, bindCommentAttachments: bindAttachments } as unknown as TCommentsOperations
        }
        parentCommentId="parent"
        replyToCommentId="parent"
        access={EIssueCommentAccessSpecifier.INTERNAL}
      />
    )
  );
  await act(async () => {
    const input = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "<p>Reply text</p>");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
test("reply submission includes parent and inherits thread visibility", async () => {
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(createComment).toHaveBeenCalledWith(
    expect.objectContaining({
      parent: "parent",
      access: EIssueCommentAccessSpecifier.INTERNAL,
      comment_html: "<p>Reply text</p>",
    })
  );
  expect(bindAttachments).toHaveBeenCalledWith("reply", []);
  expect(clearEditor).toHaveBeenCalled();
});
test("failed submission preserves text for retry", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  createComment.mockRejectedValue(new Error("Offline"));
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(clearEditor).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("<p>Reply text</p>");
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  log.mockRestore();
});

test("retry after attachment failure reuses the created reply", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  bindAttachments.mockRejectedValueOnce(new Error("Upload failed"));
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(clearEditor).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(createComment).toHaveBeenCalledTimes(1);
  expect(updateComment).toHaveBeenCalledWith("reply", expect.objectContaining({ parent: "parent" }));
  expect(clearEditor).toHaveBeenCalledTimes(1);
  log.mockRestore();
});
