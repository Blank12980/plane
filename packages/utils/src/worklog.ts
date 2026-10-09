/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** A single work log cannot exceed a calendar day, matching the API limit. */
export const MAX_WORKLOG_MINUTES = 24 * 60;

const HOUR_UNITS = new Set(["h", "hr", "hrs", "hour", "hours", "ч", "час", "часа", "часов"]);
const MINUTE_UNITS = new Set(["m", "min", "mins", "minute", "minutes", "м", "мин", "минута", "минуты", "минут"]);

/**
 * Parse what a person types into the "time spent" field and return whole minutes.
 *
 * Accepted forms: `1h 30m`, `1ч 30м`, `45m`, `1:30`, and a bare number which is read as hours (`2`, `1.5`, `0,25`).
 * Returns `undefined` for anything else, and for zero.
 */
export function parseDurationToMinutes(input: string): number | undefined {
  const text = input.trim().toLowerCase().replace(/,/g, ".");
  if (!text) return undefined;

  let minutes: number | undefined;

  const clock = text.match(/^(\d+):([0-5]?\d)$/);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  } else if (/^\d+(\.\d+)?$/.test(text)) {
    minutes = Math.round(Number(text) * 60);
  } else {
    // one or more "<number><unit>" parts, e.g. "1h 30m" or "1ч30м"
    const parts = text.match(/^(?:\s*\d+(?:\.\d+)?\s*[a-zа-яё]+)+\s*$/);
    if (!parts) return undefined;
    let total = 0;
    let usedHours = false;
    let usedMinutes = false;
    for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([a-zа-яё]+)/g)) {
      if (HOUR_UNITS.has(unit)) {
        if (usedHours) return undefined;
        usedHours = true;
        total += Number(amount) * 60;
      } else if (MINUTE_UNITS.has(unit)) {
        if (usedMinutes) return undefined;
        usedMinutes = true;
        total += Number(amount);
      } else {
        return undefined;
      }
    }
    minutes = Math.round(total);
  }

  return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
}

export type TDurationUnits = { hours: string; minutes: string };

/** Render minutes as `1h 30m` using the given (translated) unit suffixes. */
export function formatMinutesAsDuration(totalMinutes: number, units: TDurationUnits): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}${units.minutes}`;
  if (rest === 0) return `${hours}${units.hours}`;
  return `${hours}${units.hours} ${rest}${units.minutes}`;
}
