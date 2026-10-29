import type { Card, Session } from "../../../shared/types.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  capturePane,
  paneAtPrompt,
  sendKeys,
  sendLiteral,
} from "../../adapters/tmux.js";
import type { Detection } from "../domain/supervisor-state.js";
import { RELEASE_AFTER_MS, releaseDue } from "../domain/session-release.js";
import { withCardLock } from "./card-lock.js";
import { footer } from "./session-account-move.js";
import { turnStateOf } from "./session-turn.js";
import { awaitShellPrompt, READY } from "./steps.js";
import { record } from "./supervisor-record.js";

const EXIT_TIMEOUT_MS = 15_000;
const BACKGROUND_EXIT_MENU = /Background work is running/;

const retryAt = new Map<string, number>();

/**
 * How long a finished session idles before release.
 *
 * @remarks
 * `DISPATCH_RELEASE_AFTER_MS` overrides the default so the sandbox e2e can shorten it.
 */
function releaseAfterMs(): number {
  const override = Number(process.env.DISPATCH_RELEASE_AFTER_MS);
  return Number.isFinite(override) && override > 0
    ? override
    : RELEASE_AFTER_MS;
}

function dueNow(
  card: Card,
  session: Session,
  detection: Pick<Detection, "state" | "busy">,
  changed: boolean,
  now: number,
): boolean {
  return releaseDue({
    column: card.column,
    loopCard: card.source === "group" || card.launch !== undefined,
    lastMarker: session.lastMarker,
    engineOpen:
      card.loopProgress?.engine?.active === true &&
      !card.loopProgress.engine.closed,
    storedState: session.state ?? null,
    detectedState: detection.state,
    busy: detection.busy === true,
    changed,
    paused: Boolean(card.paused),
    starting: store.isStarting(card.id),
    shipFlowState: card.shipFlow?.state,
    columnSince: card.columnSince,
    stateSince: session.stateSince,
    now,
    afterMs: releaseAfterMs(),
  }).due;
}

/**
 * Exit Claude in a finished loop session once it has idled long enough, and mark the session `released`.
 *
 * @remarks
 * The tmux session, the pane text, the column and the DONE marker stay, so nothing is killed and
 * `resume_session` or Run Claude can bring Claude back. The state is written before `/exit` is typed, so
 * `send_prompt` refuses during the exit window. A `/exit` that does not reach the shell in 15 s restores the
 * state, records `busy`, presses Escape on the background work menu, and is not tried again for the same period.
 */
export async function releaseIfDue(
  card: Card,
  session: Session,
  detection: Pick<Detection, "state" | "busy">,
  changed: boolean,
  now: number,
): Promise<void> {
  const tmuxSession = session.tmuxSession;
  if (tmuxSession === undefined) return;
  if (now < (retryAt.get(session.id) ?? 0)) return;
  if (!dueNow(card, session, detection, changed, now)) return;
  const from = session.state ?? null;
  const evidence = `idle ${Math.round(releaseAfterMs() / 1000)} s after DONE`;
  const outcome = await withCardLock(
    card.id,
    async (): Promise<"skipped" | "not-idle" | "exit-failed" | "released"> => {
      const fresh = store.getCard(card.id);
      const live = fresh?.sessions?.find((s) => s.id === session.id);
      if (!fresh || !live || !dueNow(fresh, live, detection, changed, now))
        return "skipped";
      const paneTarget = `=${tmuxSession}:`;
      const pane = await capturePane(paneTarget).catch(() => "");
      if (
        turnStateOf(fresh.id, live.id, pane) !== "idle" ||
        !READY.test(footer(pane))
      )
        return "not-idle";
      const previous = live.state ?? detection.state;
      await store.setSessionStateIfSession(fresh.id, live.id, "released");
      try {
        await sendLiteral(paneTarget, "/exit");
        await sendKeys(paneTarget, ["Enter"]);
        await awaitShellPrompt(tmuxSession, EXIT_TIMEOUT_MS);
      } catch {
        if (await paneAtPrompt(paneTarget).catch(() => false))
          return "released";
        const left = await capturePane(paneTarget).catch(() => "");
        if (BACKGROUND_EXIT_MENU.test(left)) {
          await sendKeys(paneTarget, ["Escape"]);
        }
        if (
          store.getCard(fresh.id)?.sessions?.find((s) => s.id === live.id)
            ?.state === "released"
        )
          await store.setSessionStateIfSession(fresh.id, live.id, previous);
        return "exit-failed";
      }
      return "released";
    },
  );
  if (outcome === "busy" || outcome === "skipped" || outcome === "not-idle")
    return;
  if (outcome === "exit-failed") {
    retryAt.set(session.id, now + releaseAfterMs());
    record(card, session, {
      action: "release_session",
      result: "busy",
      evidence,
    });
    return;
  }
  retryAt.delete(session.id);
  record(card, session, {
    action: "release_session",
    result: "released",
    evidence,
  });
  record(card, session, { from, to: "released", evidence }, "supervisor_state");
}
