import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import type { TMcpOAuthConnection, TMcpToken, TMcpUserOverview } from "@plane/types";
import { McpProfileSettings } from "@/components/settings/profile/content/pages/mcp";

const { userOverview, userCreateToken, userDeleteToken, userRevealToken, userDeleteConnection, toast, writeText } =
  vi.hoisted(() => ({
    userOverview: vi.fn(),
    userCreateToken: vi.fn(),
    userDeleteToken: vi.fn(),
    userRevealToken: vi.fn(),
    userDeleteConnection: vi.fn(),
    toast: vi.fn(),
    writeText: vi.fn(),
  }));

vi.mock("@plane/services", () => ({
  McpService: class {
    userOverview = userOverview;
    userCreateToken = userCreateToken;
    userDeleteToken = userDeleteToken;
    userRevealToken = userRevealToken;
    userDeleteConnection = userDeleteConnection;
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

const token = (id: string, extra: Partial<TMcpToken> = {}): TMcpToken => ({
  id,
  label: `Токен ${id}`,
  description: "",
  user: { id: "u", display_name: "Я", email: "me@example.com", is_bot: false },
  workspace: { slug: "acme", name: "Acme" },
  scopes: ["read"],
  allowed_rate_limit: "120/min",
  last_used: null,
  expired_at: null,
  created_at: "2026-10-01T00:00:00Z",
  revoked: false,
  expired: false,
  is_active: true,
  ...extra,
});

const overview = (patch: Partial<TMcpUserOverview> = {}): TMcpUserOverview => ({
  enabled: true,
  allow_user_tokens: true,
  endpoint: "https://gizmo.example.com/mcp",
  policy: {
    allow_all_workspaces: true,
    allow_oauth: true,
    allowed_scopes: ["read", "issues:write", "comments:write", "worklogs:write"],
    max_token_days: 90,
    default_rate_limit: "120/min",
  },
  workspaces: [
    { slug: "acme", name: "Acme" },
    { slug: "beta", name: "Beta" },
  ],
  tokens: [],
  oauth: {
    enabled: true,
    endpoints: {
      issuer: "https://gizmo.example.com",
      resource: "https://gizmo.example.com/mcp",
      authorization_endpoint: "https://gizmo.example.com/auth/oauth/authorize/",
      token_endpoint: "https://gizmo.example.com/auth/oauth/token/",
      registration_endpoint: "https://gizmo.example.com/auth/oauth/register/",
      revocation_endpoint: "https://gizmo.example.com/auth/oauth/revoke/",
      protected_resource_metadata: "https://gizmo.example.com/.well-known/oauth-protected-resource/mcp",
      authorization_server_metadata: "https://gizmo.example.com/.well-known/oauth-authorization-server",
    },
    connections: [],
  },
  ...patch,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
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
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
const promptBlock = () => container.querySelector<HTMLElement>("[data-testid='agent-prompt']");

test("without a token the agent prompt asks the agent to request one and keeps the endpoint", async () => {
  await render();
  const prompt = promptBlock()!.textContent!;
  expect(prompt).toContain("Подключи MCP-сервер Gizmo");
  expect(prompt).toContain("https://gizmo.example.com/mcp");
  expect(prompt).toContain("<ВАШ_ТОКЕН>");
  expect(prompt).toContain("попроси меня вставить токен");
  expect(userRevealToken).not.toHaveBeenCalled();
});

test("an existing working token is substituted into the prompt automatically and never shown in full", async () => {
  userOverview.mockResolvedValue(overview({ tokens: [token("t1", { workspace: null }), token("t2")] }));
  userRevealToken.mockResolvedValue("plane_api_secret123");
  await render();
  expect(userRevealToken).toHaveBeenCalledWith("t1");
  const shown = promptBlock()!.textContent!;
  expect(shown).not.toContain("plane_api_secret123");
  expect(shown).toContain("plane_api_••••••••");
  // a token for all workspaces: the agent is told which ones and to use list_workspaces
  expect(shown).toContain("во всех моих пространствах (acme, beta)");
  expect(shown).toContain("list_workspaces");

  await act(async () => buttonByText("Скопировать промпт")!.click());
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Authorization: Bearer plane_api_secret123"));
  expect(writeText.mock.calls[0][0]).toContain("claude mcp add --transport http --scope user gizmo");
});

test("another token can be chosen and then goes into the prompt", async () => {
  userOverview.mockResolvedValue(
    overview({ tokens: [token("t1"), token("t2", { workspace: { slug: "beta", name: "Beta" } })] })
  );
  userRevealToken.mockImplementation(async (id: string) => `plane_api_${id}`);
  await render();
  const select = container.querySelector<HTMLSelectElement>("select[aria-label='Токен в промпте']")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "t2");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(userRevealToken).toHaveBeenCalledWith("t2");
  await act(async () => buttonByText("Скопировать промпт")!.click());
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Bearer plane_api_t2"));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining("X-Workspace-Slug: beta"));
});

test("one token for all workspaces is the default for a user with several workspaces", async () => {
  userCreateToken.mockResolvedValue(token("new", { workspace: null, label: "Мой агент" }) as never);
  userCreateToken.mockResolvedValue({
    ...token("new", { workspace: null, label: "Мой агент" }),
    token: "plane_api_new",
  });
  await render();
  expect(container.textContent).toContain("Все мои пространства (2)");
  await act(async () => buttonByText("Создать токен")!.click());
  expect(userCreateToken).toHaveBeenCalledWith(
    expect.objectContaining({
      all_workspaces: true,
      scopes: ["read", "issues:write", "comments:write", "worklogs:write"],
      expires_in_days: 90,
    })
  );
  expect(userCreateToken.mock.calls[0][0]).not.toHaveProperty("workspace_slug");
  // the new token is in the prompt and the manual configuration right away
  await act(async () => buttonByText("Скопировать промпт")!.click());
  expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("Bearer plane_api_new"));
  expect(container.textContent).toContain("уже подставлен в промпт");
});

test("when the administrator forbids tokens for all workspaces only a single workspace can be chosen", async () => {
  userOverview.mockResolvedValue(overview({ policy: { ...overview().policy, allow_all_workspaces: false } }));
  userCreateToken.mockResolvedValue({ ...token("one"), token: "plane_api_one" });
  await render();
  expect(container.textContent).not.toContain("Все мои пространства");
  await act(async () => buttonByText("Создать токен")!.click());
  expect(userCreateToken).toHaveBeenCalledWith(expect.objectContaining({ workspace_slug: "acme" }));
  expect(userCreateToken.mock.calls[0][0]).not.toHaveProperty("all_workspaces");
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
    overview({
      policy: {
        allow_all_workspaces: true,
        allow_oauth: true,
        allowed_scopes: ["read"],
        max_token_days: 0,
        default_rate_limit: "60/min",
      },
    })
  );
  await render();
  expect(container.textContent).toContain("Только чтение");
  expect(container.textContent).not.toContain("Помощник");
  expect(container.textContent).toContain("Без срока");
});

test("a deleted token disappears from the list", async () => {
  userOverview.mockResolvedValue(overview({ tokens: [token("t1")] }));
  userRevealToken.mockResolvedValue("plane_api_t1");
  vi.spyOn(window, "confirm").mockReturnValue(true);
  userDeleteToken.mockResolvedValue(undefined);
  await render();
  await act(async () => buttonByText("Удалить")!.click());
  expect(userDeleteToken).toHaveBeenCalledWith("t1");
});

const connection = (patch: Partial<TMcpOAuthConnection> = {}): TMcpOAuthConnection => ({
  id: "c1",
  client_name: "ChatGPT",
  client_uri: "",
  workspace: null,
  scopes: ["read", "issues:write"],
  created_at: "2026-10-01T00:00:00Z",
  last_used_at: "2026-10-02T00:00:00Z",
  expires_at: "2027-01-01T00:00:00Z",
  ...patch,
});

test("OAuth is offered without a token: address to copy, instructions for clients and the connected applications", async () => {
  userOverview.mockResolvedValue(
    overview({
      oauth: {
        ...overview().oauth,
        connections: [
          connection(),
          connection({ id: "c2", client_name: "Cursor", workspace: { slug: "acme", name: "Acme" } }),
        ],
      },
    })
  );
  await render();
  const section = container.querySelector("section[aria-label='Вход через OAuth']")!;
  expect(section.textContent).toContain("Способ 1. Вход через OAuth, без токена");
  expect(section.textContent).toContain("https://gizmo.example.com/mcp");
  // ChatGPT instructions are shown first and say how to choose the authorization
  expect(section.textContent).toContain("ChatGPT");
  expect(section.textContent).toContain("OAuth");
  expect(section.textContent).not.toContain("Bearer");
  expect(container.textContent).toContain("Способ 2. Токен");

  expect(section.textContent).toContain("Подключённые приложения");
  expect(section.textContent).toContain("ChatGPT");
  expect(section.textContent).toContain("все пространства");
  expect(section.textContent).toContain("Cursor");

  await act(async () => buttonByText("Скопировать адрес")!.click());
  expect(writeText).toHaveBeenCalledWith("https://gizmo.example.com/mcp");
});

test("the generated prompt offers OAuth and keeps the token as the fallback", async () => {
  await render();
  const prompt = promptBlock()!.textContent!;
  expect(prompt).toContain("Способ 1. OAuth, без токена");
  expect(prompt).toContain("/.well-known/oauth-protected-resource/mcp");
  expect(prompt).toContain("Способ 2. Токен");
  expect(prompt).toContain("claude mcp add --transport http --scope user gizmo https://gizmo.example.com/mcp\n");
});

test("when OAuth is off for the instance neither the section nor the prompt mention it", async () => {
  userOverview.mockResolvedValue(
    overview({
      policy: { ...overview().policy, allow_oauth: false },
      oauth: { ...overview().oauth, enabled: false },
    })
  );
  await render();
  expect(container.querySelector("section[aria-label='Вход через OAuth']")).toBeNull();
  expect(promptBlock()!.textContent).not.toContain("OAuth");
  expect(container.textContent).toContain("Вход через OAuth (ChatGPT и другие приложения) отключён администратором");
  expect(container.textContent).toContain("1. Токен");
});

test("an application can be disconnected after confirmation", async () => {
  userOverview.mockResolvedValue(overview({ oauth: { ...overview().oauth, connections: [connection()] } }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  userDeleteConnection.mockResolvedValue(undefined);
  await render();
  await act(async () => buttonByText("Отключить")!.click());
  expect(userDeleteConnection).toHaveBeenCalledWith("c1");
  expect(userOverview).toHaveBeenCalledTimes(2);
});
