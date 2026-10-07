import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { BoardKey } from "../../../shared/types.js";

export interface OrchestratorIdentity {
  boardKey: BoardKey;
  orchestratorId: string;
}

export interface ScopeTarget {
  boardKey?: BoardKey | null;
}

export type ScopeResult = { ok: true } | { ok: false; reason: "other-board" };

/**
 * Decide whether an orchestrator may act on a target card, group or session.
 *
 * @remarks A target with no stored board belongs to the default board, the same rule the store
 * uses for a card that predates boards.
 */
export function checkScope(
  token: OrchestratorIdentity,
  target: ScopeTarget,
): ScopeResult {
  return (target.boardKey ?? DEFAULT_BOARD_KEY) === token.boardKey
    ? { ok: true }
    : { ok: false, reason: "other-board" };
}
