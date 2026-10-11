import path from "node:path";
import type { Card } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";
import { checkCap } from "../domain/orchestrator-policy.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import { playbookExists } from "../infra/playbooks.js";
import {
  callerPolicy,
  getBoard,
  isLiveSessionCard,
  isRunningCard,
  runningLoops,
  withCapLock,
} from "./boards.js";
import {
  assertBoardRepository,
  enforce,
  resolveRepos,
} from "./orchestrator-groups.js";
import { ORCHESTRATOR_PLAYBOOK } from "./orchestrator-session.js";
import { commitCardStart, prepareCardStart } from "./start-session.js";

interface CardStartRequest {
  playbook: string;
  direction?: string | undefined;
  folder?: string | undefined;
  repos?: { path: string; base: string }[] | undefined;
}

/**
 * Start the session of one ticket card with a playbook and a direction, as the start dialog does.
 *
 * @remarks
 * Inside the cap lock the card is re-read, prepared, cap-checked, given its workspace and `launch`,
 * then started, in that order, so a refusal or a failed workspace write leaves no `launch` and no
 * session. The re-read refuses a parallel start of the same card, and the card is already in the
 * scope of the caller.
 */
export async function startOrchestratorCard(
  caller: OrchestratorIdentity,
  card: Card,
  input: CardStartRequest,
): Promise<{ started: true; cardId: string; playbook: string }> {
  if (card.source === "group") throw new ValidationError("not-ticket-card");
  if (isRunningCard(card) || isLiveSessionCard(card)) {
    throw new ConflictError("already-started");
  }
  if (input.playbook === ORCHESTRATOR_PLAYBOOK.playbook) {
    throw new ValidationError("orchestrator-playbook");
  }
  if (!(await playbookExists(input.playbook))) {
    throw new ValidationError("unknown-playbook");
  }
  const board = getBoard(caller.boardKey);
  let workspace: NonNullable<Card["workspace"]> | undefined;
  if (input.repos !== undefined || !card.workspace) {
    const repos = resolveRepos(board, input.repos);
    for (const repo of repos) assertBoardRepository(board, repo.path);
    workspace = {
      folder: input.folder ?? path.dirname(repos[0]?.path ?? ""),
      repos,
    };
  }
  const direction = input.direction ?? "";
  const start = {
    extraDirection: direction,
    playbook: input.playbook,
    workspace,
  };
  await withCapLock(async () => {
    const current = store.getCard(card.id);
    if (!current || isRunningCard(current) || isLiveSessionCard(current)) {
      throw new ConflictError("already-started");
    }
    const config = await prepareCardStart(card.id, start);
    enforce(
      checkCap({
        policy: callerPolicy(caller),
        runningLoops: runningLoops(caller.boardKey),
      }),
    );
    await commitCardStart(card.id, config, start, () =>
      store.setOrchestratorFields(card.id, {
        launch: { playbook: input.playbook, direction },
        ...(current.ownerOrchestrator
          ? {}
          : { ownerOrchestrator: caller.orchestratorId }),
      }),
    );
  });
  return { started: true, cardId: card.id, playbook: input.playbook };
}
