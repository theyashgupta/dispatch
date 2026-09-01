import path from "node:path";
import type { Config, StartError } from "../../../shared/types.js";
import { store, type ReservedSession } from "../../store/board.store.js";
import { hasSession } from "../../adapters/tmux.js";
import { registerHookToken } from "../domain/hook-tokens.js";
import { loadPlaybooks } from "../domain/playbooks.js";
import { updateLastUsedPlaybook } from "../infra/config-holder.js";
import {
  steps,
  StartStepError,
  type SagaContext,
  type SagaStep,
} from "./steps.js";

/** Milliseconds after which a transient reattach statusReason is cleared (shared with resume). */
export const REATTACH_STATUS_CLEAR_MS = 5000;

/**
 * Map any thrown saga error to the structured StartError the card renders. Never leaks config.
 * @remarks `newSession` (Phase 94) rides every error this saga produces, not just
 * `StartStepError`s, so Retry reproduces "start another session" intent regardless of which step
 * failed.
 */
function toStartError(
  err: unknown,
  stepName: string,
  newSession: boolean,
): StartError {
  const base = newSession ? { newSession: true } : {};
  if (err instanceof StartStepError) {
    return {
      step: err.step,
      stderr: err.stderr,
      variant: err.variant,
      ...base,
    };
  }
  const e = err as Error & { stderr?: string };
  return {
    step: stepName,
    stderr: e.stderr ?? e.message ?? String(err),
    variant: "generic",
    ...base,
  };
}

/**
 * Run the start saga for `cardId`. Fire-and-forget from the route (202 already sent); all
 * further state reaches the UI via the store's automatic SSE broadcast.
 * @remarks Drives the four steps forward through the single-writer store and compensates in
 * reverse over saga bookkeeping on any failure, leaving the card in To Do (ORCH-01/03). The
 * one-saga-per-card in-flight guard is a synchronous check-then-set on the store (not a
 * module-local Set) so the poller's reconcile can see it and refuse to remove a card whose start
 * is in flight (CR-01). Every start lands the card on In Progress — a request carrying no
 * `playbook` falls back to the intent persisted at the original start (`card.startIntent`), so
 * Retry after a failed start and a bare Restart reproduce the chosen playbook instead of silently
 * degrading to a playbook-less session; a request carrying the field is a fresh, complete intent
 * and never mixes with the stored one. Route validation only covers names arriving in the request
 * body, so a stored playbook name that no longer resolves (renamed or deleted since the original
 * start) is surfaced as a start warning via the same channel as the fetch-fallback notice — the
 * warning must ride `ctx.warnings` because `completeStart` clears `startWarning`. The
 * already-running reattach branch re-registers the card's persisted hook token (mirroring
 * resume's reattach) so a live session adopted after a backend restart — e.g. an interrupted
 * saga plus Retry, which never reaches boot reconcile because only completeStart sets
 * `tmuxSession` — keeps its hook POSTs authenticating instead of silently 401ing forever. An
 * explicitly chosen `playbook` (not the intent fallback) is persisted as the picker's remembered
 * default only after `completeStart` succeeds, matching the "saved on successful kickoff" contract
 * — a failed start must never overwrite a working remembered default.
 * @remarks (Phase 91) The reattach branch registers the card's persisted token against
 * `card.activeSessionId` because this reattach always targets the card's ACTIVE session by
 * construction — it can never reattach onto a sibling.
 * @remarks (Phase 94) `opts.newSession` gates this early-return: without the gate, a
 * second-session request would be silently swallowed and reattach onto session 1 instead of
 * starting a new one. When set, the naming source is derived ONCE via `store.reserveNewSession`
 * (`sessionName`/`session`/`workspacePath` below) before the reattach check even runs, and the
 * check's `hasSession` target carries the `=` exact-match prefix — copying `resume-session.ts:64`
 * — because tmux 3.6a prefix-matches a longer sibling when the exact short name is absent; without
 * it, a genuine FIRST start on a card whose only live session is a suffixed sibling would
 * reattach onto the wrong session. The card-level `isStarting`/`beginStart` gate above (not a
 * per-session key) is what actually serializes the reserve step: two concurrent new-session POSTs
 * mint two DIFFERENT session ids, so a per-session key could never collide and would let both
 * through, whereas the card gate makes the second request return early and COALESCE onto the
 * session the first reserve already minted — one session, not an error.
 * @remarks (Phase 95) Inheritance is an OPTION on this saga, never a second path (criterion 5):
 * `opts.inheritFrom` rides the same `newSession` reservation call rather than a parallel entry
 * point. The authoritative parent resolution lives entirely in `store.reserveNewSession` — this
 * function never re-resolves it or re-checks the card's own session list to find the parent
 * itself, so there is exactly one chokepoint for "does this id name a session the card owns".
 * The saga context's inherited-base-ref field carries the parent's BRANCH, not its session id,
 * because the consuming saga step needs a git ref to build a worktree from.
 * @remarks (LOCAL-2) A non-newSession start derives `sessionName` from the ACTIVE session
 * record's own `branch`, falling back to `card.identifier` for a first start (no records yet) and
 * for a cleaned-up card. A bare Restart or reattach of a card whose active session is a suffixed
 * sub-session therefore rebuilds THAT session's branch/workspace/tmux instead of silently
 * retargeting the primary's, which used to overwrite the sub-session's record with session 1's
 * fields.
 * @see docs/ARCHITECTURE.md#orchestration-saga
 */
export async function startSession(
  cardId: string,
  extraDirection: string,
  config: Config,
  opts?: { playbook?: string; newSession?: boolean; inheritFrom?: string },
): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  const wantsNewSession = opts?.newSession === true;
  let reserved: ReservedSession | null = null;
  try {
    const card = store.getCard(cardId);
    if (!card) return;

    const stored = opts?.playbook === undefined ? card.startIntent : undefined;
    const playbookName = opts?.playbook ?? stored?.playbook;

    if (opts?.playbook !== undefined) {
      await store.setStartIntent(cardId, { playbook: opts.playbook });
    }

    const activeRecord = card.sessions?.find(
      (s) => s.id === card.activeSessionId,
    );
    let sessionName = activeRecord?.branch ?? card.identifier;
    if (wantsNewSession) {
      reserved = await store.reserveNewSession(
        cardId,
        card.identifier,
        opts?.inheritFrom,
      );
      if (reserved == null) {
        await store.setStartError(cardId, {
          step: "reserving session",
          stderr:
            opts?.inheritFrom != null
              ? "unknown session to inherit from"
              : "no existing session to start another from",
          variant: "generic",
          newSession: true,
        });
        return;
      }
      sessionName = reserved.sessionName;
    }
    const session = "dsp-" + sessionName;
    const workspacePath = path.join(config.workspaceRoot ?? "", sessionName);

    if (reserved == null && (await hasSession(`=${session}`))) {
      if (card.hookToken && card.activeSessionId) {
        registerHookToken(card.hookToken, cardId, card.activeSessionId);
      }
      await store.attachExistingSession(cardId, card.activeSessionId, {
        workspacePath,
        branch: sessionName,
        tmuxSession: session,
      });
      setTimeout(
        () => void store.setStatusReason(cardId, null),
        REATTACH_STATUS_CLEAR_MS,
      );
      return;
    }

    const playbookBody = playbookName
      ? (await loadPlaybooks()).find((p) => p.name === playbookName)?.body
      : undefined;
    const warnings: string[] = [];
    if (playbookName !== undefined && playbookBody === undefined) {
      warnings.push("saved playbook not found — started without it");
    }

    await store.setExtraDirection(cardId, extraDirection);

    const ctx: SagaContext = {
      card,
      identifier: card.identifier,
      sessionName,
      sessionId: reserved?.sessionId,
      workspacePath: "",
      extraDirection,
      config,
      createdWorkspaceDir: false,
      createdWorktrees: [],
      createdBranches: [],
      tmuxSessionCreated: false,
      restarted: card.sessionLost === true,
      playbookBody,
      warnings,
      inheritBaseRef: reserved?.parentBranch,
    };

    const done: SagaStep[] = [];
    let currentStep: SagaStep | undefined;
    try {
      for (const step of steps) {
        currentStep = step;
        await store.setProvisioning(cardId, step.statusText);
        await step.run(ctx);
        done.push(step);
      }
      currentStep = undefined;
      await store.completeStart(cardId, reserved?.sessionId, {
        workspacePath: ctx.workspacePath,
        branch: sessionName,
        tmuxSession: session,
      });
      if (card.workspace?.folder) {
        await store.setLastUsedFolder(card.workspace.folder);
      }
      if (ctx.warnings.length > 0) {
        await store.setStartWarning(cardId, ctx.warnings.join("; "));
      }
      if (opts?.playbook !== undefined) {
        try {
          updateLastUsedPlaybook(opts.playbook);
        } catch (err) {
          console.error("[start-session] updateLastUsedPlaybook failed:", err);
        }
      }
    } catch (err) {
      if (currentStep) {
        await currentStep.undo(ctx).catch(() => {});
      }
      for (const step of [...done].reverse()) {
        await step.undo(ctx).catch(() => {});
      }
      if (reserved != null) {
        await store.rollbackReservedSession(cardId, reserved.sessionId);
      }
      await store.setStartError(
        cardId,
        toStartError(err, currentStep?.name ?? "starting", wantsNewSession),
      );
    }
  } finally {
    store.endStart(cardId);
  }
}
