import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { DISPATCH_DATA_DIR } from "../store/data-dir.js";

export const USAGE_REQUEST_LOG_PATH = path.join(
  DISPATCH_DATA_DIR,
  "usage-requests.jsonl",
);

const MAX_BYTES = 1_048_576;

export type UsageCaller =
  "poll" | "manual" | "limit-surface" | "fresh-read" | "login";

export interface UsageRequestLine {
  ts: string;
  account: string;
  caller: UsageCaller;
  status: number | "network";
  nextInMs: number;
}

/**
 * Append one usage request as a JSONL line, rotating the file to `<file>.1` before it passes 1 MB.
 *
 * @remarks Every fs error is swallowed so logging can never break a usage read. The line holds the
 * five fields of `UsageRequestLine` only, never a token or a header.
 */
export function appendUsageRequest(
  line: UsageRequestLine,
  file = USAGE_REQUEST_LOG_PATH,
): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const text = JSON.stringify(line) + "\n";
    let size = 0;
    try {
      size = statSync(file).size;
    } catch {}
    if (size + Buffer.byteLength(text) > MAX_BYTES) {
      renameSync(file, `${file}.1`);
    }
    appendFileSync(file, text, { mode: 0o600 });
  } catch {}
}
