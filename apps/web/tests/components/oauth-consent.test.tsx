import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import type { TOAuthConsent } from "@plane/types";
import { OAuthConsent } from "@/components/oauth/consent";

const { oauthConsent, oauthDecide, assign } = vi.hoisted(() => ({
  oauthConsent: vi.fn(),
  oauthDecide: vi.fn(),
  assign: vi.fn(),
}));

vi.mock("@plane/services", () => ({
  McpService: class {
    oauthConsent = oauthConsent;
    oauthDecide = oauthDecide;
  },
}));
vi.mock("@plane/propel/button", () => ({
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

const consent = (patch: Partial<TOAuthConsent> = {}): TOAuthConsent => ({
  client: {
    name: "ChatGPT",
    uri: "",
    redirect_uri: "https://chatgpt.com/connector/oauth/abc",
    redirect_host: "chatgpt.com",
  },
  user: { display_name: "Я", email: "me@example.com" },
  scopes: {
    requested: ["read", "comments:write"],
    allowed: ["read", "issues:write", "comments:write", "worklogs:write"],
    default: ["read", "comments:write"],
  },
  workspaces: [
    { slug: "acme", name: "Acme" },
    { slug: "beta", name: "Beta" },
  ],
  allow_all_workspaces: true,
  access_days: 90,
  consent_token: "signed-token",
  expires_at: "2026-10-20T12:00:00Z",
  ...patch,
});

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  Object.defineProperty(window, "location", {
    value: { ...window.location, assign },
    configurable: true,
  });
  oauthConsent.mockResolvedValue(consent());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Parameters<typeof OAuthConsent>[0]) {
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <OAuthConsent {...props} />
      </SWRConfig>
    )
  );
}
const buttonByText = (text: string) =>
  [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === text);
const select = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label='${label}']`)!;
const checkbox = (title: string) =>
  [...container.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(title))!
    .querySelector<HTMLInputElement>("input")!;

test("shows who asks, where the user returns to and what the application asked for", async () => {
  await render({ requestId: "req1" });
  expect(oauthConsent).toHaveBeenCalledWith("req1");
  const text = container.textContent!;
  expect(text).toContain("«ChatGPT» хочет получить доступ к Gizmo");
  expect(text).toContain("me@example.com");
  expect(text).toContain("chatgpt.com");
  expect(text).toContain("(запрошено приложением)");
  expect(text).toContain("Приложение зарегистрировалось само, Gizmo его не проверяло");
  expect(text).toContain("Если приложением не пользоваться 90 дн.");
  // what the application asked for is preselected, nothing more
  expect(checkbox("Чтение").checked).toBe(true);
  expect(checkbox("Комментарии").checked).toBe(true);
  expect(checkbox("Задачи").checked).toBe(false);
  expect(select("Пространство").value).toBe("*");
});

test("approving sends the chosen scopes and workspace and goes back to the application", async () => {
  oauthDecide.mockResolvedValue({ redirect_url: "https://chatgpt.com/connector/oauth/abc?code=xyz&state=s" });
  await render({ requestId: "req1" });

  await act(async () => checkbox("Задачи").click());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select("Пространство"), "beta");
    select("Пространство").dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => buttonByText("Разрешить")!.click());

  expect(oauthDecide).toHaveBeenCalledWith("req1", {
    decision: "approve",
    consent_token: "signed-token",
    scopes: ["read", "comments:write", "issues:write"],
    all_workspaces: false,
    workspace_slug: "beta",
  });
  expect(assign).toHaveBeenCalledWith("https://chatgpt.com/connector/oauth/abc?code=xyz&state=s");
  expect(container.textContent).toContain("Готово");
});

test("all workspaces is sent without a workspace slug", async () => {
  oauthDecide.mockResolvedValue({ redirect_url: "https://chatgpt.com/cb?code=1" });
  await render({ requestId: "req1" });
  await act(async () => buttonByText("Разрешить")!.click());
  const body = oauthDecide.mock.calls[0][1];
  expect(body).toMatchObject({ decision: "approve", all_workspaces: true });
  expect(body).not.toHaveProperty("workspace_slug");
});

test("denying tells the application no and shares nothing", async () => {
  oauthDecide.mockResolvedValue({ redirect_url: "https://chatgpt.com/cb?error=access_denied&state=s" });
  await render({ requestId: "req1" });
  await act(async () => buttonByText("Отклонить")!.click());
  expect(oauthDecide).toHaveBeenCalledWith("req1", { decision: "deny", consent_token: "signed-token" });
  expect(assign).toHaveBeenCalledWith("https://chatgpt.com/cb?error=access_denied&state=s");
  expect(container.textContent).toContain("Подключение отклонено");
});

test("read access cannot be switched off", async () => {
  await render({ requestId: "req1" });
  await act(async () => checkbox("Чтение").click());
  expect(container.textContent).toContain("Нужно право «Чтение»");
  expect(buttonByText("Разрешить")!.disabled).toBe(true);
});

test("an error from the server is shown and the user can try again", async () => {
  oauthDecide.mockRejectedValueOnce({ error: "The confirmation is no longer valid. Reload the page and try again." });
  await render({ requestId: "req1" });
  await act(async () => buttonByText("Разрешить")!.click());
  expect(container.querySelector("[role='alert']")!.textContent).toContain("no longer valid");
  expect(assign).not.toHaveBeenCalled();
  expect(buttonByText("Разрешить")!.disabled).toBe(false);
});

test("without workspaces there is nothing to approve", async () => {
  oauthConsent.mockResolvedValue(consent({ workspaces: [] }));
  await render({ requestId: "req1" });
  expect(container.textContent).toContain("У вас нет пространств");
  expect(buttonByText("Разрешить")!.disabled).toBe(true);
});

test("when the administrator forbids all workspaces a single one is chosen", async () => {
  oauthConsent.mockResolvedValue(consent({ allow_all_workspaces: false }));
  await render({ requestId: "req1" });
  expect(select("Пространство").value).toBe("acme");
  expect(container.textContent).not.toContain("Все мои пространства");
});

test.each([
  [{ requestId: null }, "В адресе нет запроса"],
  [{ requestId: "x", error: "invalid_request", errorDescription: "Unknown client_id." }, "Unknown client_id."],
])("problems are explained instead of showing a form", async (props, message) => {
  await render(props);
  expect(container.querySelector("[role='alert']")!.textContent).toContain(message);
  expect(buttonByText("Разрешить")).toBeUndefined();
  expect(oauthConsent).not.toHaveBeenCalled();
});

test("an expired request is reported", async () => {
  oauthConsent.mockRejectedValue({
    error: "This connection request has expired. Start the connection again in the application.",
  });
  await render({ requestId: "old" });
  expect(container.querySelector("[role='alert']")!.textContent).toContain("has expired");
});
