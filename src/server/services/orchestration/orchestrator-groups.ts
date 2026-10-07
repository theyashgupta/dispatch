import path from "node:path";
import type { Board, Card } from "../../../shared/types.js";
import { run } from "../../adapters/exec.js";
import { branchExists } from "../../adapters/git.js";
import {
  redactCard,
  boardRepository as store,
} from "../../store/board-repository.js";
import {
  ConflictError,
  PolicyError,
  ValidationError,
} from "../domain/errors.js";
import {
  checkBudget,
  checkCap,
  type PolicyCheck,
} from "../domain/orchestrator-policy.js";
import {
  checkScope,
  type OrchestratorIdentity,
} from "../domain/orchestrator-scope.js";
import {
  dependencyDone,
  isLiveSessionCard,
  isRunningCard,
  resolveBoard,
  runningLoops,
} from "./boards.js";
import {
  createGroup,
  recordStartFailure,
  requireOrchestrationConfig,
  startGroup,
} from "./group-launch.js";
import { groupCost } from "./orchestrator-read.js";

export const groupStarter: { start: typeof startGroup } = {
  start: startGroup,
};

const BASE_BRANCH_RE = /^base\/[a-z0-9][a-z0-9._/-]{0,60}$/;

interface GroupRequest {
  title: string;
  memberIds: string[];
  repos: { path: string; base: string }[];
  playbook?: string | undefined;
  direction?: string | undefined;
  dependsOn?: string[] | undefined;
}

/** Throw the typed 400 unless `repository` is a repository path of the board. */
function assertBoardRepository(board: Board, repository: string): void {
  if (!board.repositories.some((r) => r.path === repository)) {
    throw new ValidationError("unknown-repository");
  }
}

/** Run one local git command in `repository`; its trimmed stdout, or null when git fails. */
async function gitProbe(
  repository: string,
  args: string[],
): Promise<string | null> {
  try {
    return (await run("git", args, { cwd: repository })).stdout.trim();
  } catch {
    return null;
  }
}

/** Throw a refused policy check as the typed 403 with its reason. */
export function enforce(check: PolicyCheck): void {
  if (!check.ok) throw new PolicyError(check.reason);
}

/**
 * Create a local `base/...` branch in a board repository from a start point.
 *
 * @remarks Every git call is local and takes argv, so no name or start point reaches a shell or a
 * remote. `check-ref-format` catches the forms the name pattern still lets through, such as `//`.
 */
export async function createBaseBranch(
  caller: OrchestratorIdentity,
  input: { repository: string; name: string; startPoint: string },
): Promise<{ repository: string; name: string; commit: string }> {
  const { repository, name, startPoint } = input;
  assertBoardRepository(resolveBoard(caller.boardKey), repository);
  if (
    !BASE_BRANCH_RE.test(name) ||
    name.includes("..") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    (await gitProbe(repository, ["check-ref-format", `refs/heads/${name}`])) ===
      null
  ) {
    throw new ValidationError("invalid-branch-name");
  }
  const commit = startPoint.startsWith("-")
    ? null
    : await gitProbe(repository, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${startPoint}^{commit}`,
      ]);
  if (!commit) throw new ValidationError("unknown-start-point");
  if (await branchExists(repository, name)) {
    throw new ConflictError("branch-exists");
  }
  await run("git", ["branch", name, startPoint], { cwd: repository });
  return { repository, name, commit };
}

/**
 * Create a group card on the orchestrator's board with its launch values, without starting it.
 *
 * @remarks The workspace folder is the parent folder of the first repository, the folder a person
 * picks in the start form. Repositories and dependencies are checked before anything is written.
 */
export async function createOrchestratorGroup(
  caller: OrchestratorIdentity,
  input: GroupRequest,
): Promise<Card> {
  const board = resolveBoard(caller.boardKey);
  for (const repo of input.repos) assertBoardRepository(board, repo.path);
  const dependsOn = input.dependsOn ?? [];
  for (const id of dependsOn) {
    const dep = store.getCard(id);
    if (dep?.source !== "group" || !checkScope(caller, dep).ok) {
      throw new ValidationError("invalid-dependency");
    }
  }
  const card = await createGroup(board.key, {
    title: input.title,
    memberIds: input.memberIds,
    playbook: input.playbook,
    workspace: {
      folder: path.dirname(input.repos[0]?.path ?? ""),
      repos: input.repos,
    },
  });
  await store.setOrchestratorFields(card.id, {
    createdByOrchestrator: caller.orchestratorId,
    launch: {
      direction: input.direction ?? "",
      ...(input.playbook === undefined ? {} : { playbook: input.playbook }),
    },
  });
  await store.setGroupQueue(card.id, { startQueued: false, dependsOn });
  return redactCard(store.getCard(card.id) ?? card);
}

/**
 * Start a group under the board's cap and budget, or hold it until its dependencies are done.
 *
 * @remarks Every refusal throws before the first write, so a refused start leaves no queue flag and
 * no session. The cap check and the start run in one tick, so two overlapping calls cannot both
 * take the last slot; a failed start restores the queue flag and answers 409 `start-failed`.
 */
export async function startOrchestratorGroup(
  caller: OrchestratorIdentity,
  card: Card,
): Promise<{ started: true } | { queued: true; waitingOn: string[] }> {
  if (card.source !== "group") throw new ValidationError("not-group-card");
  if (isRunningCard(card) || isLiveSessionCard(card)) {
    throw new ConflictError("already-started");
  }
  const policy = resolveBoard(caller.boardKey).policy;
  enforce(checkCap({ policy, runningLoops: runningLoops(caller.boardKey) }));
  enforce(checkBudget({ policy, cost: groupCost(card) }));
  const waitingOn = (card.dependsOn ?? []).filter((id) => !dependencyDone(id));
  if (waitingOn.length > 0) {
    await store.setGroupQueue(card.id, { startQueued: true });
    return { queued: true, waitingOn };
  }
  const config = requireOrchestrationConfig();
  const wasQueued = card.startQueued === true;
  const outcome = groupStarter.start(
    card.id,
    {
      extraDirection: card.launch?.direction,
      playbook: card.launch?.playbook,
    },
    config,
  );
  if (wasQueued) await store.setGroupQueue(card.id, { startQueued: false });
  const result = await outcome;
  if (!result.ok) {
    await recordStartFailure(card, wasQueued, result.reason);
    throw new ConflictError("start-failed", { reason: result.reason });
  }
  return { started: true };
}
