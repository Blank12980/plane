import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IProject } from "@plane/types";
import { LeaveProjectModal } from "@/components/project/leave-project-modal";

const { leave, push, toast } = vi.hoisted(() => ({ leave: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock("react-router", () => ({ useParams: () => ({ workspaceSlug: "workspace" }), useNavigate: () => push }));
vi.mock("@/hooks/store/user", () => ({ useUserPermissions: () => ({ leaveProject: leave }) }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { ERROR: "error" }, setToast: toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@plane/ui", () => ({
  EModalPosition: { CENTER: "center" },
  EModalWidth: { LG: "lg" },
  ModalCore: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
    isOpen ? <div>{children}</div> : null,
}));

let root: Root;
let container: HTMLDivElement;
const close = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  leave.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(<LeaveProjectModal project={{ id: "project", name: "Private" } as IProject} isOpen onClose={close} />)
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("one confirmation leaves and redirects without typing the project name", async () => {
  expect(container.querySelector("input")).toBeNull();
  await act(async () => container.querySelectorAll("button")[1]?.click());
  expect(leave).toHaveBeenCalledWith("workspace", "project");
  expect(close).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/workspace/projects");
});

test("a failed exit shows the API reason and keeps the project open", async () => {
  leave.mockRejectedValueOnce({ error: "Назначьте другого администратора проекта перед выходом." });
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await act(async () => container.querySelectorAll("button")[1]?.click());
  expect(toast).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Назначьте другого администратора проекта перед выходом." })
  );
  expect(push).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(container.querySelectorAll("button")[1]?.disabled).toBe(false);
  log.mockRestore();
});

test("pending exit disables both buttons and prevents duplicate requests", async () => {
  let resolve!: () => void;
  leave.mockReturnValueOnce(
    new Promise<void>((done) => {
      resolve = done;
    })
  );
  await act(async () => container.querySelectorAll("button")[1]?.click());
  expect(Array.from(container.querySelectorAll("button")).every((button) => button.disabled)).toBe(true);
  await act(async () => container.querySelectorAll("button")[1]?.click());
  expect(leave).toHaveBeenCalledOnce();
  await act(async () => resolve());
  expect(push).toHaveBeenCalledOnce();
});
