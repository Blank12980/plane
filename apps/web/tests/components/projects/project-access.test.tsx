import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProjectAccessRestriction } from "@/components/auth-screens/project/project-access-restriction";
import { ProjectActionsMenu } from "@/components/navigation/project-actions-menu";

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@plane/propel/empty-state", () => ({
  EmptyStateDetailed: ({
    description,
    actions = [],
  }: {
    description: string;
    actions?: { label: string; onClick: () => void }[];
  }) => (
    <div>
      {description}
      {actions.map((action) => (
        <button key={action.label} onClick={action.onClick}>
          {action.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@plane/ui", () => {
  // oxlint-disable-next-line unicorn/consistent-function-scoping
  const Menu = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Menu.MenuItem = ({ children, onClick }: { children: React.ReactNode; onClick: () => void }) => (
    <button onClick={onClick}>{children}</button>
  );
  return { CustomMenu: Menu };
});

let root: Root;
let container: HTMLDivElement;
const join = vi.fn();
const leave = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test.each([403, 409])("non-members see an invitation requirement without a join button (%s)", async (status) => {
  await act(async () =>
    root.render(
      <ProjectAccessRestriction
        isWorkspaceAdmin={false}
        errorStatusCode={status}
        handleJoinProject={join}
        isJoinButtonDisabled={false}
      />
    )
  );
  expect(container.textContent).toContain("restricted_description");
  expect(container.querySelector("button")).toBeNull();
});

test.each([403, 409])("admins retain the option to join without an invitation (%s)", async (status) => {
  await act(async () =>
    root.render(
      <ProjectAccessRestriction
        isWorkspaceAdmin
        errorStatusCode={status}
        handleJoinProject={join}
        isJoinButtonDisabled={false}
      />
    )
  );
  await act(async () => container.querySelector("button")?.click());
  expect(join).toHaveBeenCalledOnce();
});

test.each([true, false])("all actual project members can leave, including editors (%s)", async (isAuthorized) => {
  await act(async () =>
    root.render(
      <ProjectActionsMenu
        workspaceSlug="workspace"
        project={{ id: "project" }}
        isAdmin={false}
        isAuthorized={isAuthorized}
        canLeaveProject
        onCopyText={vi.fn()}
        onPublishModal={vi.fn()}
        onLeaveProject={leave}
      />
    )
  );
  const button = Array.from(container.querySelectorAll("button")).find((item) =>
    item.textContent?.includes("leave_project")
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(leave).toHaveBeenCalledOnce();
});

test("an administrator without explicit membership does not see a leave action", async () => {
  await act(async () =>
    root.render(
      <ProjectActionsMenu
        workspaceSlug="workspace"
        project={{ id: "project" }}
        isAdmin
        isAuthorized
        canLeaveProject={false}
        onCopyText={vi.fn()}
        onPublishModal={vi.fn()}
        onLeaveProject={leave}
      />
    )
  );
  expect(container.textContent).not.toContain("leave_project");
});
