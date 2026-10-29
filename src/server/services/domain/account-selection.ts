import { bindingPercent } from "./usage-poll-plan.js";
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
 * Tell whether an account sits far enough below the threshold to take work on a usage trigger.
 *
 * @remarks Hysteresis 0 passes every account. Otherwise the binding bucket is the one with the
 * highest percent, and an account with no buckets or an `unknown` state never passes.
 */
export function passesHysteresis(
  buckets: readonly { percent: number }[],
  state: ChainAccountState,
  thresholdPercent: number,
  hysteresisPercent: number,
): boolean {
  if (hysteresisPercent === 0) return true;
  const binding = bindingPercent(buckets);
  if (state === "unknown" || binding === null) return false;
  return binding < thresholdPercent - hysteresisPercent;
}

/**
 * Keep the usage-trigger candidates whose binding bucket is below the hysteresis line.
 */
export function filterByHysteresis<
  T extends ChainCandidate & { buckets: readonly { percent: number }[] },
>(
  chain: readonly T[],
  thresholdPercent: number,
  hysteresisPercent: number,
): T[] {
  return chain.filter((a) =>
    passesHysteresis(a.buckets, a.state, thresholdPercent, hysteresisPercent),
  );
}

/**
 * Pick the account with the most weekly headroom to take a session that stopped on the usage limit.
 *
 * @remarks Only `available` and `near-limit` accounts count, so `limited`, `login-expired` and
 * `unknown` never win. The weekly percent is the highest bucket whose kind starts with `weekly`,
 * and it must sit below the hysteresis line. The lowest percent wins and a tie keeps chain order.
 */
export function pickHeadroomAccount(
  chain: readonly BucketedCandidate[],
  fromId: string,
  thresholdPercent: number,
  hysteresisPercent: number,
): string | null {
  let best: { id: string; percent: number } | null = null;
  for (const a of chain) {
    if (
      a.id === fromId ||
      (a.state !== "available" && a.state !== "near-limit")
    )
      continue;
    const weekly = a.buckets.filter((b) => b.kind.startsWith("weekly"));
    const percent = bindingPercent(weekly);
    if (percent === null) continue;
    if (percent >= thresholdPercent - hysteresisPercent) continue;
    if (best === null || percent < best.percent) best = { id: a.id, percent };
  }
  return best?.id ?? null;
}
