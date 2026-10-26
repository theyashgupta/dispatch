import type { BoardKey, Card, Session } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  capturePane,
  paneAtPrompt,
  sendKeys,
  sendLiteral,
  sessionEnvHas,
} from "../../adapters/tmux.js";
import { floorReleasable } from "../domain/floor-release.js";
import { withCardLock } from "./card-lock.js";
import { footer } from "./session-account-move.js";
import { turnStateOf } from "./session-turn.js";
import { awaitShellPrompt, READY, SHELL_SESSION_ENV } from "./steps.js";
import { record } from "./supervisor-record.js";

const EXIT_TIMEOUT_MS = 15_000;
const BACKGROUND_EXIT_MENU = /Background work is running/;
const EVIDENCE = "memory floor";

const exiting = new Set<string>();

export const floorReleaseTools: {
  capturePane: typeof capturePane;
  paneAtPrompt: typeof paneAtPrompt;
  sendKeys: typeof sendKeys;
  sendLiteral: typeof sendLiteral;
  awaitShellPrompt: typeof awaitShellPrompt;
  sessionEnvHas: typeof sessionEnvHas;
} = {
  capturePane,
  paneAtPrompt,
  sendKeys,
  sendLiteral,
  awaitShellPrompt,
  sessionEnvHas,
};

/**
 * True while the floor path types `/exit` into the session.
 *
 * @remarks The pane still shows Claude until the shell prompt returns, so the supervisor holds `released` by this flag in that window.
 */
export function floorExiting(sessionId: string): boolean {
  return exiting.has(sessionId);
}

function liveSession(cardId: string, sessionId: string) {
  const card = store.getCard(cardId);
  const session = card?.sessions?.find((s) => s.id === sessionId);
  return card && session ? { card, session } : null;
}

/**
 * Exit Claude in one finished session and mark it `released`, or answer false and leave it as it was.
 *
 * @remarks The tmux session, the pane text, the column and the DONE marker stay. A legacy session has no
 * shell under Claude, so it is skipped. The state is written before `/exit` so `send_prompt` refuses in
 * the exit window, and an exit that does not reach the shell in 15 s restores it.
 */
async function releaseOne(card: Card, session: Session): Promise<boolean> {
  const tools = floorReleaseTools;
  const outcome = await withCardLock(card.id, async () => {
    const live = liveSession(card.id, session.id);
    if (
      !live ||
      !floorReleasable(live.card, live.session, store.isStarting(card.id))
    )
      return false;
    const tmuxSession = live.session.tmuxSession!;
    const target = `=${tmuxSession}:`;
    const shellUnder = await tools
      .sessionEnvHas(`=${tmuxSession}`, SHELL_SESSION_ENV)
      .catch(() => false);
    if (!shellUnder) return false;
    const pane = await tools.capturePane(target).catch(() => "");
    if (
      turnStateOf(card.id, session.id, pane) !== "idle" ||
      !READY.test(footer(pane))
    )
      return false;
    const previous = live.session.state ?? "idle";
    await store.setSessionStateIfSession(card.id, session.id, "released");
    exiting.add(session.id);
    try {
      await tools.sendLiteral(target, "/exit");
      await tools.sendKeys(target, ["Enter"]);
      await tools.awaitShellPrompt(tmuxSession, EXIT_TIMEOUT_MS);
    } catch {
      if (await tools.paneAtPrompt(target).catch(() => false)) return true;
      const left = await tools.capturePane(target).catch(() => "");
      if (BACKGROUND_EXIT_MENU.test(left))
        await tools.sendKeys(target, ["Escape"]);
      if (liveSession(card.id, session.id)?.session.state === "released")
        await store.setSessionStateIfSession(card.id, session.id, previous);
      record(card, session, {
        action: "release_session",
        result: "busy",
        evidence: EVIDENCE,
      });
      return false;
    } finally {
      exiting.delete(session.id);
    }
    return true;
  });
  if (outcome !== true) return false;
  record(card, session, {
    action: "release_session",
    result: "released",
    evidence: EVIDENCE,
  });
  record(
    card,
    session,
    { from: session.state ?? null, to: "released", evidence: EVIDENCE },
    "supervisor_state",
  );
  return true;
}

/**
 * Exit Claude in every finished session on a board and answer how many were released.
 *
 * @remarks Only the active session of each card is a candidate. The exits run in parallel, so the
 * call takes about one 15 s exit timeout at most.
 */
export async function releaseFinished(boardKey: BoardKey): Promise<number> {
  const candidates = store.listCards(boardKey).flatMap((card) => {
    const session = card.sessions?.find((s) => s.id === card.activeSessionId);
    return session && floorReleasable(card, session, store.isStarting(card.id))
      ? [{ card, session }]
      : [];
  });
  const results = await Promise.all(
    candidates.map(({ card, session }) =>
      releaseOne(card, session).catch(() => false),
    ),
  );
  return results.filter(Boolean).length;
}
