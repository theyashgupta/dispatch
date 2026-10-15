import fsp from "node:fs/promises";
import path from "node:path";
import type { Card, Session } from "../../../shared/types.js";
import {
  capturePane,
  hasSession,
  sendKeys,
  sendLiteral,
} from "../../adapters/tmux.js";
import { sleep } from "../../adapters/exec.js";
import { readTranscriptTail } from "../../adapters/transcript.js";
import { paneReady } from "../domain/supervisor-state.js";
import { record, rootOf } from "./supervisor-record.js";
import { sessionTranscriptPath } from "./supervisor-transcript.js";

export type SendResult = "confirmed" | "unconfirmed";

export type SendReason =
  | "no tmux session"
  | "not ready"
  | "no session root"
  | "dialog opened"
  | "not in transcript";

export type SendOutcome = { result: SendResult; reason?: SendReason };

export interface SendTiming {
  readyMs: number;
  settleMs: number;
  confirmMs: number;
  pollMs: number;
}

export const SEND_TIMING: SendTiming = {
  readyMs: 60_000,
  settleMs: 1_500,
  confirmMs: 10_000,
  pollMs: 500,
};
const POINTER_OVER = 500;
const MATCH_CHARS = 80;
const CONTROL = /\p{Cc}+/gu;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** The line `sendConfirmed` types for a text: control characters become a space, then trimmed. */
export function typedLine(text: string): string {
  return text.replace(CONTROL, " ").trim();
}

/** Poll a check until it holds or the time is up; resolves whether it held. */
export async function waitFor(
  check: () => Promise<boolean>,
  ms: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }
}

async function pointerLine(
  root: string,
  text: string,
  kind: string,
): Promise<string> {
  const dir = path.join(root, ".dispatch-input");
  await fsp.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${kind}.md`);
  await fsp.writeFile(file, text);
  return `Read ${file} and follow it.`;
}

/**
 * Type one line into a running Claude session and confirm it in the transcript.
 *
 * @remarks Waits for the input box, sends `C-u`, the literal line and a separate `Enter`, then
 * counts user entries that hold the first 80 normalized characters (a pointer line to a file for
 * text over 500 characters matches whole); one more `Enter` is the only retry, and each `Enter`
 * waits for a fresh ready capture so a dialog that opened meanwhile never takes it. A count from
 * another file than the before count, as after `/clear`, is compared with zero.
 */
export async function sendConfirmed(
  card: Card,
  session: Session,
  text: string,
  kind: string,
  timing: SendTiming = SEND_TIMING,
  transcriptOf: () => Promise<string | null> = () =>
    sessionTranscriptPath(card, session),
): Promise<SendResult> {
  return (await sendLine(card, session, text, kind, timing, transcriptOf))
    .result;
}

/** Type one line like `sendConfirmed` and also return the reason of an unconfirmed result. */
export async function sendLine(
  card: Card,
  session: Session,
  text: string,
  kind: string,
  timing: SendTiming = SEND_TIMING,
  transcriptOf: () => Promise<string | null> = () =>
    sessionTranscriptPath(card, session),
): Promise<SendOutcome> {
  const name = session.tmuxSession;
  const target = `=${name}:`;
  const report = (
    reason: SendReason,
    line: string,
  ): { result: SendResult; reason: SendReason } => {
    record(card, session, {
      action: "send",
      kind,
      result: "unconfirmed",
      reason,
      evidence: line.slice(0, MATCH_CHARS),
    });
    return { result: "unconfirmed", reason };
  };
  if (name === undefined || !(await hasSession(`=${name}`)))
    return report("no tmux session", text);

  const ready = await waitFor(
    async () => paneReady(await capturePane(target).catch(() => "")),
    timing.readyMs,
    timing.pollMs,
  );
  if (!ready) return report("not ready", text);

  const pointer = text.length > POINTER_OVER;
  const root = rootOf(card, session);
  if (pointer && root === "") return report("no session root", text);
  const line = typedLine(pointer ? await pointerLine(root, text, kind) : text);
  const needle = pointer
    ? normalize(line)
    : normalize(line).slice(0, MATCH_CHARS);
  const matches = async () => {
    const file = await transcriptOf();
    const tail = file === null ? null : await readTranscriptTail(file);
    const count =
      tail?.userTexts.filter((t) => normalize(t).includes(needle)).length ?? 0;
    return { file, count };
  };
  const before = await matches();
  const enterIfReady = async () => {
    if (!paneReady(await capturePane(target).catch(() => ""))) return false;
    await sendKeys(target, ["Enter"]);
    return true;
  };
  await sendKeys(target, ["C-u"]);
  await sendLiteral(target, line);
  await sleep(timing.settleMs);
  if (!(await enterIfReady())) return report("dialog opened", line);

  const seen = async () => {
    const now = await matches();
    return now.count > (now.file === before.file ? before.count : 0);
  };
  if (await waitFor(seen, timing.confirmMs, timing.pollMs))
    return { result: "confirmed" };
  if (!(await enterIfReady())) return report("dialog opened", line);
  if (await waitFor(seen, timing.confirmMs, timing.pollMs))
    return { result: "confirmed" };
  return report("not in transcript", line);
}
