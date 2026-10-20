import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import type { TMcpUserOverview } from "@plane/types";
import { McpProfileSettings } from "@/components/settings/profile/content/pages/mcp";

const { userOverview, userCreateToken, userDeleteToken, toast } = vi.hoisted(() => ({
  userOverview: vi.fn(),
  userCreateToken: vi.fn(),
  userDeleteToken: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@plane/services", () => ({
  McpService: class {
    userOverview = userOverview;
    userCreateToken = userCreateToken;
    userDeleteToken = userDeleteToken;
  },
}));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { SUCCESS: "success", ERROR: "error" }, setToast: toast }));
vi.mock("@plane/propel/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
    type,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
    type?: "submit" | "button";
  }) => (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/settings/profile/heading", () => ({
  ProfileSettingsHeading: ({ title }: { title: string }) => <h6>{title}</h6>,
}));

const overview = (patch: Partial<TMcpUserOverview> = {}): TMcpUserOverview => ({
  enabled: true,
  allow_user_tokens: true,
  endpoint: "https://gizmo.example.com/mcp",
  policy: {
    allowed_scopes: ["read", "issues:write", "comments:write", "worklogs:write"],
    max_token_days: 90,
    default_rate_limit: "120/min",
  },
  workspaces: [{ slug: "acme", name: "Acme" }],
  tokens: [],
  ...patch,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  userOverview.mockResolvedValue(overview());
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
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <McpProfileSettings />
      </SWRConfig>
    )
  );
}
const buttonByText = (text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text)!;

test("shows the connection guide with the endpoint and a placeholder before a token exists", async () => {
  await render();
  expect(container.textContent).toContain("1. Создайте токен");
  expect(container.textContent).toContain("https://gizmo.example.com/mcp");
  expect(container.textContent).toContain("<ВАШ_ТОКЕН>");
  expect(container.textContent).toContain("Мои MCP-токены");
});

test("creating a token shows the secret once and fills the client configuration", async () => {
  userCreateToken.mockResolvedValue({
    id: "t1",
    label: "Мой агент",
    token: "plane_api_secret",
    workspace: { slug: "acme", name: "Acme" },
    scopes: ["read"],
  });
  await render();
  await act(async () => buttonByText("Создать токен").click());
  expect(userCreateToken).toHaveBeenCalledWith(
    expect.objectContaining({
      workspace_slug: "acme",
      scopes: ["read", "issues:write", "comments:write", "worklogs:write"],
      expires_in_days: 90,
    })
  );
  expect(container.textContent).toContain("plane_api_secret");
  expect(container.textContent).toContain("Токен показывается один раз");
  // the configuration of the selected client now contains the token and the workspace
  expect([...container.querySelectorAll("pre")].at(-1)?.textContent).toContain("Bearer plane_api_secret");
  await act(async () => buttonByText("Я сохранил токен").click());
  expect(container.textContent).not.toContain("plane_api_secret");
});

test("explains when the administrator switched MCP off or forbids personal tokens", async () => {
  userOverview.mockResolvedValue(overview({ enabled: false }));
  await render();
  expect(container.textContent).toContain("MCP отключён администратором");
  expect(buttonByText("Создать токен")).toBeUndefined();

  await act(async () => root.unmount());
  root = createRoot(container);
  userOverview.mockResolvedValue(overview({ allow_user_tokens: false }));
  await render();
  expect(container.textContent).toContain("отключил самостоятельное создание");
});

test("only offers the presets that the instance policy allows", async () => {
  userOverview.mockResolvedValue(
    overview({ policy: { allowed_scopes: ["read"], max_token_days: 0, default_rate_limit: "60/min" } })
  );
  await render();
  expect(container.textContent).toContain("Только чтение");
  expect(container.textContent).not.toContain("Помощник");
  expect(container.textContent).toContain("Без срока");
});
