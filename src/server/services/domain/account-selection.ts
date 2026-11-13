import { leastHeadroom, type LimitOf } from "./usage-poll-plan.js";
import type {
  ChainAccountEntry,
  ChainAccountState,
} from "../../../shared/types.js";

export type ChainCandidate = { id: string } & Pick<
  ChainAccountEntry,
  "state" | "limitedUntil"
>;

export type BucketedCandidate = ChainCandidate &
  Pick<ChainAccountEntry, "buckets">;

export type ChainSelection =
  | { exhausted: false; id: string }
  | { exhausted: true; earliestReset: string | null };

const QUALIFYING: readonly ChainAccountState[] = [
  "available",
  "near-limit",
  "unknown",
];

/**
 * Select the account in use: the first qualifying account of a chain in position order.
 *
 * @remarks `earliestReset` skips `login-expired` accounts, since no time brings them back. It is
 * `null` when no other account carries a `limitedUntil`.
 */
export function selectAccount(
  chain: readonly ChainCandidate[],
  now: Date,
): ChainSelection {
  const pick = chain.find(
    (a) =>
      QUALIFYING.includes(a.state) &&
      (a.limitedUntil === null || Date.parse(a.limitedUntil) <= now.getTime()),
  );
  if (pick) return { exhausted: false, id: pick.id };
  let earliestReset: string | null = null;
  for (const a of chain) {
    if (a.state === "login-expired" || a.limitedUntil === null) continue;
    if (
      earliestReset === null ||
      Date.parse(a.limitedUntil) < Date.parse(earliestReset)
    ) {
      earliestReset = a.limitedUntil;
    }
  }
  return { exhausted: true, earliestReset };
}

/**
 * Tell whether an account sits far enough below its limits to take work on a usage trigger.
 *
 * @remarks Hysteresis 0 passes every account. Otherwise the binding bucket is the one with the
 * least headroom below its own limit percent, and an account with no buckets or an `unknown` state
 * never passes.
 */
export function passesHysteresis(
  buckets: readonly { kind: string; percent: number }[],
  state: ChainAccountState,
  limitOf: LimitOf,
  hysteresisPercent: number,
): boolean {
  if (hysteresisPercent === 0) return true;
  const headroom = leastHeadroom(buckets, limitOf);
  if (state === "unknown" || headroom === null) return false;
  return headroom > hysteresisPercent;
}

/**
 * Keep the usage-trigger candidates whose binding bucket has more headroom than the hysteresis.
 */
export function filterByHysteresis<
  T extends ChainCandidate & {
    buckets: readonly { kind: string; percent: number }[];
  },
>(chain: readonly T[], limitOf: LimitOf, hysteresisPercent: number): T[] {
  return chain.filter((a) =>
    passesHysteresis(a.buckets, a.state, limitOf, hysteresisPercent),
  );
}

/**
 * Pick the account with the most weekly headroom below its own limits to take a session off a limited account.
 *
 * @remarks Only `available` and `near-limit` accounts count, so `limited`, `login-expired` and
 * `unknown` never win. The weekly headroom is the least headroom among the buckets whose kind starts
 * with `weekly`, and it must be greater than the hysteresis. The most headroom wins and a tie keeps
 * chain order.
 */
export function pickHeadroomAccount(
  chain: readonly BucketedCandidate[],
  fromId: string,
  limitOf: LimitOf,
  hysteresisPercent: number,
): string | null {
  let best: { id: string; headroom: number } | null = null;
  for (const a of chain) {
    if (
      a.id === fromId ||
      (a.state !== "available" && a.state !== "near-limit")
    )
      continue;
    const weekly = a.buckets.filter((b) => b.kind.startsWith("weekly"));
    const headroom = leastHeadroom(weekly, limitOf);
    if (headroom === null || headroom <= hysteresisPercent) continue;
    if (best === null || headroom > best.headroom)
      best = { id: a.id, headroom };
  }
  return best?.id ?? null;
}
