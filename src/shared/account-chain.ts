export const SWITCH_NOW_REASON = "switch-now";

const LEGACY_HELD_SUFFIX = ", not moved";
const LEGACY_MANUAL_SUFFIX = ", switched now";

export type ChainTrigger =
  "usage" | "surface" | "rate-limit" | "reset" | "switch-now" | "held";

export interface ChainReason {
  trigger: ChainTrigger;
  from: string;
  to: string;
  sessions: number | null;
}

const TRIGGERS: readonly ChainTrigger[] = [
  "usage",
  "surface",
  "rate-limit",
  "reset",
  "switch-now",
  "held",
];

const CAUSE: Record<Exclude<ChainTrigger, "held">, string> = {
  usage: "at a usage limit",
  surface: "at a limit surface",
  "rate-limit": "at a rate limit",
  reset: "after a reset",
  "switch-now": "on Switch now",
};

/**
 * Encode the facts of a chain activity row as its `reason` text.
 *
 * @remarks JSON keeps the account labels whole, since an email or a label can contain " to ".
 */
export function buildChainReason(reason: ChainReason): string {
  return JSON.stringify(reason);
}

/**
 * Read the facts of a chain activity row, or `null` when the reason is not a chain reason.
 *
 * @remarks A row written before the JSON form reads as `<from> to <to>` with an optional held or
 * Switch now suffix and no session count.
 */
export function parseChainReason(reason: string | null): ChainReason | null {
  if (reason === null) return null;
  if (reason.startsWith("{")) {
    try {
      const value = JSON.parse(reason) as Partial<ChainReason>;
      if (
        TRIGGERS.includes(value.trigger as ChainTrigger) &&
        typeof value.from === "string" &&
        typeof value.to === "string" &&
        (value.sessions === null || typeof value.sessions === "number")
      ) {
        return value as ChainReason;
      }
    } catch {
      return null;
    }
    return null;
  }
  const trigger: ChainTrigger = reason.endsWith(LEGACY_HELD_SUFFIX)
    ? "held"
    : reason.endsWith(LEGACY_MANUAL_SUFFIX)
      ? "switch-now"
      : "usage";
  const cut =
    trigger === "held"
      ? LEGACY_HELD_SUFFIX.length
      : trigger === "switch-now"
        ? LEGACY_MANUAL_SUFFIX.length
        : 0;
  const match = /^(.+?) to (.+)$/.exec(
    cut > 0 ? reason.slice(0, -cut) : reason,
  );
  return match
    ? { trigger, from: match[1], to: match[2], sessions: null }
    : null;
}

/**
 * Describe a chain failover or return in one sentence, for the activity feed and the push body.
 */
export function describeChainMove(
  kind: "failover" | "return",
  { trigger, from, to, sessions }: ChainReason,
): string {
  if (trigger === "held") {
    return kind === "failover"
      ? `${from} is at its usage limit; sessions can move to ${to}`
      : `${to} has reset; sessions can move back to it`;
  }
  const count =
    sessions === null
      ? "sessions"
      : `${sessions} ${sessions === 1 ? "session" : "sessions"}`;
  return kind === "failover"
    ? `Moved ${count} from ${from} to ${to} ${CAUSE[trigger]}`
    : `Returned ${count} to ${to} after its reset`;
}
