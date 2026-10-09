/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMinutesAsDuration, parseDurationToMinutes } from "../src/worklog.ts";

test("unit based durations are summed", () => {
  assert.equal(parseDurationToMinutes("1h 30m"), 90);
  assert.equal(parseDurationToMinutes("1h30m"), 90);
  assert.equal(parseDurationToMinutes("2 hours"), 120);
  assert.equal(parseDurationToMinutes("45min"), 45);
  assert.equal(parseDurationToMinutes("1.5h"), 90);
});

test("russian units are understood", () => {
  assert.equal(parseDurationToMinutes("1ч 30м"), 90);
  assert.equal(parseDurationToMinutes("2 часа"), 120);
  assert.equal(parseDurationToMinutes("15 мин"), 15);
  assert.equal(parseDurationToMinutes("3 часов 5 минут"), 185);
});

test("clock notation and bare numbers are read as hours and minutes", () => {
  assert.equal(parseDurationToMinutes("1:30"), 90);
  assert.equal(parseDurationToMinutes("0:05"), 5);
  assert.equal(parseDurationToMinutes("2"), 120);
  assert.equal(parseDurationToMinutes("1.5"), 90);
  assert.equal(parseDurationToMinutes("0,25"), 15);
});

test("surrounding whitespace and case are ignored", () => {
  assert.equal(parseDurationToMinutes("  1H 15M "), 75);
});

test("invalid or empty durations are rejected", () => {
  for (const input of [
    "",
    "   ",
    "abc",
    "h",
    "1x",
    "1h 1h",
    "1m 1m",
    "0",
    "0h",
    "0:00",
    "-1",
    "1:75",
    "1h 30",
    "1..5",
  ]) {
    assert.equal(parseDurationToMinutes(input), undefined, input);
  }
});

test("minutes are formatted with the given unit suffixes", () => {
  const en = { hours: "h", minutes: "m" };
  assert.equal(formatMinutesAsDuration(0, en), "0m");
  assert.equal(formatMinutesAsDuration(45, en), "45m");
  assert.equal(formatMinutesAsDuration(60, en), "1h");
  assert.equal(formatMinutesAsDuration(90, en), "1h 30m");
  assert.equal(formatMinutesAsDuration(1500, { hours: " ч", minutes: " мин" }), "25 ч");
});
