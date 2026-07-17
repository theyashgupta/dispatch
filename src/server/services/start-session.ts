import path from "node:path";
import type { Config, StartError } from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { hasSession } from "../adapters/tmux.js";
import { registerHookToken } from "./hook-tokens.js";
import { loadPlaybooks } from "./playbooks.js";
import {
  steps,
  StartStepError,
  type SagaContext,
  type SagaStep,
} from "./steps.js";

/** Milliseconds after which a transient reattach statusReason is cleared (shared with resume). */
export const REATTACH_STATUS_CLEAR_MS = 5000;

/** Map any thrown saga error to the structured StartError the card renders. Never leaks config. */
function toStartError(err: unknown, stepName: string): StartError {
  if (err instanceof StartStepError) {
    return { step: err.step, stderr: err.stderr, variant: err.variant };
  }
  const e = err as Error & { stderr?: string };
  return {
    step: stepName,
    stderr: e.stderr ?? e.message ?? String(err),
    variant: "generic",
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
 * `tmuxSession` — keeps its hook POSTs authenticating instead of silently 401ing forever.
 * @see docs/ARCHITECTURE.md#orchestration-saga
 */
export async function startSession(
  cardId: string,
  extraDirection: string,
  config: Config,
  opts?: { playbook?: string },
): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  try {
    const card = store.getCard(cardId);
    if (!card) return;

    const stored = opts?.playbook === undefined ? card.startIntent : undefined;
    const playbookName = opts?.playbook ?? stored?.playbook;

    if (opts?.playbook !== undefined) {
      await store.setStartIntent(cardId, { playbook: opts.playbook });
    }

    const session = "dsp-" + card.identifier;
    const workspacePath = path.join(
      config.workspaceRoot ?? "",
      card.identifier,
    );

    if (await hasSession(session)) {
      if (card.hookToken) registerHookToken(card.hookToken, cardId);
      await store.attachExistingSession(cardId, {
        workspacePath,
        branch: card.identifier,
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
      await store.completeStart(cardId, {
        workspacePath: ctx.workspacePath,
        branch: card.identifier,
        tmuxSession: session,
      });
      if (card.workspace?.folder) {
        await store.setLastUsedFolder(card.workspace.folder);
      }
      if (ctx.warnings.length > 0) {
        await store.setStartWarning(cardId, ctx.warnings.join("; "));
      }
    } catch (err) {
      if (currentStep) {
        await currentStep.undo(ctx).catch(() => {});
      }
      for (const step of [...done].reverse()) {
        await step.undo(ctx).catch(() => {});
      }
      await store.setStartError(
        cardId,
        toStartError(err, currentStep?.name ?? "starting"),
      );
    }
  } finally {
    store.endStart(cardId);
  }
}
