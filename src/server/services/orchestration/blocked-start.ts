import path from "node:path";
import type { BoardKey, Card } from "../../../shared/types.js";
import {
  boardRepository as store,
  compareTodoOrder,
} from "../../store/board-repository.js";
import { isReadyBlocked } from "../domain/blocked-by.js";
import { checkCap } from "../domain/orchestrator-policy.js";
import { playbookExists } from "../infra/playbooks.js";
import {
  dependencyDone,
  getBoard,
  isLiveSessionCard,
  isRunningCard,
  runningLoops,
  withCapLock,
} from "./boards.js";
import { memoryCheck } from "./memory-governor.js";
import { resolveRepos } from "./orchestrator-groups.js";
import { commitCardStart, prepareCardStart } from "./start-session.js";
import { ownerPolicy } from "./supervisor-record.js";

export const RETRY_MS = 60_000;

type Outcome = "started" | "skipped" | "memory-wait" | "cap-wait";

const retryTimers = new Map<BoardKey, NodeJS.Timeout>();

function stillReady(card: Card | undefined): card is Card {
  return (
    card !== undefined &&
    isReadyBlocked(card, dependencyDone) &&
    !isRunningCard(card) &&
    !isLiveSessionCard(card)
  );
}

/**
 * Retry the sweep of a board once after {@link RETRY_MS}, unless a retry is already armed.
 *
 * @remarks ponytail: the timer lives in memory, so a restart drops it and the next Done on the
 * board recovers. A boot sweep would close that gap.
 */
function armRetry(boardKey: BoardKey): void {
  if (retryTimers.has(boardKey)) return;
  const timer = setTimeout(() => {
    retryTimers.delete(boardKey);
    startUnblockedCards(boardKey).catch((err: unknown) =>
      console.warn(`[blocked-start] retry failed: ${(err as Error).message}`),
    );
  }, RETRY_MS);
  timer.unref?.();
  retryTimers.set(boardKey, timer);
}

async function firstExistingPlaybook(
  names: (string | null | undefined)[],
): Promise<string | undefined> {
  for (const name of names) {
    if (name && (await playbookExists(name))) return name;
  }
  return undefined;
}

function wait(
  card: Card,
  reason: string,
  outcome: "memory-wait" | "cap-wait",
): Outcome {
  console.log(`[blocked-start] ${card.identifier} waits: ${reason}`);
  return outcome;
}

/**
 * Try to start one ready blocked card inside the cap lock.
 *
 * @remarks Prepares the start first, then checks memory and the owner cap, then commits with no
 * await between the checks and the commit, so no other starter can take the slot. Answers
 * `memory-wait` or `cap-wait` when a guard refuses, and `skipped` for a card that is no longer ready
 * or whose start throws.
 */
async function startOne(boardKey: BoardKey, id: string): Promise<Outcome> {
  return withCapLock(async () => {
    const card = store.getCard(id);
    if (!stillReady(card)) return "skipped";
    try {
      const board = getBoard(boardKey);
      const playbook = await firstExistingPlaybook([
        card.launch?.playbook,
        card.startIntent?.playbook,
        board.policy.groupPlaybook,
      ]);
      const direction = card.launch?.direction ?? card.extraDirection ?? "";
      let workspace: NonNullable<Card["workspace"]> | undefined;
      if (!card.workspace?.repos.length) {
        const repos = resolveRepos(board, undefined);
        workspace = {
          folder: path.dirname(repos[0]?.path ?? ""),
          repos,
        };
      }
      const start = { extraDirection: direction, playbook, workspace };
      const config = await prepareCardStart(card.id, start);
      const memory = memoryCheck(boardKey);
      if (!memory.ok) return wait(card, memory.reason, "memory-wait");
      const cap = checkCap({
        policy: ownerPolicy(card) ?? board.policy,
        runningLoops: runningLoops(boardKey),
      });
      if (!cap.ok) return wait(card, cap.reason, "cap-wait");
      await commitCardStart(card.id, config, start, () =>
        store.setOrchestratorFields(card.id, {
          launch: { direction, ...(playbook ? { playbook } : {}) },
        }),
      );
      store.appendOrchestrationEvent({
        boardKey,
        cardId: card.id,
        sessionId: null,
        kind: "supervisor_action",
        data: { action: "auto_start", blockedBy: card.blockedBy ?? [] },
        ts: new Date().toISOString(),
      });
      console.log(`[blocked-start] ${card.identifier} started`);
      return "started";
    } catch (err) {
      console.warn(
        `[blocked-start] ${card.identifier} skipped: ${(err as Error).message}`,
      );
      return "skipped";
    }
  });
}

/**
 * Start the ready blocked To Do cards of a board one at a time, in To Do order.
 *
 * @remarks Never throws. A card the memory guard holds back stays in To Do and stops the sweep,
 * because every later card would meet the same refusal. A card its owner cap holds back stays in To
 * Do too, but the sweep goes on, because a later card can have another owner. Either wait arms the
 * retry timer; the next Done tries again.
 */
export async function startUnblockedCards(boardKey: BoardKey): Promise<void> {
  try {
    const ready = store
      .listCards(boardKey)
      .filter(stillReady)
      .sort(compareTodoOrder);
    for (const card of ready) {
      const outcome = await startOne(boardKey, card.id);
      if (outcome === "memory-wait" || outcome === "cap-wait") {
        armRetry(boardKey);
        if (outcome === "memory-wait") return;
      }
    }
  } catch (err) {
    console.warn(`[blocked-start] sweep failed: ${(err as Error).message}`);
  }
}
