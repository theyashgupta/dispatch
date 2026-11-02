import {
  activeSessionView,
  type ActiveSessionView,
} from "../../../../shared/active-session.js";
import { clock } from "../../../../shared/clock-text.js";
import { accountName } from "../../../../shared/session-account-view.js";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type Card,
  type ClaudeAccountSummary,
} from "../../../../shared/types.js";

export interface UsageMeter {
  kind: "window" | "week";
  percent: number;
  text: string;
  near: boolean;
}

export interface AccountMeters {
  accountId: string;
  name: string | null;
  meters: UsageMeter[];
}

const NEAR_PERCENT = 80;

/** Finds the account with an id; the default id also matches the home or managed Default row. */
export function accountFor(
  accounts: readonly ClaudeAccountSummary[],
  accountId: string,
): ClaudeAccountSummary | undefined {
  return (
    accounts.find((a) => a.id === accountId) ??
    (accountId === DEFAULT_CLAUDE_ACCOUNT_ID
      ? accounts.find((a) => a.isDefault || a.managedDefault === true)
      : undefined)
  );
}

function meter(
  kind: UsageMeter["kind"],
  rawPercent: number | null | undefined,
  account: ClaudeAccountSummary | undefined,
  timeZone: string | undefined,
): UsageMeter | null {
  if (rawPercent == null) return null;
  const percent = Math.round(rawPercent);
  const near = percent >= NEAR_PERCENT;
  const resetsAt = account?.buckets.find(
    (bucket) => bucket.kind === (kind === "window" ? "five_hour" : "seven_day"),
  )?.resetsAt;
  const at =
    resetsAt == null ? null : clock(resetsAt, timeZone, kind === "week");
  const reset = at === null ? "reset time unknown" : `resets ${at}`;
  const lead = `${kind === "window" ? "Window" : "Week"} ${percent}%`;
  return {
    kind,
    percent,
    near,
    text: `${lead}, ${near ? "near limit, " : ""}${reset}`,
  };
}

/**
 * Builds the usage meters of each account that has a live session with meter data.
 *
 * @remarks A card in Done or with a lost session feeds no meter. Percents come from the session with the newest meter read of an account, since the
 * status line measures the account and every session of it reports the same figure. The account
 * name shows only when more than one account appears.
 */
export function usageMeters(
  cards: readonly Card[],
  accounts: readonly ClaudeAccountSummary[],
  opts: { timeZone?: string },
): AccountMeters[] {
  const newest = new Map<string, ActiveSessionView>();
  for (const card of cards) {
    const session = activeSessionView(card);
    if (
      session?.metersAt === undefined ||
      card.column === "done" ||
      card.sessionLost === true ||
      session.state === "lost"
    ) {
      continue;
    }
    const id = session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID;
    const held = newest.get(id);
    if (held?.metersAt === undefined || session.metersAt > held.metersAt) {
      newest.set(id, session);
    }
  }
  const entries = [...newest.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([accountId, session]) => {
      const account = accountFor(accounts, accountId);
      return {
        accountId,
        name: accountName(accounts, accountId),
        meters: [
          meter(
            "window",
            session.usage?.fiveHourPercent,
            account,
            opts.timeZone,
          ),
          meter("week", session.usage?.sevenDayPercent, account, opts.timeZone),
        ].filter((m): m is UsageMeter => m !== null),
      };
    })
    .filter((entry) => entry.meters.length > 0);
  return entries.map((entry) => ({
    ...entry,
    name: entries.length > 1 ? entry.name : null,
  }));
}
