import { createHash, randomBytes } from "node:crypto";
import { boardRepository as store } from "../../store/board-repository.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";

export interface ResolvedOrchestratorToken extends OrchestratorIdentity {
  revoked: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a fresh 256-bit token for one orchestrator and return the raw value once.
 *
 * @remarks Only the hash reaches the database, and an earlier live token of the same orchestrator
 * is revoked in the same write, so each orchestrator holds one live token.
 */
export function mintOrchestratorToken(identity: OrchestratorIdentity): string {
  const token = randomBytes(32).toString("hex");
  store.replaceOrchestratorToken(
    hashToken(token),
    identity.boardKey,
    identity.orchestratorId,
  );
  return token;
}

/** Revoke every live token of one orchestrator and return how many were revoked. */
export function revokeOrchestratorToken(
  identity: OrchestratorIdentity,
): number {
  return store.revokeOrchestratorTokens(
    identity.boardKey,
    identity.orchestratorId,
  );
}

/**
 * Look up a presented token, live or revoked, or undefined for an unknown one.
 *
 * @remarks A revoked token still resolves so the caller can record the refusal under its board.
 */
export function resolveOrchestratorToken(
  token: string,
): ResolvedOrchestratorToken | undefined {
  const row = store.findOrchestratorToken(hashToken(token));
  if (!row) return undefined;
  return {
    boardKey: row.boardKey,
    orchestratorId: row.orchestratorId,
    revoked: row.revokedAt !== null,
  };
}
