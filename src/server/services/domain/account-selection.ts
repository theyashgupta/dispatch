import type {
  ChainAccountEntry,
  ChainAccountState,
} from "../../../shared/types.js";

export type ChainCandidate = { id: string } & Pick<
  ChainAccountEntry,
  "state" | "limitedUntil"
>;

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
