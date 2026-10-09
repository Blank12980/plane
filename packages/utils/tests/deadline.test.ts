/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { getDeadlineParts } from "../src/deadline.ts";

test("deadline displays the correct date and time across a timezone boundary", () => {
  assert.deepEqual(getDeadlineParts("2026-10-10T22:30:00Z", "Europe/Moscow"), { date: "2026-10-11", time: "01:30" });
});

test("midnight uses 00 instead of 24", () => {
  assert.deepEqual(getDeadlineParts("2026-10-10T21:00:00Z", "Europe/Moscow"), { date: "2026-10-11", time: "00:00" });
});

test("daylight saving offsets follow the deadline date", () => {
  assert.equal(getDeadlineParts("2026-07-10T18:00:00Z", "America/New_York")?.time, "14:00");
  assert.equal(getDeadlineParts("2026-12-10T18:00:00Z", "America/New_York")?.time, "13:00");
});

test("invalid deadlines are ignored", () => {
  assert.equal(getDeadlineParts("invalid", "UTC"), undefined);
});
