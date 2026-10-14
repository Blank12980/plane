/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { act, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TIssueWorkLog } from "@plane/types";
import { IssueWorkLogModal } from "@/components/issues/worklog/modal";
import usePeekOverviewOutsideClickDetector from "@/hooks/use-peek-overview-outside-click";

const { createWorkLog, updateWorkLog, closePeek, onChanged } = vi.hoisted(() => ({
  createWorkLog: vi.fn(),
  updateWorkLog: vi.fn(),
  closePeek: vi.fn(),
  onChanged: vi.fn(),
}));

vi.mock("@plane/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/store/user", () => ({
  useUser: () => ({ data: { id: "user-id" } }),
  useUserPermissions: () => ({ allowPermissions: () => true }),
}));
vi.mock("@/services/issue/issue_worklog.service", () => ({
  IssueWorkLogService: class {
    createWorkLog = createWorkLog;
    updateWorkLog = updateWorkLog;
  },
}));
vi.mock("@plane/propel/toast", () => ({
  TOAST_TYPE: { SUCCESS: "success", ERROR: "error" },
  setToast: vi.fn(),
}));

function PeekWithWorkLog({ workLogs = [] }: { workLogs?: TIssueWorkLog[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [peekOpen, setPeekOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(true);
  usePeekOverviewOutsideClickDetector(
    ref,
    () => {
      closePeek();
      setPeekOpen(false);
    },
    "issue-id"
  );

  return peekOpen ? (
    <div ref={ref} data-testid="issue-peek">
      <IssueWorkLogModal
        workspaceSlug="workspace"
        projectId="project-id"
        issueId="issue-id"
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        readOnly={false}
        workLogs={workLogs}
        onChanged={onChanged}
      />
    </div>
  ) : null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
  vi.clearAllMocks();
  createWorkLog.mockResolvedValue({});
  updateWorkLog.mockResolvedValue({});
  onChanged.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(workLogs?: TIssueWorkLog[]) {
  await act(async () => root.render(<PeekWithWorkLog workLogs={workLogs} />));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
}

function getInput(selector: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Input not found: ${selector}`);
  return input;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.focus();
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    element.click();
  });
}

async function type(input: HTMLInputElement, value: string) {
  await click(input);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test.each([
  ['[aria-label="worklog.duration"]', "1h 30m"],
  ['[placeholder="worklog.comment_placeholder"]', "Implemented time tracking"],
  ['[aria-label="worklog.date"]', "2026-01-01"],
])("clicking and typing in %s keeps the portalled form and issue peek open", async (selector, value) => {
  await render();
  const input = getInput(selector);
  expect(container.contains(input)).toBe(false);
  await type(input, value);
  expect(closePeek).not.toHaveBeenCalled();
  expect(input.isConnected).toBe(true);
  expect(input.value).toBe(value);
  expect(document.activeElement).toBe(input);
});

test("time and description can be submitted from the issue peek", async () => {
  await render();
  await type(getInput('[aria-label="worklog.duration"]'), "1h 30m");
  await type(getInput('[aria-label="worklog.date"]'), "2026-01-01");
  await type(getInput('[placeholder="worklog.comment_placeholder"]'), " Implemented time tracking ");
  const button = document.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) throw new Error("Submit button not found");
  await click(button);
  expect(closePeek).not.toHaveBeenCalled();
  expect(createWorkLog).toHaveBeenCalledWith("workspace", "project-id", "issue-id", {
    duration_minutes: 90,
    logged_on: "2026-01-01",
    description: "Implemented time tracking",
  });
  expect(onChanged).toHaveBeenCalledOnce();
  expect(getInput('[aria-label="worklog.duration"]').value).toBe("");
});

test("clicks outside the form still close the issue peek", async () => {
  await render();
  await click(document.body);
  expect(closePeek).toHaveBeenCalledOnce();
  expect(container.querySelector('[data-testid="issue-peek"]')).toBeNull();
});
