import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

export interface OrchestratorIdentity {
  boardKey: BoardKey;
  orchestratorId: string;
}

export interface ScopeTarget {
  boardKey?: BoardKey | null;
  owner?: string | null;
}

export type ScopeResult =
  { ok: true } | { ok: false; reason: "other-board" | "other-owner" };

/**
 * Decide whether an orchestrator may act on a target card, group or session.
 *
 * @remarks
 * A target with no stored board belongs to the default board, the same rule the store
 * uses for a card that predates boards. A null or absent owner means the board has no
 * orchestrator records, so only the board is checked.
 */
export function checkScope(
  token: OrchestratorIdentity,
  target: ScopeTarget,
): ScopeResult {
  if ((target.boardKey ?? DEFAULT_BOARD_KEY) !== token.boardKey) {
    return { ok: false, reason: "other-board" };
  }
  if (target.owner != null && target.owner !== token.orchestratorId) {
    return { ok: false, reason: "other-owner" };
  }
  return { ok: true };
}
