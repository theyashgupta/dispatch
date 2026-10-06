import {
  buildChainReason,
  describeChainMove,
  SWITCH_NOW_REASON,
  type ChainReason,
  type ChainTrigger,
} from "../../../shared/account-chain.js";
import type { AccountEventType } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { sendPush } from "./push-send.js";
import { accountLabel } from "./session-account-move.js";

export type ChainEvent =
  | {
      kind: "failover" | "return";
      from: string;
      to: string;
      reason: string;
      moved: boolean;
      sessions: number | null;
    }
  | { kind: "exhausted"; from: string; earliestResetAt: string | null };

export interface ChainRecordDeps {
  label: (id: string) => Promise<string>;
  record: (type: AccountEventType, reason: string) => Promise<void>;
  notify: (message: {
    title: string;
    body: string;
    url: string;
  }) => Promise<void>;
}

const realDeps: ChainRecordDeps = {
  label: accountLabel,
  record: (type, reason) => store.recordAccountEvent(type, reason),
  notify: sendPush,
};

const ACCOUNTS_URL = "/#/accounts";

const TRIGGER_OF: Record<string, ChainTrigger> = {
  [SWITCH_NOW_REASON]: "switch-now",
  reset: "reset",
  "limit surface": "surface",
  "rate limit stop": "rate-limit",
};

/**
 * Record one activity event and send one push notification for a chain event.
 *
 * @remarks A move's reason is the `buildChainReason` text: trigger, both labels and the number of
 * sessions moved or queued, so the feed and the push read the same facts. An exhausted event
 * carries the earliest reset or no reason. The record and the push settle apart, so a failed push
 * never hides the event.
 */
export async function recordChainEvent(
  event: ChainEvent,
  deps: ChainRecordDeps = realDeps,
): Promise<void> {
  const settled = await (async () => {
    if (event.kind === "exhausted") {
      const when = event.earliestResetAt
        ? new Date(event.earliestResetAt).toLocaleString()
        : "unknown";
      return {
        type: "account_chain_exhausted" as const,
        reason: event.earliestResetAt ?? "",
        title: "Every Claude account is at its limit",
        body: `The earliest reset is ${when}`,
      };
    }
    const [from, to] = await Promise.all([
      deps.label(event.from),
      deps.label(event.to),
    ]);
    const facts: ChainReason = {
      trigger: event.moved ? (TRIGGER_OF[event.reason] ?? "usage") : "held",
      from,
      to,
      sessions: event.sessions,
    };
    const reason = buildChainReason(facts);
    const body = describeChainMove(event.kind, facts);
    if (event.kind === "failover") {
      return {
        type: "account_failover" as const,
        reason,
        title: event.moved ? "Claude account moved" : "Claude account at limit",
        body,
      };
    }
    return {
      type: "account_return" as const,
      reason,
      title: event.moved ? "Claude account returned" : "Claude account reset",
      body,
    };
  })();
  await Promise.allSettled([
    deps.record(settled.type, settled.reason),
    deps.notify({
      title: settled.title,
      body: settled.body,
      url: ACCOUNTS_URL,
    }),
  ]);
}
