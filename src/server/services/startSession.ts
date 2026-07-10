import path from "node:path";
import type { Column, Config, StartError } from "../../shared/types.js";
import { store } from "../store/boardStore.js";
import { hasSession } from "../adapters/tmux.js";
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
 * is in flight (CR-01). Column/mode are derived from whether `targetColumn` was EXPLICITLY present
 * in the request — an explicit target is honored, an absent target preserves an existing card's
 * mode (the bare-Restart signature), and a modeless card falls back to in_progress. The restart
 * column is derived from the preserved mode, not the stale column: a planning card returns to its
 * In Planning home (so a plan completed after the restart is never stranded plan-ready outside the
 * handoff column), an implementation card to In Progress — the attention-column state belonged to
 * the dead session either way. This is
 * deliberately decoupled from the session-lost flag (which drives only the restart wording) because
 * a bare Restart and a deliberate re-provision both arrive session-lost and only presence tells
 * them apart. A request carrying neither `playbook` nor `targetColumn` falls back to the intent
 * persisted at the original start (`card.startIntent`), so Retry after a failed planning start and
 * a bare Restart reproduce the chosen playbook and planning target instead of silently degrading to
 * a playbook-less implementation session; a request carrying either field is a fresh, complete
 * intent and never mixes with the stored one. Route validation only covers names arriving in the
 * request body, so a stored playbook name that no longer resolves (renamed or deleted since the
 * original start) is surfaced as a start warning via the same channel as the fetch-fallback
 * notice — the warning must ride `ctx.warnings` because `completeStart` clears `startWarning`.
 * @see docs/ARCHITECTURE.md#orchestration-saga
 */
export async function startSession(
  cardId: string,
  extraDirection: string,
  config: Config,
  opts?: { playbook?: string; targetColumn?: "in_planning" | "in_progress" },
): Promise<void> {
  if (store.isStarting(cardId)) return;
  store.beginStart(cardId);
  try {
    const card = store.getCard(cardId);
    if (!card) return;

    const stored =
      opts?.playbook === undefined && opts?.targetColumn === undefined
        ? card.startIntent
        : undefined;
    const playbookName = opts?.playbook ?? stored?.playbook;
    const targetColumn = opts?.targetColumn ?? stored?.targetColumn;
    let column: Column;
    let mode: "planning" | "implementation" | undefined;
    if (targetColumn !== undefined) {
      column = targetColumn;
      mode = targetColumn === "in_planning" ? "planning" : "implementation";
    } else if (card.mode !== undefined) {
      column = card.mode === "planning" ? "in_planning" : "in_progress";
      mode = card.mode;
    } else {
      column = "in_progress";
      mode = undefined;
    }

    if (opts?.playbook !== undefined || opts?.targetColumn !== undefined) {
      await store.setStartIntent(cardId, {
        playbook: opts.playbook,
        targetColumn: opts.targetColumn,
      });
    }

    const session = "dsp-" + card.identifier;
    const workspacePath = path.join(
      config.workspaceRoot ?? "",
      card.identifier,
    );

    if (await hasSession(session)) {
      await store.attachExistingSession(
        cardId,
        {
          workspacePath,
          branch: card.identifier,
          tmuxSession: session,
        },
        { column, mode },
      );
      setTimeout(
        () => void store.setStatusReason(cardId, null),
        REATTACH_STATUS_CLEAR_MS,
      );
      return;
    }

    const playbookBody = playbookName
      ? (
          await loadPlaybooks(
            mode === "planning" ? "planning" : "implementation",
          )
        ).find((p) => p.name === playbookName)?.body
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
      await store.completeStart(
        cardId,
        {
          workspacePath: ctx.workspacePath,
          branch: card.identifier,
          tmuxSession: session,
        },
        { column, mode },
      );
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
