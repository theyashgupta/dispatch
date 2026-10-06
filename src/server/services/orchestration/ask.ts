import { run } from "../../adapters/exec.js";
import { claudeBinaryPath } from "../../adapters/claude-cli.js";
import { boardRepository as store } from "../../store/board-repository.js";
import type { AskRequest } from "../../../shared/types.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import { buildAskContext } from "../domain/ask-context.js";
import { buildAskPrompt } from "../domain/ask-prompt.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";

const ASK_TIMEOUT_MS = 180_000;
const stopAll = new AbortController();

type AskFailure = "timeout" | "empty" | "exit";

/**
 * A failed Ask run, named by kind so the route maps it to a status without reading its output.
 */
export class AskError extends Error {
  constructor(readonly kind: AskFailure) {
    super(`ask ${kind}`);
  }
}

/**
 * Run headless `claude -p` with no tools over a prompt on stdin and return its trimmed answer.
 *
 * @remarks run() sets `killed` only for its own timeout kill, which is how a timeout is told
 * apart from an abort or a crash. Hooks are disabled because user hooks and plugins would otherwise receive
 * the whole board prompt. `timeoutMs` exists for the timeout test only.
 */
export async function askClaude(
  prompt: string,
  signal: AbortSignal,
  timeoutMs = ASK_TIMEOUT_MS,
): Promise<string> {
  const claudePath = await claudeBinaryPath();
  const runSignal = AbortSignal.any([signal, stopAll.signal]);
  let stdout: string;
  try {
    ({ stdout } = await run(
      claudePath,
      [
        "-p",
        "--output-format",
        "text",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--settings",
        '{"disableAllHooks":true}',
      ],
      {
        cwd: DISPATCH_DIR,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        killEscalationMs: 5_000,
        signal: runSignal,
        input: prompt,
      },
    ));
  } catch (err) {
    const timedOut = (err as { killed?: boolean }).killed === true;
    throw new AskError(timedOut ? "timeout" : "exit");
  }
  const answer = stdout.trim();
  if (answer === "") throw new AskError("empty");
  return answer;
}

/**
 * Abort every running Ask child; the server calls it on shutdown so no claude outlives it.
 */
export function stopAskRuns(): void {
  stopAll.abort();
}

/**
 * Answer one Ask request from the full board: every card, every item and the sync meta.
 *
 * @remarks Async so a throw while building the context rejects, which the route's finally needs
 * to clear its single-flight flag.
 */
export async function answerAsk(
  request: AskRequest,
  signal: AbortSignal,
): Promise<string> {
  const { syncedAt, enabledSources } = store.snapshot(DEFAULT_BOARD_KEY);
  const context = buildAskContext(
    store.listCards(DEFAULT_BOARD_KEY),
    store.wireItems(),
    { syncedAt, enabledSources: enabledSources ?? [] },
    new Date(),
  );
  return askClaude(
    buildAskPrompt(context, request.history, request.question),
    signal,
  );
}
