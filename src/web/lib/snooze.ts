import type { Item } from "../../shared/types.js";

export const SNOOZE_PRESETS = ["1h", "4h", "tomorrow", "monday"] as const;
export type SnoozePreset = (typeof SNOOZE_PRESETS)[number];

export const SNOOZE_LABELS: Record<SnoozePreset, string> = {
  "1h": "1 hour",
  "4h": "4 hours",
  tomorrow: "Tomorrow 9:00",
  monday: "Monday 9:00",
};

const WAKE_HOUR = 9;

function atNine(base: Date, daysAhead: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(WAKE_HOUR, 0, 0, 0);
  return d;
}

/**
 * Resolve a snooze preset to a wake time in local time.
 *
 * @remarks Calendar presets go through local Date setters so a DST change on the way still lands
 * on 09:00 wall-clock. A result at or before `now` is a bug in the preset table, so it throws.
 */
export function snoozeUntil(preset: SnoozePreset, now: Date): Date {
  let until: Date;
  switch (preset) {
    case "1h":
      until = new Date(now.getTime() + 60 * 60_000);
      break;
    case "4h":
      until = new Date(now.getTime() + 240 * 60_000);
      break;
    case "tomorrow":
      until = atNine(now, 1);
      break;
    case "monday": {
      const ahead = (8 - now.getDay()) % 7;
      until = atNine(now, ahead);
      if (until <= now) until = atNine(now, ahead + 7);
      break;
    }
  }
  if (until <= now) throw new Error(`snooze ${preset} resolved to the past`);
  return until;
}

/**
 * The client twin of the server wake rule for a rendered list.
 *
 * @remarks An expired snooze, or a snoozed row with no time, presents unread before the next
 * server frame, exactly as the server wakes it; a live snooze and a done row stay out of the list.
 */
export function wakeItems(items: readonly Item[], now: number): Item[] {
  const woken: Item[] = [];
  for (const item of items) {
    if (item.state === "done") continue;
    if (item.state !== "snoozed") {
      woken.push(item);
      continue;
    }
    if (item.snoozedUntil == null || Date.parse(item.snoozedUntil) <= now) {
      const awake: Item = { ...item, state: "unread" };
      delete awake.snoozedUntil;
      woken.push(awake);
    }
  }
  return woken;
}
