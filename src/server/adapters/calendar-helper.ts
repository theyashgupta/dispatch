import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  permissionErrorCode,
  permissionFromStatus,
} from "../../shared/calendar-permission.js";
import type { CalendarErrorCode } from "../../shared/types.js";
import { CalendarReadError } from "../sources/calendar/calendar-events.js";
import { run, sleep } from "./exec.js";

const KILL_ESCALATION_MS = 5_000;
const ANSWER_GRACE_MS = 2_000;
const ANSWER_MAX_BYTES = 16 * 1024 * 1024;
const POLL_MS = 50;
const HELPER_BINARY = path.join("Contents", "MacOS", "DispatchCalendar");
const BUILT_APP = fileURLToPath(
  new URL("../../native/DispatchCalendar.app", import.meta.url),
);

type TimeoutCode = "read-timeout" | "prompt-timeout";

interface HelperAnswer {
  raw: string;
  status: number | null;
  body: Record<string, unknown>;
}

function answerOf(raw: string, parsed: unknown): HelperAnswer {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { raw, status: null, body: {} };
  }
  const body = parsed as Record<string, unknown>;
  const status = body.status;
  const valid =
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 0 &&
    status <= 4;
  return { raw, status: valid ? status : null, body };
}

/**
 * Parse one JSON answer into its raw status and body.
 *
 * @remarks Anything that is not an object, or a status that is not an integer from 0 to 4, gives
 * `status: null`, so a garbled answer never reads as a permission state.
 */
export function parseHelperAnswer(stdout: string): {
  status: number | null;
  body: Record<string, unknown>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { status: null, body: {} };
  }
  const { status, body } = answerOf(stdout, parsed);
  return { status, body };
}

/**
 * The read error code for an answer that is not full access.
 *
 * @remarks A missing or invalid status is `unknown`; status 3 here means the answer carried an error
 * of its own, so it is `failed`.
 */
export function statusErrorCode(status: number | null): CalendarErrorCode {
  const permission = permissionFromStatus(status);
  return permission === "granted" ? "failed" : permissionErrorCode(permission);
}

/**
 * Return the helper app path when its executable exists, else null.
 *
 * @remarks An empty `DISPATCH_CALENDAR_HELPER` counts as unset. A folder without an executable
 * `Contents/MacOS/DispatchCalendar` sends every read down the JXA path, so a half built app never
 * reaches `open`.
 */
export function helperPath(
  override = process.env.DISPATCH_CALENDAR_HELPER,
  built = BUILT_APP,
): string | null {
  const app = override === undefined || override === "" ? built : override;
  try {
    fs.accessSync(path.join(app, HELPER_BINARY), fs.constants.X_OK);
    return app;
  } catch {
    return null;
  }
}

/**
 * Read the answer file once; return it when it is one whole JSON value, else null.
 *
 * @remarks A file over 16 MiB is `failed`, so a runaway helper cannot fill server memory.
 */
function readAnswer(file: string): HelperAnswer | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const size = Math.min(fs.fstatSync(fd).size, ANSWER_MAX_BYTES + 1);
    const buffer = Buffer.alloc(size);
    const read = fs.readSync(fd, buffer, 0, size, 0);
    if (read > ANSWER_MAX_BYTES) throw new CalendarReadError("failed");
    const raw = buffer.toString("utf8", 0, read);
    try {
      return answerOf(raw, JSON.parse(raw));
    } catch {
      return null;
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Wait for the answer file to hold one whole JSON value, or throw `failed` at the deadline.
 *
 * @remarks `open -W` can exit before the helper has written, so only a parsable file counts as the
 * answer; each poll reads and parses the file once.
 */
async function waitForAnswer(
  file: string,
  deadline: number,
): Promise<HelperAnswer> {
  for (;;) {
    const answer = readAnswer(file);
    if (answer !== null) return answer;
    if (Date.now() >= deadline) throw new CalendarReadError("failed");
    await sleep(POLL_MS);
  }
}

/**
 * Run one helper command through Launch Services and return its answer.
 *
 * @remarks `open` makes the helper its own responsible process, which is what gives the Calendar
 * permission its own entry. After `open` exits 0 the answer gets 2 s more. A failed `open` whose
 * stderr says "Unable to block" means the helper had already exited, so its answer file is whole
 * and is read at once; any other failure fails at once.
 */
async function runHelper(
  app: string,
  command: string,
  arg: string | undefined,
  timeoutMs: number,
  timeoutCode: TimeoutCode = "read-timeout",
): Promise<HelperAnswer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-cal-"));
  const out = path.join(dir, "out.json");
  const deadline = Date.now() + timeoutMs;
  try {
    let waitUntil = deadline;
    try {
      await run(
        "open",
        [
          "-n",
          "-W",
          "-g",
          "-a",
          app,
          "--stdout",
          out,
          "--stderr",
          path.join(dir, "err.txt"),
          "--args",
          command,
          ...(arg === undefined ? [] : [arg]),
        ],
        { timeout: timeoutMs, killEscalationMs: KILL_ESCALATION_MS },
      );
      waitUntil = Math.min(deadline, Date.now() + ANSWER_GRACE_MS);
    } catch (err) {
      const failure = err as { killed?: unknown; stderr?: unknown };
      if (failure.killed === true) throw new CalendarReadError(timeoutCode);
      const early =
        typeof failure.stderr !== "string" ||
        !failure.stderr.includes("Unable to block");
      if (early) throw new CalendarReadError("failed");
    }
    return await waitForAnswer(out, waitUntil);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Read the raw EventKit status through the helper, which never requests access.
 *
 * @remarks `status` cannot raise the macOS prompt, so a poll or a page load stays silent.
 */
export async function helperStatus(
  app: string,
  timeoutMs: number,
): Promise<number | null> {
  return (await runHelper(app, "status", undefined, timeoutMs)).status;
}

/**
 * Ask the helper for full Calendar access and return the raw status once answered.
 *
 * @remarks The run timeout is 5 s past the helper's own wait so the helper reports before it is killed.
 */
export async function helperRequest(
  app: string,
  timeoutMs: number,
): Promise<number | null> {
  const answer = await runHelper(
    app,
    "request",
    String(Math.floor(timeoutMs / 1000)),
    timeoutMs + KILL_ESCALATION_MS,
    "prompt-timeout",
  );
  return answer.status;
}

/**
 * Run a helper read and return its raw answer, or throw the code for a status other than full access.
 *
 * @remarks Only status 3 reads, so write-only access is never connected. A `bad-args` answer is `failed`.
 */
export async function helperRead(
  app: string,
  command: string,
  arg: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const answer = await runHelper(app, command, arg, timeoutMs);
  if (answer.status !== 3) {
    throw new CalendarReadError(
      answer.body.error === "bad-args"
        ? "failed"
        : statusErrorCode(answer.status),
    );
  }
  return answer.raw;
}
