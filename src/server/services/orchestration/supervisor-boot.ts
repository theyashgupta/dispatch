import { ALL_BOARDS, DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { hasLiveSession } from "../../../shared/running-group.js";
import type { Card } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { readMemory } from "../../adapters/memory-sampler.js";
import { checkCap } from "../domain/orchestrator-policy.js";
import { runningLoops } from "./boards.js";
import { memoryCheck, recordSample } from "./memory-governor.js";
import { ownerPolicy } from "./supervisor-record.js";
import { superviseLost } from "./supervisor-registry.js";

export interface BootDeps {
  supervise: (cardId: string) => Promise<void>;
  sample: () => Promise<void>;
  log: (line: string) => void;
}

const DEFAULT_DEPS: BootDeps = {
  supervise: superviseLost,
  sample: async () => {
    const sample = await readMemory();
    if (sample !== null) recordSample(sample);
  },
  log: (line) => console.info(line),
};

const sinceOf = (card: Card) =>
  card.columnSince === undefined ? Infinity : Date.parse(card.columnSince);

const HELD_REASONS: ReadonlySet<string | undefined> = new Set([
  "stop_session",
  "usage_stop",
  "budget",
]);

const activeSession = (card: Card) =>
  card.sessions?.find((s) => s.id === card.activeSessionId);

/** True for a lost card in In progress or Needs input whose board has the supervisor on. */
function eligible(card: Card): boolean {
  const session = activeSession(card);
  return (
    card.sessionLost === true &&
    session !== undefined &&
    session.state !== "lost" &&
    (card.column === "in_progress" || card.column === "needs_input") &&
    store.getBoard(card.boardKey ?? DEFAULT_BOARD_KEY)?.policy.supervisor ===
      "on"
  );
}

function candidates(): Card[] {
  return store
    .listCards(ALL_BOARDS)
    .filter(eligible)
    .sort((a, b) => {
      const [x, y] = [sinceOf(a), sinceOf(b)];
      return x === y ? 0 : x < y ? -1 : 1;
    });
}

/**
 * Resume the supervised cards that a boot marked lost, oldest first, one card at a time.
 *
 * @remarks Each card is re-read and re-checked on its turn, and each resume runs after a fresh memory
 * reading, because a parallel sweep would pass every memory check before memory drops. The cap gates
 * only cards that hold a loop slot, and the first memory refusal stops the rest of the sweep.
 */
export async function resumeLostAtBoot(
  overrides: Partial<BootDeps> = {},
): Promise<void> {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  let stopped: string | null = null;
  for (const { id } of candidates()) {
    const card = store.getCard(id);
    if (card === undefined || !eligible(card)) continue;
    const key = card.boardKey ?? DEFAULT_BOARD_KEY;
    const say = (result: string) =>
      deps.log(`[supervisor] boot resume ${card.identifier}: ${result}`);
    if (stopped !== null) {
      say(`skipped: memory-low (${stopped})`);
      continue;
    }
    const held = activeSession(card)?.stateReason;
    if (HELD_REASONS.has(held)) {
      say(`skipped: held (${held})`);
      continue;
    }
    await deps.sample();
    const memory = memoryCheck(key);
    if (!memory.ok) {
      stopped = memory.reason;
      say(`skipped: memory-low (${stopped})`);
      continue;
    }
    if (card.source === "group" || card.launch !== undefined) {
      const cap = checkCap({
        policy: ownerPolicy(card) ?? { concurrencyCap: 0 },
        runningLoops: runningLoops(key),
      });
      if (!cap.ok) {
        say(`skipped: cap (${cap.reason})`);
        continue;
      }
    }
    let failure: string | null = null;
    try {
      await deps.supervise(card.id);
    } catch (err) {
      failure = (err as Error).message;
    }
    const after = store.getCard(card.id);
    const session = after === undefined ? undefined : activeSession(after);
    const resumeFailed =
      session?.state === "needs_input" &&
      session.stateReason === "resume_failed";
    if (
      failure === null &&
      after !== undefined &&
      hasLiveSession(after) &&
      !resumeFailed
    ) {
      say("resumed");
      continue;
    }
    say(
      `failed: ${failure ?? after?.resumeError ?? session?.stateReason ?? "not resumed"}`,
    );
  }
}
