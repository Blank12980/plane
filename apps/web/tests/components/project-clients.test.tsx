import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import { ClientsSettings } from "@/components/clients/clients-settings";

const { service, toast } = vi.hoisted(() => ({
  service: {
    listClients: vi.fn(),
    candidates: vi.fn(),
    addToProject: vi.fn(),
    removeFromProject: vi.fn(),
  },
  toast: vi.fn(),
}));

vi.mock("@/services/client-access.service", () => ({ clientAccessService: service }));
vi.mock("@/components/workspace/settings/client-access-modal", () => ({
  ClientAccessModal: ({ fixedProjectId }: { fixedProjectId?: string }) => (
    <div data-testid="access-modal">{fixedProjectId}</div>
  ),
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { SUCCESS: "success", ERROR: "error" }, setToast: toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    type?: "submit" | "button";
  }) => (
    <button type={type ?? "button"} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
vi.mock("@plane/ui", () => ({
  Loader: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: () => <div />,
  }),
  ModalCore: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
  EModalPosition: { CENTER: "center" },
  EModalWidth: { XL: "xl" },
}));

const person = (id: string, name: string, role = 3) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@example.com`,
  avatar_url: null,
  role,
});
const summary = (id: string, name: string, issues = 0, pages = 0) => ({
  id,
  display_name: name,
  email: `${name.toLowerCase()}@example.com`,
  avatar_url: null,
  issue_count: issues,
  page_count: pages,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  service.listClients.mockResolvedValue({ project: null, can_promote: true, clients: [] });
  service.candidates.mockResolvedValue({
    project: { id: "project", name: "Web", identifier: "WEB" },
    clients: [person("c1", "Анна"), person("c2", "Борис")],
    members: [person("m1", "Вера", 15)],
    can_promote: true,
  });
  service.addToProject.mockResolvedValue({ linked: 2, promoted: 0 });
  service.removeFromProject.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(projectId?: string) {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ClientsSettings workspaceSlug="space" projectId={projectId} />
      </SWRConfig>
    )
  );
}
const buttonByText = (text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(text));

const dialogButton = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((item) => item.textContent === text);

test("an empty project offers to add a client", async () => {
  await render("project");
  expect(container.textContent).toContain("В проекте пока нет клиентов");
  await act(async () => buttonByText("Добавить клиента")!.click());
  expect(service.candidates).toHaveBeenCalledWith("space", "project", "");
  expect(container.textContent).toContain("Анна");
  expect(container.textContent).toContain("Вера · участник");
});

test("existing clients and a promoted member are added to the project together", async () => {
  await render("project");
  await act(async () => buttonByText("Добавить клиента")!.click());
  const boxes = [...container.querySelectorAll<HTMLInputElement>("[role=dialog] input[type=checkbox]")];
  expect(boxes).toHaveLength(3);
  expect(dialogButton("Добавить")!.disabled).toBe(true);
  await act(async () => boxes[0].click());
  await act(async () => boxes[2].click());
  await act(async () => dialogButton("Добавить (2)")!.click());
  expect(service.addToProject).toHaveBeenCalledWith("space", "project", {
    client_ids: ["c1"],
    promote_member_ids: ["m1"],
  });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  expect(container.querySelector("[role=dialog]")).toBeNull();
});

test("a project administrator cannot promote members: only clients are offered", async () => {
  service.candidates.mockResolvedValue({
    project: { id: "project", name: "Web", identifier: "WEB" },
    clients: [person("c1", "Анна")],
    members: [],
    can_promote: false,
  });
  await render("project");
  await act(async () => buttonByText("Добавить клиента")!.click());
  expect(container.textContent).not.toContain("Сделать клиентом участника");
});

test("a client can be removed from the project after confirmation", async () => {
  service.listClients.mockResolvedValue({ project: null, can_promote: false, clients: [summary("c1", "Анна", 2, 1)] });
  await render("project");
  expect(container.textContent).toContain("2 задачи");
  await act(async () => buttonByText("Убрать из проекта")!.click());
  expect(window.confirm).toHaveBeenCalled();
  expect(service.removeFromProject).toHaveBeenCalledWith("space", "project", "c1");
});

test("the workspace level has no add and remove actions: there every client is listed", async () => {
  service.listClients.mockResolvedValue({ project: null, can_promote: true, clients: [summary("c1", "Анна")] });
  await render();
  expect(buttonByText("Добавить клиента")).toBeUndefined();
  expect(buttonByText("Убрать из проекта")).toBeUndefined();
  expect(buttonByText("Настроить доступ")).toBeDefined();
});
