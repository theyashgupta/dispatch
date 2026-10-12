import type { ResumeTarget } from "../../../../shared/types.js";

export const RESUME_TARGET_LOADING = "Checking the conversation";
export const RESUME_TARGET_ERROR = "Could not read the conversation folder.";

const ID_LENGTH = 8;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Format how long ago a conversation started.
 *
 * @remarks
 * A future timestamp (clock skew) reads as "just now", and a timestamp that does not parse reads as
 * an empty string.
 */
export function formatStartedAgo(iso: string, now: number): string {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return "";
  const elapsed = Math.max(0, now - started);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < 2 * DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `${Math.floor(elapsed / DAY_MS)} days ago`;
}

export interface ResumeLine {
  text: string;
  tooltip?: string;
}

/** Build the line shown beside Resume, with a tooltip when the stored conversation was replaced. */
export function resumeLine(target: ResumeTarget, now: number): ResumeLine {
  const age =
    target.mode === "resume" ? formatStartedAgo(target.startedAt, now) : "";
  const text =
    target.mode === "continue"
      ? "Resume: newest conversation in the workspace"
      : `Resume: ${target.sessionId.slice(0, ID_LENGTH)}${age && `, started ${age}`}`;
  const { replaced } = target;
  if (replaced == null) return { text };
  const stored = replaced.storedId.slice(0, ID_LENGTH);
  return {
    text,
    tooltip:
      replaced.reason === "newer-on-disk"
        ? `Stored conversation ${stored} replaced: a newer conversation is on disk.`
        : `Stored conversation ${stored} has no file on disk, so Resume continues the newest conversation.`,
  };
}
