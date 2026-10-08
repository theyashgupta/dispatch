import { withBoard } from "../../../../shared/board-select.js";
import type {
  Board,
  BoardKey,
  BoardPolicy,
  DecisionItem,
  OrchestratorScope,
  OrchestratorPolicyOverride,
} from "../../../../shared/types.js";
import { http, type ApiFailure } from "@/lib/http";
import type { ScopeStep } from "@/modules/orchestrator/domain/ownership";
import {
  refusalReason,
  type ControlKind,
  type OrchestratorView,
} from "@/modules/orchestrator/domain/panel-model";

export type ActionResult = { ok: true } | { ok: false; reason: string };

const JSON_HEADERS = { "Content-Type": "application/json" };

function boardUrl(board: BoardKey): string {
  return `/api/boards/${encodeURIComponent(board)}/orchestrators`;
}

function reasonOf(failure: ApiFailure): string {
  const detail = (failure.body as { reason?: unknown } | null)?.reason;
  return refusalReason(
    failure.error,
    typeof detail === "string" ? detail : null,
  );
}

/**
 * Send one user action and map the response to a result with its data.
 *
 * @remarks
 * A refusal is a 4xx with `{ error }` and optional `reason`, and a network failure
 * resolves as a refusal too, so a caller handles one shape.
 */
async function request<T>(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const result = await http<T>(url, init);
    return result.ok
      ? { ok: true, data: result.data }
      : { ok: false, reason: reasonOf(result) };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "the request failed",
    };
  }
}

async function send(url: string, init: RequestInit): Promise<ActionResult> {
  const result = await request<unknown>(url, init);
  return result.ok ? { ok: true } : result;
}

/** Read the orchestrators of a board with their session views: GET /api/boards/:key/orchestrators. */
export async function getOrchestrators(
  board: BoardKey,
): Promise<OrchestratorView[]> {
  const result = await http<{ orchestrators: OrchestratorView[] }>(
    boardUrl(board),
  );
  if (!result.ok) {
    throw new Error(
      `getOrchestrators failed: ${result.status} ${result.statusText}`.trim(),
    );
  }
  return result.data.orchestrators;
}

/** Add the main orchestrator record of a board: POST /api/boards/:key/orchestrators. */
export function addMainOrchestrator(board: BoardKey): Promise<ActionResult> {
  return send(boardUrl(board), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: "main",
      name: "Main orchestrator",
      role: "main",
    }),
  });
}

/** Run one lifecycle call: POST /api/boards/:key/orchestrators/:id/start, stop or resume. */
export function runLifecycle(
  board: BoardKey,
  id: string,
  kind: ControlKind,
): Promise<ActionResult> {
  return send(`${boardUrl(board)}/${encodeURIComponent(id)}/${kind}`, {
    method: "POST",
    headers: JSON_HEADERS,
  });
}

/**
 * Start the main orchestrator, adding its record first on a board that has none.
 *
 * @remarks
 * A refused add stops the saga, so a board never gets a start call without a record.
 */
export async function startMain(
  board: BoardKey,
  hasRecord: boolean,
): Promise<ActionResult> {
  if (!hasRecord) {
    const added = await addMainOrchestrator(board);
    if (!added.ok) return added;
  }
  return runLifecycle(board, "main", "start");
}

/** Ensure a ttyd terminal for the hidden card of an orchestrator: POST /api/cards/:id/terminal. */
export async function ensureOrchestratorTerminal(
  cardId: string,
): Promise<ActionResult> {
  return send(`/api/cards/${encodeURIComponent(cardId)}/terminal`, {
    method: "POST",
    headers: JSON_HEADERS,
  });
}

export type ReplyOutcome =
  | { ok: true; result: "confirmed" | "unconfirmed" }
  | { ok: false; reason: string };

export type SaveOutcome =
  { ok: true; board: Board } | { ok: false; reason: string };

export interface ExtraInput {
  id: string;
  name: string;
  scope: OrchestratorScope;
  policyOverride: OrchestratorPolicyOverride;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** Read the open decision items of a board: GET /api/decisions?state=open. */
export async function getOpenDecisions(
  board: BoardKey,
): Promise<DecisionItem[]> {
  const result = await http<{ items: DecisionItem[] }>(
    withBoard("/api/decisions?state=open", board),
  );
  if (!result.ok) {
    throw new Error(
      `getOpenDecisions failed: ${result.status} ${result.statusText}`.trim(),
    );
  }
  return result.data.items;
}

/** Answer a decision item with one of its options and an optional typed note: POST /api/decisions/:id/answer. */
export function answerDecision(
  id: string,
  optionId: string,
  note: string | null,
): Promise<ActionResult> {
  return send(
    `/api/decisions/${encodeURIComponent(id)}/answer`,
    jsonInit("POST", note === null ? { optionId } : { optionId, note }),
  );
}

/** Type into a loop session as the user: POST /api/sessions/:cardId/input. */
export async function sendLoopInput(
  cardId: string,
  text: string,
): Promise<ReplyOutcome> {
  const result = await request<{ result: "confirmed" | "unconfirmed" }>(
    `/api/sessions/${encodeURIComponent(cardId)}/input`,
    jsonInit("POST", { text }),
  );
  return result.ok ? { ok: true, result: result.data.result } : result;
}

/** Resume a loop that waits at needs_input, as the user: POST /api/sessions/:cardId/resume-loop. */
export async function resumeLoop(cardId: string): Promise<ReplyOutcome> {
  const result = await request<{ result: "confirmed" | "unconfirmed" }>(
    `/api/sessions/${encodeURIComponent(cardId)}/resume-loop`,
    { method: "POST", headers: JSON_HEADERS },
  );
  return result.ok ? { ok: true, result: result.data.result } : result;
}

/** Save the board policy: PUT /api/boards/:key/policy with the ten policy fields. */
export async function saveBoardPolicy(
  board: BoardKey,
  policy: BoardPolicy,
): Promise<SaveOutcome> {
  const result = await request<{ board: Board }>(
    `/api/boards/${encodeURIComponent(board)}/policy`,
    jsonInit("PUT", policy),
  );
  return result.ok ? { ok: true, board: result.data.board } : result;
}

/** Add an extra orchestrator: POST /api/boards/:key/orchestrators. */
export function addExtraOrchestrator(
  board: BoardKey,
  input: ExtraInput,
): Promise<ActionResult> {
  return send(boardUrl(board), jsonInit("POST", { ...input, role: "extra" }));
}

/** Replace the override of an extra: PATCH /api/boards/:key/orchestrators/:id. */
export function saveOverrides(
  board: BoardKey,
  id: string,
  policyOverride: OrchestratorPolicyOverride,
): Promise<ActionResult> {
  return send(
    `${boardUrl(board)}/${encodeURIComponent(id)}`,
    jsonInit("PATCH", { policyOverride }),
  );
}

/**
 * Apply scope changes in order, and put the earlier scopes back when a later step fails.
 *
 * @remarks
 * The server refuses a group that two extras list, so a move removes it from the source before it adds it to the target. A failed add would leave the groups with the main, so the source scope is restored on a best effort basis.
 */
export async function patchScopes(
  board: BoardKey,
  steps: readonly ScopeStep[],
): Promise<ActionResult> {
  const done: ScopeStep[] = [];
  for (const step of steps) {
    const result = await send(
      `${boardUrl(board)}/${encodeURIComponent(step.id)}`,
      jsonInit("PATCH", { scope: step.scope }),
    );
    if (!result.ok) {
      for (const prior of done.reverse()) {
        await send(
          `${boardUrl(board)}/${encodeURIComponent(prior.id)}`,
          jsonInit("PATCH", { scope: prior.restore }),
        );
      }
      return result;
    }
    done.push(step);
  }
  return { ok: true };
}
