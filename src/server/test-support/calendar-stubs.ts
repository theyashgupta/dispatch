import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SCRIPT_MARKER } from "../adapters/calendar-mac.js";
import { CalendarReadError } from "../sources/calendar/calendar-events.js";
import type { IsolatedEnv } from "./fixtures.js";

export const FROM = new Date("2026-11-02T00:00:00.000Z");
export const TO = new Date("2026-11-04T00:00:00.000Z");

const OPEN_STUB = [
  "#!/bin/sh",
  'printf "%s\\n" "$@" > "$STUB_DIR/open-argv.txt"',
  'out=""; cmd=""; seen=""',
  "while [ $# -gt 0 ]; do",
  '  if [ "$1" = "--stdout" ]; then out="$2"; fi',
  '  if [ -n "$seen" ] && [ -z "$cmd" ]; then cmd="$1"; fi',
  '  if [ "$1" = "--args" ]; then seen=1; fi',
  "  shift",
  "done",
  'echo "$cmd" >> "$STUB_DIR/open-calls.log"',
  'if [ -f "$STUB_DIR/open-delay-$cmd" ]; then sleep "$(cat "$STUB_DIR/open-delay-$cmd")"; fi',
  'case "$(cat "$STUB_DIR/open-mode" 2>/dev/null)" in',
  "  slow) exec sleep 60 ;;",
  `  early-exit) printf '{"status":3}\\n' > "$out"; echo "Unable to block on application" >&2; exit 1 ;;`,
  "  no-answer) exit 0 ;;",
  '  fail) echo "boom" >&2; exit 1 ;;',
  "esac",
  'if [ -f "$STUB_DIR/open-reply-$cmd.json" ]; then cat "$STUB_DIR/open-reply-$cmd.json" > "$out"',
  'elif [ -f "$STUB_DIR/open-reply.json" ]; then cat "$STUB_DIR/open-reply.json" > "$out"',
  `else printf '{"status":3}' > "$out"; fi`,
].join("\n");

function osascriptStub(): string {
  const kind = (name: string): string =>
    `  *'"${SCRIPT_MARKER}${name}"'*) kind=${name} ;;`;
  return [
    "#!/bin/sh",
    'printf "%s\\n" "$@" > "$STUB_DIR/osa-argv.txt"',
    "script=$(cat)",
    'printf %s "$script" > "$STUB_DIR/osa-stdin.txt"',
    "kind=other",
    'case "$script" in',
    kind("status"),
    kind("request"),
    kind("calendars"),
    kind("events"),
    "esac",
    'echo "$kind" >> "$STUB_DIR/osa-calls.log"',
    'if [ -f "$STUB_DIR/osa-delay-$kind" ]; then sleep "$(cat "$STUB_DIR/osa-delay-$kind")"; fi',
    'case "$(cat "$STUB_DIR/osa-mode" 2>/dev/null)" in',
    '  stderr) echo "execution error: Not authorized to send Apple events to Calendar. (-1743)" >&2; exit 1 ;;',
    "  slow) exec sleep 60 ;;",
    '  garbage) echo "osascript: something odd"; exit 0 ;;',
    "esac",
    'status=$(cat "$STUB_DIR/osa-status" 2>/dev/null || echo 3)',
    'if [ "$kind" = request ]; then',
    '  status=$(cat "$STUB_DIR/osa-request-result" 2>/dev/null || echo 3)',
    '  echo "$status" > "$STUB_DIR/osa-status"',
    "fi",
    'if [ -f "$STUB_DIR/osa-reply-$kind.json" ]; then cat "$STUB_DIR/osa-reply-$kind.json"; exit 0; fi',
    'case "$kind" in',
    `  status|request) printf '{"status":%s}' "$status" ;;`,
    "  *)",
    '    if [ "$status" != 3 ]; then printf \'{"error":"calendar-denied","status":%s}\' "$status"',
    `    elif [ "$kind" = events ]; then printf '{"events":[],"partial":false}'`,
    `    else printf '{"calendars":[]}'; fi ;;`,
    "esac",
  ].join("\n");
}

export interface CalendarStubs {
  stubDir: string;
  fakeApp: string;
  missingApp: string;
  useHelper: () => void;
  useScripts: () => void;
  helperReply: (body: unknown, command?: string) => void;
  helperMode: (mode: string) => void;
  helperDelay: (command: string, seconds: number) => void;
  osaReply: (kind: string, body: unknown) => void;
  osaMode: (mode: string) => void;
  osaStatus: (status: number) => void;
  osaRequestResult: (status: number) => void;
  osaDelay: (kind: string, seconds: number) => void;
  calls: (tool: "open" | "osa", kind?: string) => number;
  openArgv: () => string[];
  osaArgv: () => string[];
  osaStdin: () => string;
  reset: () => void;
}

/**
 * Install the `open` and `osascript` stubs the calendar tests share and return their controls.
 *
 * @remarks The osascript stub tells a script apart by the `SCRIPT_MARKER` line the adapter puts at
 * the top of each script, never by script text. The fake helper app holds an executable at
 * `Contents/MacOS/DispatchCalendar`, the file `helperPath` checks.
 */
export function installCalendarStubs(env: IsolatedEnv): CalendarStubs {
  const stubDir = path.join(env.root, "calendar-stubs");
  fs.mkdirSync(stubDir);
  process.env.STUB_DIR = stubDir;
  fs.writeFileSync(path.join(env.binDir, "open"), OPEN_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(env.binDir, "osascript"), osascriptStub(), {
    mode: 0o755,
  });
  const fakeApp = path.join(env.root, "Fake.app");
  const binary = path.join(fakeApp, "Contents", "MacOS", "DispatchCalendar");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, "#!/bin/sh\n", { mode: 0o755 });
  const missingApp = path.join(env.root, "Missing.app");

  const file = (name: string): string => path.join(stubDir, name);
  const write = (name: string, value: string | number): void =>
    fs.writeFileSync(file(name), String(value));
  const json = (body: unknown): string =>
    typeof body === "string" ? body : JSON.stringify(body);
  const lines = (name: string): string[] =>
    fs.existsSync(file(name))
      ? fs.readFileSync(file(name), "utf8").trimEnd().split("\n")
      : [];

  return {
    stubDir,
    fakeApp,
    missingApp,
    useHelper: () => {
      process.env.DISPATCH_CALENDAR_HELPER = fakeApp;
    },
    useScripts: () => {
      process.env.DISPATCH_CALENDAR_HELPER = missingApp;
    },
    helperReply: (body, command) =>
      write(
        command === undefined
          ? "open-reply.json"
          : `open-reply-${command}.json`,
        json(body),
      ),
    helperMode: (mode) => write("open-mode", mode),
    helperDelay: (command, seconds) => write(`open-delay-${command}`, seconds),
    osaReply: (kind, body) => write(`osa-reply-${kind}.json`, json(body)),
    osaMode: (mode) => write("osa-mode", mode),
    osaStatus: (status) => write("osa-status", status),
    osaRequestResult: (status) => write("osa-request-result", status),
    osaDelay: (kind, seconds) => write(`osa-delay-${kind}`, seconds),
    calls: (tool, kind) =>
      lines(`${tool}-calls.log`).filter(
        (line) => line !== "" && (kind === undefined || line === kind),
      ).length,
    openArgv: () => lines("open-argv.txt"),
    osaArgv: () => lines("osa-argv.txt"),
    osaStdin: () => fs.readFileSync(file("osa-stdin.txt"), "utf8"),
    reset: () => {
      for (const name of fs.readdirSync(stubDir)) {
        fs.rmSync(file(name), { force: true });
      }
    },
  };
}

/** The `CalendarReadError` code a promise rejects with, or `resolved` when it does not reject. */
export async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "resolved";
  } catch (err) {
    assert.ok(err instanceof CalendarReadError);
    return err.message;
  }
}
