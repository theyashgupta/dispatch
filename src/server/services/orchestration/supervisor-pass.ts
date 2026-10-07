import type { Card, PrInfo } from "../../../shared/types.js";
import { ALL_BOARDS, DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { power, type PowerHolder } from "../../adapters/power.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { markNeedsInput, record } from "./supervisor-record.js";
import {
  dropWatcher,
  noteMachineWake,
  watcherNames,
} from "./supervisor-registry.js";
import { dependencyDone, isRunningCard, runningLoops } from "./boards.js";
import {
  recordStartFailure,
  startGroup,
  type GroupStartOutcome,
} from "./group-launch.js";
import { groupCost } from "./orchestrator-read.js";

export interface PassDeps {
  power: PowerHolder;
  startGroup: (cardId: string) => Promise<GroupStartOutcome> | null;
}

export interface PassMemory {
  prs: Map<string, string>;
  gates: Map<string, string>;
}

const PASS_MS = 60_000;
const LATE_MS = 30_000;

const DEFAULT_DEPS: PassDeps = {
  power,
  startGroup: (cardId) => {
    const config = getOrchestrationConfig();
    if (config === null) return null;
    const launch = store.getCard(cardId)?.launch;
    return startGroup(
      cardId,
      { extraDirection: launch?.direction, playbook: launch?.playbook },
      config,
    );
  },
};

function groupCards(): Card[] {
  return store
    .listBoards()
    .filter((board) => board.policy.supervisor === "on")
    .flatMap((board) => store.listCards(board.key))
    .filter((card) => card.source === "group");
}

const prKey = (prs: PrInfo[] | undefined) =>
  JSON.stringify((prs ?? []).map((pr) => [pr.number, pr.state]));

/** Record one `pr_state` event per change of a group card's PR list, a hand merge included. */
function recordPrChanges(cards: Card[], memory: PassMemory): void {
  for (const card of cards) {
    const now = prKey(card.prs);
    const before = memory.prs.get(card.id);
    memory.prs.set(card.id, now);
    if (before === undefined || before === now) continue;
    store.appendOrchestrationEvent({
      boardKey: card.boardKey ?? DEFAULT_BOARD_KEY,
      cardId: card.id,
      sessionId: card.activeSessionId ?? null,
      kind: "pr_state",
      data: {
        from: JSON.parse(before) as unknown,
        to: JSON.parse(now) as unknown,
      },
      ts: new Date().toISOString(),
    });
  }
}

/**
 * Start each queued group whose dependencies are done, while its board has room under the cap.
 *
 * @remarks A dependency counts as done in Done or with every PR merged. The running count is read
 * fresh for each group, because a start marks its card synchronously and an orchestrator start can
 * land during the queue write. The pass does not wait for a start; a failed one is queued again.
 */
async function startHeldGroups(cards: Card[], deps: PassDeps): Promise<void> {
  for (const card of cards) {
    if (!card.startQueued || isRunningCard(card)) continue;
    if (!(card.dependsOn ?? []).every(dependencyDone)) continue;
    const key = card.boardKey ?? DEFAULT_BOARD_KEY;
    const cap = store.getBoard(key)?.policy.concurrencyCap ?? 0;
    if (runningLoops(key) >= cap) continue;
    const outcome = deps.startGroup(card.id);
    if (outcome === null) continue;
    await store.setGroupQueue(card.id, { startQueued: false });
    store.appendOrchestrationEvent({
      boardKey: key,
      cardId: card.id,
      sessionId: null,
      kind: "supervisor_action",
      data: { action: "start_group", dependsOn: card.dependsOn ?? [] },
      ts: new Date().toISOString(),
    });
    void outcome
      .then((result) =>
        result.ok ? undefined : recordStartFailure(card, true, result.reason),
      )
      .catch((err: unknown) =>
        console.warn(
          `[supervisor] start failure of ${card.id} not recorded: ${(err as Error).message}`,
        ),
      );
  }
}

/**
 * Stop a group at its budget: at the next gate change after its cost reaches `budgetPerGroup`.
 *
 * @remarks The cost is the running total of `groupCost`. Nothing is sent; the session only moves to
 * `needs_input` with `budget`, and the reason clears once a raised or removed budget allows the cost.
 */
async function stopOverBudget(
  cards: Card[],
  memory: PassMemory,
): Promise<void> {
  for (const card of cards) {
    const budget = store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy
      .budgetPerGroup;
    const cost = groupCost(card);
    const session = card.sessions?.find((s) => s.id === card.activeSessionId);
    if (
      session?.stateReason === "budget" &&
      (budget == null || cost < budget)
    ) {
      await store.setSessionStateIfSession(card.id, session.id, "needs_input");
      record(card, session, { action: "budget_release", cost, budget });
    }
    const gate = JSON.stringify(card.loopProgress?.summary.lastGate ?? null);
    const before = memory.gates.get(card.id);
    memory.gates.set(card.id, gate);
    if (before === undefined || before === gate || budget == null) continue;
    if (cost < budget || !session || session.stateReason === "budget") continue;
    await markNeedsInput(
      card,
      session,
      "budget",
      `budget: cost ${cost} of ${budget}`,
    );
  }
}

/** Hold the keep awake child while a session of a supervised board is live, and prune gone watchers. */
function syncPowerAndWatchers(deps: PassDeps): void {
  const live = store
    .sessionsWithTmux(ALL_BOARDS)
    .filter(
      ({ card }) =>
        store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy
          .supervisor === "on",
    );
  deps.power.set(live.length > 0);
  const names = new Set(live.map(({ session }) => session.tmuxSession));
  for (const name of watcherNames()) if (!names.has(name)) dropWatcher(name);
}

/** Record one `machine_wake` event per supervised board when the pass timer fired more than 30 s late. */
function recordWake(lateMs: number, now: number): void {
  if (lateMs <= LATE_MS) return;
  noteMachineWake(now);
  for (const board of store.listBoards()) {
    if (board.policy.supervisor !== "on") continue;
    store.appendOrchestrationEvent({
      boardKey: board.key,
      cardId: null,
      sessionId: null,
      kind: "machine_wake",
      data: { sleptSeconds: Math.round(lateMs / 1000) },
      ts: new Date(now).toISOString(),
    });
  }
}

/** Start an empty pass memory. */
export function initialPassMemory(): PassMemory {
  return { prs: new Map(), gates: new Map() };
}

/**
 * Run one supervisor pass: keep awake, wake check, PR changes, held group starts and budget stops.
 *
 * @remarks `lateMs` is how much later than 60 s this pass fired; the loop passes it so a test can
 * stand in a slept machine.
 */
export async function runSupervisorPass(
  memory: PassMemory,
  lateMs: number,
  now: number,
  deps: PassDeps = DEFAULT_DEPS,
): Promise<void> {
  syncPowerAndWatchers(deps);
  recordWake(lateMs, now);
  const cards = groupCards();
  recordPrChanges(cards, memory);
  await startHeldGroups(cards, deps);
  await stopOverBudget(cards, memory);
}

/** Start the 60 s supervisor pass and return its stop function, which also ends the keep awake child. */
export function startSupervisorPass(deps: PassDeps = DEFAULT_DEPS): () => void {
  const memory = initialPassMemory();
  let last = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  const tick = async () => {
    const now = Date.now();
    const lateMs = now - last - PASS_MS;
    last = now;
    try {
      await runSupervisorPass(memory, lateMs, now, deps);
    } catch (err) {
      console.warn(`[supervisor] pass failed: ${(err as Error).message}`);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), PASS_MS);
      timer.unref?.();
    }
  };
  timer = setTimeout(() => void tick(), PASS_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    deps.power.set(false);
  };
}
