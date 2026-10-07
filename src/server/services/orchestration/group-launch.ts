import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { BoardKey, Card, Config } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";
import { getOrchestrationConfig } from "../infra/config-holder.js";
import { loadPlaybooks } from "../infra/playbooks.js";
import { mapBoardUnavailable } from "./boards.js";
import { startSession } from "./start-session.js";
import { restatRepos } from "./workspaces.js";

interface GroupInput {
  title: string;
  memberIds: string[];
  playbook?: string | undefined;
  workspace?:
    { folder: string; repos: { path: string; base: string }[] } | undefined;
}

type SessionStarter = typeof startSession;

const INELIGIBLE = "some selected cards are no longer eligible to be grouped";

/**
 * The reason a card cannot join a new group, or null when it can.
 *
 * @remarks The client selection is a snapshot, so every member is re-checked against the live
 * store. The caller collects every offending id, not only the first.
 */
function memberIneligibleReason(
  card: Card | undefined,
  board: BoardKey,
): string | null {
  if (!card) return "unknown card id";
  if ((card.boardKey ?? DEFAULT_BOARD_KEY) !== board) return "on another board";
  if (card.column !== "todo") return "not in To Do";
  if (card.groupId != null) return "already grouped";
  if (card.source === "group") return "is itself a group";
  return null;
}

/** The loaded config, or the typed 400 `orchestration config is not loaded`. */
export function requireOrchestrationConfig(): Config {
  const config = getOrchestrationConfig();
  if (!config) {
    throw new ValidationError("orchestration config is not loaded", {
      variant: "config",
    });
  }
  return config;
}

/**
 * Mint a group card from the member cards and give it its workspace, without starting a session.
 *
 * @remarks The checks run in this order: members, config, playbook, workspace, base branch,
 * repositories. The store repeats the member check inside its write queue, so a member that was
 * raced ineligible still answers the same 409.
 */
export async function createGroup(
  board: BoardKey,
  input: GroupInput,
): Promise<Card> {
  const { title, memberIds, playbook, workspace } = input;
  const ineligibleIds = memberIds.filter(
    (id) => memberIneligibleReason(store.getCard(id), board) != null,
  );
  if (ineligibleIds.length > 0) {
    throw new ConflictError(INELIGIBLE, { ineligibleIds });
  }

  requireOrchestrationConfig();

  if (playbook !== undefined) {
    const known = (await loadPlaybooks()).some((p) => p.name === playbook);
    if (!known) {
      throw new ValidationError("unknown playbook", { variant: "playbook" });
    }
  }

  if (!workspace) {
    throw new ValidationError("No workspace selected for this group", {
      variant: "config",
    });
  }

  if (workspace.repos.some((r) => r.base.startsWith("-"))) {
    throw new ValidationError("invalid base branch", { variant: "config" });
  }
  if (!(await restatRepos(workspace.repos))) {
    throw new ValidationError("Can't start: a selected repo is missing", {
      variant: "config",
    });
  }

  const groupResult = await store
    .createGroupCard(board, title, memberIds)
    .catch((err: unknown) => {
      throw mapBoardUnavailable(err);
    });
  if (!groupResult.ok) {
    throw new ConflictError(INELIGIBLE, {
      ineligibleIds: groupResult.ineligibleIds,
    });
  }
  await store.setCardWorkspace(groupResult.card.id, workspace);
  return groupResult.card;
}

export type GroupStartOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Start the session of a group card and resolve how the start ended.
 *
 * @remarks The session starter runs synchronously up to its in-flight mark, so a caller that checks
 * the cap right before this call holds the slot in the same tick. A thrown error or a start error
 * left on the card resolves as a failure; nothing rejects. `start` is a seam for tests.
 */
export function startGroup(
  cardId: string,
  opts: {
    extraDirection?: string | undefined;
    playbook?: string | undefined;
  },
  config: Config = requireOrchestrationConfig(),
  start: SessionStarter = startSession,
): Promise<GroupStartOutcome> {
  return start(cardId, opts.extraDirection ?? "", config, {
    playbook: opts.playbook,
  }).then(
    (): GroupStartOutcome => {
      const error = store.getCard(cardId)?.startError;
      return error
        ? { ok: false, reason: `start failed at ${error.step}` }
        : { ok: true };
    },
    (err: unknown): GroupStartOutcome => {
      console.warn(
        `[group] start of ${cardId} failed: ${(err as Error).message}`,
      );
      return { ok: false, reason: "start failed" };
    },
  );
}

/**
 * Put a failed group start back as it was and record the failure as one orchestration event.
 *
 * @remarks `wasQueued` is the queue flag before the start, so a held group is picked up again
 * and a direct start of a group that was not held stays unqueued.
 */
export async function recordStartFailure(
  card: Card,
  wasQueued: boolean,
  reason: string,
): Promise<void> {
  if (wasQueued) await store.setGroupQueue(card.id, { startQueued: true });
  store.appendOrchestrationEvent({
    boardKey: card.boardKey ?? DEFAULT_BOARD_KEY,
    cardId: card.id,
    sessionId: null,
    kind: "supervisor_action",
    data: { action: "start_group_failed", reason },
    ts: new Date().toISOString(),
  });
}
