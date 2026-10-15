import { beforeEach, expect, test, vi } from "vitest";
import type { TIssueComment, TNotification } from "@plane/types";
import { groupCommentReplies } from "@/helpers/comment-threads";
import {
  NotificationAlertTracker,
  notificationSoundEnabled,
  notificationTarget,
  saveNotificationSound,
} from "@/helpers/notification-alerts";

const comment = (id: string, parent: string | null = null, created_at = "2026-10-01T00:00:00Z") =>
  ({ id, parent, created_at }) as TIssueComment;
const notification = (id: string, created_at: string) => ({ id, created_at }) as TNotification;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test("threads keep roots and orphans and sort replies chronologically", () => {
  const { roots, replies } = groupCommentReplies([
    comment("latest", "root", "2026-10-03"),
    comment("root"),
    comment("earlier", "root", "2026-10-02"),
    comment("nested", "earlier"),
    comment("orphan", "deleted"),
  ]);
  expect(roots.map((item) => item.id)).toEqual(["root", "orphan"]);
  expect(replies.root.map((item) => item.id)).toEqual(["earlier", "latest"]);
  expect(replies.earlier.map((item) => item.id)).toEqual(["nested"]);
});

test("notification alerts skip initial inbox and deduplicate refreshes", () => {
  const tracker = new NotificationAlertTracker();
  const old = notification("old", "2026-10-01T10:00:00Z");
  const fresh = notification("fresh", "2026-10-01T10:00:01Z");
  expect(tracker.ingest([old])).toEqual([]);
  expect(tracker.ingest([fresh, old])).toEqual([fresh]);
  expect(tracker.ingest([fresh, old])).toEqual([]);
  expect(tracker.ingest([old])).toEqual([]);
  expect(tracker.ingest([notification("older", "2026-09-30T00:00:00Z")])).toEqual([]);
});

test("equal timestamps do not lose a notification arriving on the next poll", () => {
  const tracker = new NotificationAlertTracker();
  tracker.ingest([]);
  const a = notification("a", "2026-10-01T10:00:00Z");
  const b = notification("b", "2026-10-01T10:00:00Z");
  expect(tracker.ingest([a])).toEqual([a]);
  expect(tracker.ingest([b, a])).toEqual([b]);
  expect(tracker.ingest([a, b])).toEqual([]);
});

test("sound is opt in and scoped to the user", () => {
  expect(notificationSoundEnabled("one")).toBe(false);
  saveNotificationSound("one", true);
  expect(notificationSoundEnabled("one")).toBe(true);
  expect(notificationSoundEnabled("two")).toBe(false);
  saveNotificationSound("one", false);
  expect(notificationSoundEnabled("one")).toBe(false);
});

test("links route budget alerts to the module and task alerts to inbox", () => {
  expect(
    notificationTarget("space", { project: "project", data: { module: { id: "module", name: "M" } } } as TNotification)
  ).toBe("/space/projects/project/modules/module");
  expect(notificationTarget("space", {} as TNotification)).toBe("/space/notifications");
});
