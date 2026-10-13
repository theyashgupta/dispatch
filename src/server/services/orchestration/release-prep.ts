import type { ReleaseBump } from "../../../shared/orchestrator-limits.js";
import type { Card } from "../../../shared/types.js";
import {
  fetchBase,
  revParseVerify,
  showFileAtRef,
} from "../../adapters/git.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { ConflictError, ValidationError } from "../domain/errors.js";
import type { OrchestratorIdentity } from "../domain/orchestrator-scope.js";
import {
  nextVersion,
  releaseCardText,
  releaseTitle,
} from "../domain/release-version.js";
import { boardRefusal, callerPolicy, getBoard } from "./boards.js";
import { appendToExtraScope } from "./orchestrator-session.js";
import { createTicket } from "./ticket-create.js";

let releaseChain: Promise<unknown> = Promise.resolve();

/** Pick the repository and base branch of a release from the caller board. */
function releaseTarget(
  caller: OrchestratorIdentity,
  repository: string | undefined,
): { path: string; base: string } {
  const { repositories } = getBoard(caller.boardKey);
  if (repositories.length === 0) throw boardRefusal("no-repositories");
  const repo =
    repository === undefined
      ? (repositories.find((r) => r.baseBranch) ?? repositories[0])
      : repositories.find((r) => r.path === repository);
  if (repo === undefined) throw new ValidationError("invalid-repos");
  if (!repo.baseBranch) {
    throw new ValidationError("missing-base", { path: repo.path });
  }
  return { path: repo.path, base: repo.baseBranch };
}

/**
 * The `version` of the package.json at the origin base, else at the local base, or null.
 *
 * @remarks The local base is read only when no origin ref exists, because a local base can trail
 * the released one; a failed fetch with an origin ref present refuses the call for the same reason.
 */
async function baseVersion(repo: string, base: string): Promise<string | null> {
  const fetched = await fetchBase(repo, base).then(
    () => true,
    () => false,
  );
  const origin = `refs/remotes/origin/${base}`;
  const hasOrigin = await revParseVerify(repo, origin);
  if (!fetched && hasOrigin) throw new ConflictError("fetch-failed");
  const text = await showFileAtRef(
    repo,
    hasOrigin ? origin : `refs/heads/${base}`,
    "package.json",
  );
  if (text === null) return null;
  try {
    const version = (JSON.parse(text) as { version?: unknown } | null)?.version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/**
 * Create a To Do release card for the next version of a board repository.
 *
 * @remarks The fetch, the read, the duplicate check and the create share one promise chain, so two
 * calls never fetch at once. ponytail: one process wide chain; per board chains if release calls
 * ever contend.
 */
export async function prepareRelease(
  caller: OrchestratorIdentity,
  input: {
    repository?: string | undefined;
    bump: ReleaseBump;
    features: string[];
    prs: number[];
  },
): Promise<{
  cardId: string;
  identifier: string;
  version: string;
  previous: string;
}> {
  const target = releaseTarget(caller, input.repository);
  const create = async (): Promise<{
    card: Card;
    version: string;
    previous: string;
  }> => {
    const previous = (await baseVersion(target.path, target.base)) ?? "";
    const version = nextVersion(previous, input.bump);
    if (version === null) throw new ConflictError("invalid-version");
    const title = releaseTitle(version);
    const existing = store
      .listCards(caller.boardKey)
      .find((c) => c.title === title && c.column !== "done");
    if (existing) {
      throw new ConflictError("release-exists", { cardId: existing.id });
    }
    const card = await createTicket(caller.boardKey, {
      title,
      fullDescription: releaseCardText({
        previous,
        version,
        bump: input.bump,
        repository: target.path,
        base: target.base,
        features: input.features,
        prs: input.prs,
        shipRights: callerPolicy(caller).shipRights,
      }),
    });
    await store.setOrchestratorFields(card.id, {
      createdByOrchestrator: caller.orchestratorId,
    });
    await appendToExtraScope(caller, "ticketIds", card.id);
    return { card, version, previous };
  };
  const created = releaseChain.then(create);
  releaseChain = created.catch(() => undefined);
  const { card, version, previous } = await created;
  return { cardId: card.id, identifier: card.identifier, version, previous };
}
