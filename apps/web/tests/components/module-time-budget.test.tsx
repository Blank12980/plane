import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SWRConfig } from "swr";
import { ModuleTimeBudget } from "@/components/modules/analytics-sidebar/time-budget";

const { fetchBudget, updateBudget, toast } = vi.hoisted(() => ({
  fetchBudget: vi.fn(),
  updateBudget: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/services/module-time-budget.service", () => ({ moduleTimeBudgetService: { fetchBudget, updateBudget } }));
vi.mock("@plane/propel/toast", () => ({ TOAST_TYPE: { SUCCESS: "success", ERROR: "error" }, setToast: toast }));
let root: Root;
let container: HTMLDivElement;
const budget = { month: "2026-10-01", limit_minutes: 600, total_minutes: 600, reached: true };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  fetchBudget.mockResolvedValue(budget);
  updateBudget.mockResolvedValue(budget);
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
  await act(async () =>
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ModuleTimeBudget workspaceSlug="space" projectId="project" moduleId="module" disabled={disabled} />
      </SWRConfig>
    )
  );
}
async function change(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
test("shows threshold and saves hours as minutes", async () => {
  await render();
  expect(container.textContent).toContain("лимит достигнут");
  await change("12.5");
  await act(async () => container.querySelector("button")!.click());
  expect(updateBudget).toHaveBeenCalledWith("space", "project", "module", 750);
});
test("empty limit disables notifications", async () => {
  await render();
  await change("");
  await act(async () => container.querySelector("button")!.click());
  expect(updateBudget).toHaveBeenCalledWith("space", "project", "module", null);
});
test("read only modules cannot change limits", async () => {
  await render(true);
  expect(container.querySelector("input")!.disabled).toBe(true);
  expect(container.querySelector("button")!.disabled).toBe(true);
});
test("rejected save keeps entered limit and reports error", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  updateBudget.mockRejectedValue(new Error("Offline"));
  await render();
  await change("15");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector("input")!.value).toBe("15");
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  log.mockRestore();
});
