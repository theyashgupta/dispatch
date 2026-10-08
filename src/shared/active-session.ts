import type {
  Card,
  SessionMeters,
  SupervisorState,
  SupervisorStateReason,
} from "./types.js";

export interface ActiveSessionView {
  id: string;
  state?: SupervisorState;
  stateReason?: SupervisorStateReason;
  stateSince?: string;
  createdAt?: string;
  updatedAt?: string;
  claudeAccountId?: string;
  contextPercent?: number | null;
  model?: string | null;
  cost?: number | null;
  usage?: SessionMeters["usage"];
  metersAt?: string;
}

/**
 * Reads the active session of a card from either the server shape or the wire shape.
 *
 * @remarks The browser never receives `card.sessions`; it gets the flat mirror fields and
 * `sessionSummaries`. Each field takes the flat mirror first, then the `sessions` entry, then the
 * active summary. `metersAt` exists only on `sessions`, so it falls back to `updatedAt`.
 */
export function activeSessionView(card: Card): ActiveSessionView | null {
  const summary = card.sessionSummaries?.find((s) => s.active);
  const id = card.activeSessionId ?? summary?.id;
  if (id === undefined) return null;
  const session = card.sessions?.find((s) => s.id === id);
  const pick = <K extends keyof ActiveSessionView & keyof Card>(
    key: K,
  ): ActiveSessionView[K] =>
    (card[key] !== undefined
      ? card[key]
      : (session?.[key as keyof typeof session] ??
        summary?.[key as keyof typeof summary])) as ActiveSessionView[K];
  const updatedAt = session?.updatedAt ?? summary?.updatedAt;
  return {
    id,
    state: pick("state"),
    stateReason: pick("stateReason"),
    stateSince: pick("stateSince"),
    createdAt: session?.createdAt ?? summary?.createdAt,
    updatedAt,
    claudeAccountId: pick("claudeAccountId"),
    contextPercent: pick("contextPercent"),
    model: pick("model"),
    cost: pick("cost"),
    usage: pick("usage"),
    metersAt: session?.metersAt ?? updatedAt,
  };
}
