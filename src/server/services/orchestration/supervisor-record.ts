import path from "node:path";
import { isHiddenCard } from "../../../shared/hidden-card.js";
import type {
  BoardPolicy,
  Card,
  OrchestrationEventKind,
  OrchestratorRecord,
  Session,
  SupervisorStateReason,
} from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { loopFilePath } from "../domain/loop-progress.js";
import { effectivePolicy } from "../domain/orchestrator-rules.js";
import type { ContinueDuty } from "../domain/supervisor-plan.js";
import { scopeTargetOf } from "./boards.js";

/**
 * The orchestrator record that owns a hidden card on its board, or undefined for any other card.
 *
 * @remarks
 * The record must also name the card, so an id that was removed and added again does not
 * adopt the hidden card of the old record.
 */
export function orchestratorOf(card: Card): OrchestratorRecord | undefined {
  if (!isHiddenCard(card)) return undefined;
  return store
    .getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)
    ?.orchestrators.find(
      (r) => r.id === card.ownerOrchestrator && r.cardId === card.id,
    );
}

/**
 * The policy a card works under: its board policy narrowed by the override of its owner orchestrator.
 *
 * @remarks
 * A hidden card works under its own orchestrator; any other card under the owner the scope
 * check gives it. Undefined when the board is gone.
 */
export function ownerPolicy(card: Card): BoardPolicy | undefined {
  const board = store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY);
  if (!board) return undefined;
  const owner = isHiddenCard(card)
    ? orchestratorOf(card)
    : board.orchestrators.find((r) => r.id === scopeTargetOf(card).owner);
  return effectivePolicy(board.policy, owner);
}

/** Append one supervisor event for a session, a `supervisor_action` row unless another kind is given. */
export function record(
  card: Card,
  session: Session,
  data: Record<string, unknown>,
  kind: OrchestrationEventKind = "supervisor_action",
): void {
  store.appendOrchestrationEvent({
    boardKey: card.boardKey ?? DEFAULT_BOARD_KEY,
    cardId: card.id,
    sessionId: session.id,
    kind,
    data,
    ts: new Date().toISOString(),
  });
}

/**
 * The session root, where claude runs and the loop files live: the session workspace, else the card's.
 *
 * @remarks Never `workspace.folder`: that is the chosen parent folder of the source repositories,
 * not the per-ticket session root.
 */
export function rootOf(card: Card, session: Session): string {
  return session.workspacePath ?? card.workspacePath ?? "";
}

/** The prompt text of one continue duty, pointing a loop at its progress and resume files. */
export function continueText(
  card: Card,
  session: Session,
  duty: ContinueDuty | "resume" | "usage_limit",
): string {
  const lead = {
    restart: "The loop stopped without a marker.",
    api_error: "The last turn ended on an API error.",
    sleep_cut: "The last turn was cut off while the machine slept.",
    resume: "The session was restarted.",
    usage_limit: "The usage limit has reset.",
  }[duty];
  const slug = card.loopProgress?.slug;
  if (!slug) return `${lead} Continue from where you stopped.`;
  const root = rootOf(card, session);
  return `${lead} Read ${path.join(root, loopFilePath(slug, "progress.md"))} and ${path.join(root, loopFilePath(slug, "resume.md"))}, then continue the loop from the recorded position.`;
}

/** Move a session to `needs_input` with a reason, with its state row, its action row and the card column. */
export async function markNeedsInput(
  card: Card,
  session: Session,
  reason: SupervisorStateReason,
  evidence: string,
): Promise<void> {
  const from =
    store.getCard(card.id)?.sessions?.find((s) => s.id === session.id)?.state ??
    null;
  await store.setSessionStateIfSession(
    card.id,
    session.id,
    "needs_input",
    reason,
  );
  await moveToNeedsInput(card, session, evidence);
  record(
    card,
    session,
    { from, to: "needs_input", reason, evidence },
    "supervisor_state",
  );
  record(card, session, { action: "needs_input", reason, evidence });
}

/** Move the live card to the `needs_input` column unless it is already there. */
export async function moveToNeedsInput(
  card: Card,
  session: Session,
  evidence: string,
): Promise<void> {
  if (store.getCard(card.id)?.column === "needs_input") return;
  await store.applyMarker(
    card.id,
    session.id,
    "needs_input",
    evidence,
    `supervisor:${new Date().toISOString()}`,
    "status_needs_input",
  );
}

/** Record a failed step, then move the session to `needs_input` with `supervisor_gave_up`. */
export async function giveUp(
  card: Card,
  session: Session,
  data: Record<string, unknown>,
  evidence: string,
): Promise<void> {
  record(card, session, data);
  await markNeedsInput(card, session, "supervisor_gave_up", evidence);
}
