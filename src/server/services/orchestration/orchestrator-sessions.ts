import type { Card, Session, SupervisorState } from "../../../shared/types.js";
import { sendKeys } from "../../adapters/tmux.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  ConflictError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";
import { checkBudget, checkCap } from "../domain/orchestrator-policy.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { callerPolicy, runningLoops } from "./boards.js";
import { enforce } from "./orchestrator-groups.js";
import { groupCost } from "./orchestrator-read.js";
import { sendHandoffRequest } from "./supervisor-handoff.js";
import { continueText, markNeedsInput, record } from "./supervisor-record.js";
import {
  sendConfirmed,
  typedLine,
  type SendResult,
} from "./supervisor-send.js";

export const sessionTools: {
  send: typeof sendConfirmed;
  keys: typeof sendKeys;
} = { send: sendConfirmed, keys: sendKeys };

const KEYLESS_STATES: ReadonlySet<SupervisorState> = new Set([
  "permission_prompt",
  "usage_limit_dialog",
  "usage_limit_wait",
  "shell_prompt",
]);
const USER_MUST_RESUME = "user must resume";
const MODE_CHARACTERS = new Set(["!", "/", "#", "&", "@"]);

/** The card's active session with a tmux session, or the typed 409. */
function liveSession(card: Card): Session {
  const session = card.sessions?.find((s) => s.id === card.activeSessionId);
  if (!session?.tmuxSession) throw new ConflictError("no-live-session");
  return session;
}

/** Throw the typed 409 when the pane shows a dialog or a shell that a key must never reach. */
function assertKeysAllowed(session: Session): void {
  if (session.state !== undefined && KEYLESS_STATES.has(session.state)) {
    throw new ConflictError("session-state-refused", {
      reason: `session is at ${session.state}`,
    });
  }
}

/** Throw the typed 403 when the session was stopped by the budget or a usage stop. */
function assertNotUserStop(session: Session): void {
  if (session.stateReason === "budget" || session.stateReason === "usage_stop")
    throw new PolicyError(USER_MUST_RESUME);
}

const busyCards = new Set<string>();

/**
 * Run one session tool for a card, refusing a second tool on the same card while the first runs.
 *
 * @remarks Every tool checks the session state and then types into the pane, so two calls in
 * parallel would both pass the check and interleave their keys. A running ship flow owns the
 * worktree, so every session tool waits until it ends.
 */
async function oneAtATime<T>(card: Card, tool: () => Promise<T>): Promise<T> {
  if (card.shipFlow?.state === "running")
    throw new ConflictError("ship-running");
  if (busyCards.has(card.id)) throw new ConflictError("session-busy");
  busyCards.add(card.id);
  try {
    return await tool();
  } finally {
    busyCards.delete(card.id);
  }
}

/**
 * Throw the typed 400 when a text cannot be typed as one line of input.
 *
 * @remarks
 * Claude Code reads a first `!`, `/`, `#`, `&` or `@` as an input mode (a shell command,
 * a CLI command, a memory write), so such a text is refused before the short or the pointer send.
 * The check runs on the line that is typed, so a leading control character cannot hide the mode key.
 */
function assertTypable(text: string): void {
  const line = typedLine(text);
  if (line === "") {
    throw new ValidationError("invalid-text", {
      reason: "text is empty after control characters are removed",
    });
  }
  if (MODE_CHARACTERS.has(line.charAt(0))) {
    throw new ValidationError("invalid-text", {
      reason: "text starts with a mode character",
    });
  }
}

/** Type one answer into the card's running claude under the state, stop and budget rules. */
export async function sendInput(
  caller: OrchestratorIdentity,
  card: Card,
  text: string,
): Promise<SendResult> {
  assertTypable(text);
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    assertKeysAllowed(session);
    assertNotUserStop(session);
    enforce(
      checkBudget({
        policy: callerPolicy(caller),
        cost: groupCost(card),
      }),
    );
    return sessionTools.send(card, session, text, "orchestrator_input");
  });
}

/**
 * Type one reply of the user into the card's running claude.
 *
 * @remarks
 * The user may type to a loop that stopped on budget or usage, so only the state and mode
 * checks of {@link sendInput} apply.
 */
export async function userSendInput(
  card: Card,
  text: string,
): Promise<SendResult> {
  assertTypable(text);
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    assertKeysAllowed(session);
    return sessionTools.send(card, session, text, "user_input");
  });
}

/**
 * Tell a group loop its plan is approved, under the board's approval level.
 *
 * @remarks `all` and `rules` both allow here; the playbook judges `rules` itself. `ask` needs an
 * unused approve answer from the user on a decision item of this group that `decisionIds` names,
 * and the approval marks that item used, so one answer approves one plan.
 */
export async function approveGroupPlan(
  caller: OrchestratorIdentity,
  card: Card,
  decisionIds: string[],
): Promise<SendResult> {
  return oneAtATime(card, async () => {
    if (card.source !== "group") throw new ValidationError("not-group-card");
    const session = liveSession(card);
    assertKeysAllowed(session);
    assertNotUserStop(session);
    if (callerPolicy(caller).roadmapApproval === "ask") {
      const approval = store
        .listDecisionItems(caller.boardKey, "answered")
        .find(
          (item) =>
            item.kind === "roadmap_approval" &&
            item.cardId === card.id &&
            item.answer?.optionId === "approve" &&
            item.consumedAt === undefined &&
            decisionIds.includes(item.id),
        );
      if (approval === undefined || !store.consumeDecisionItem(approval.id)) {
        throw new PolicyError(
          "roadmap approval needs an answered approve item from the user",
        );
      }
    }
    return sessionTools.send(
      card,
      session,
      `Roadmap approved (decisions ${decisionIds.join(", ")}). Continue the loop.`,
      "roadmap_approval",
    );
  });
}

/** Ask the card's loop to hand off its context, through the same request the supervisor sends. */
export async function requestHandoff(
  card: Card,
  hard: boolean,
): Promise<SendResult> {
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    const slug = card.loopProgress?.slug;
    if (!slug) throw new ConflictError("no-loop");
    assertKeysAllowed(session);
    assertNotUserStop(session);
    return sendHandoffRequest(card, session, slug, hard, {}, sessionTools.send);
  });
}

/**
 * Continue a loop stopped by `stop_session` or a supervisor give-up, under the cap and budget.
 *
 * @remarks The stopped session still counts as running, and resuming adds no loop, so the cap
 * counts the running groups without this card.
 */
export async function resumeLoop(
  caller: OrchestratorIdentity,
  card: Card,
): Promise<SendResult> {
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    assertNotUserStop(session);
    if (
      session.state !== "needs_input" ||
      (session.stateReason !== "stop_session" &&
        session.stateReason !== "supervisor_gave_up")
    ) {
      throw new ConflictError("not-resumable", {
        reason:
          "session is not stopped by stop_session or a supervisor give-up",
      });
    }
    const policy = callerPolicy(caller);
    enforce(
      checkCap({
        policy,
        runningLoops: runningLoops(caller.boardKey, card.id),
      }),
    );
    enforce(checkBudget({ policy, cost: groupCost(card) }));
    const result = await sessionTools.send(
      card,
      session,
      continueText(card, session, "resume"),
      "resume",
    );
    if (result === "confirmed") {
      const from = session.state;
      await store.setSessionStateIfSession(card.id, session.id, "working");
      record(
        card,
        session,
        {
          from,
          to: "working",
          evidence: `resume_loop by orchestrator ${caller.orchestratorId}`,
        },
        "supervisor_state",
      );
    }
    return result;
  });
}

/**
 * Continue a loop that waits at `needs_input`, for the user, whatever stopped it.
 *
 * @remarks
 * The user decides, so a `usage_stop` or `budget` stop is allowed and no cap or budget
 * check runs.
 */
export async function userResumeLoop(card: Card): Promise<SendResult> {
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    if (session.state !== "needs_input") {
      throw new ConflictError("not-resumable", {
        reason: "session is not waiting at needs_input",
      });
    }
    const result = await sessionTools.send(
      card,
      session,
      continueText(card, session, "resume"),
      "resume",
    );
    if (result === "confirmed") {
      const from = session.state;
      await store.setSessionStateIfSession(card.id, session.id, "working");
      record(
        card,
        session,
        {
          from,
          to: "working",
          evidence: "resume_loop by user",
        },
        "supervisor_state",
      );
    }
    return result;
  });
}

/** Press Escape once in the card's pane and park the session at `needs_input`; nothing is killed. */
export async function stopSession(
  caller: OrchestratorIdentity,
  card: Card,
): Promise<void> {
  return oneAtATime(card, async () => {
    const session = liveSession(card);
    assertKeysAllowed(session);
    assertNotUserStop(session);
    await sessionTools.keys(`=${session.tmuxSession}:`, ["Escape"]);
    await markNeedsInput(
      card,
      session,
      "stop_session",
      `stop_session by orchestrator ${caller.orchestratorId}`,
    );
  });
}
