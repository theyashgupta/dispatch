import type { SourceCursor } from "../../../shared/types.js";
import type { SlackConversation } from "./slack-message.js";

export interface SlackTarget {
  id: string;
  name: string;
  conversation: SlackConversation;
}

export type CursorMap = Record<string, SourceCursor>;

export const TARGET_CAP = 40;

const OVERLAP_S = 600;

const FIRST_LOOK_S = 86400;

/** Sort key for a Slack ts: seconds and microseconds padded so plain string order is time order. */
function tsKey(ts: string): string {
  const [seconds, fraction = ""] = ts.split(".");
  return `${seconds.padStart(12, "0")}.${fraction.padEnd(6, "0")}`;
}

const DM_RESERVE = 10;

/** Least recently read first, never-read first, then the id. */
function byStaleness(cursors: CursorMap) {
  return (a: SlackTarget, b: SlackTarget): number => {
    const pa = cursors[a.id]?.polledAt;
    const pb = cursors[b.id]?.polledAt;
    if (pa !== pb) {
      if (pa === undefined) return -1;
      if (pb === undefined) return 1;
      return pa < pb ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * Pick the targets one poll reads, at most `cap`: the stalest channels, then the stalest DMs.
 *
 * @remarks Up to 10 slots stay with DMs, because the DM list carries every dormant DM and one shared
 * order would read a picked channel only every few polls; channel slots left unused go to DMs.
 * Targets left out are the stalest next poll, so each is read in turn (R-11, U2-03 as changed).
 */
export function orderTargets(
  channels: readonly SlackTarget[],
  dms: readonly SlackTarget[],
  cursors: CursorMap,
  cap: number = TARGET_CAP,
): SlackTarget[] {
  const order = byStaleness(cursors);
  const channelSlots = Math.max(0, cap - Math.min(DM_RESERVE, dms.length));
  const picked = [...channels].sort(order).slice(0, channelSlots);
  return [...picked, ...[...dms].sort(order).slice(0, cap - picked.length)];
}

/**
 * The oldest ts a history read asks for: the cursor minus 600 s, or 24 h back on first sight.
 *
 * @remarks Slack treats oldest as exclusive; the 600 s overlap re-reads on purpose so a message
 * that arrived late is still seen, and item dedupe absorbs the repeats (U2-04).
 */
export function historyOldest(
  cursor: string | undefined,
  nowMs: number,
): string {
  if (cursor === undefined) return (nowMs / 1000 - FIRST_LOOK_S).toFixed(6);
  const [seconds, fraction = ""] = cursor.split(".");
  return `${Number(seconds) - OVERLAP_S}.${fraction.padEnd(6, "0").slice(0, 6)}`;
}

/** The cursor after one read: the newest ts seen, never older than the previous cursor. */
export function nextCursorState(
  prev: SourceCursor | undefined,
  messages: readonly { ts: string }[],
  polledAt: string,
): SourceCursor {
  let cursor = prev?.cursor;
  for (const { ts } of messages) {
    if (cursor === undefined || tsKey(ts) > tsKey(cursor)) cursor = ts;
  }
  return cursor === undefined ? { polledAt } : { cursor, polledAt };
}
