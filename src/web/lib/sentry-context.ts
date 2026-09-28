import type { SentryFrame, SentryIssueDetail } from "../../shared/types.js";
import { fenceUntrusted, PROMPT_CONTEXT_MAX } from "./agent-prompt.js";

const LINE_MAX = 1000;

const clip = (text: string) =>
  text.length > LINE_MAX ? `${text.slice(0, LINE_MAX)}...` : text;

/** One frame as "function (file:line)", with placeholders for the parts Sentry left out. */
export function frameLabel(frame: SentryFrame): string {
  const where = frame.file
    ? frame.line !== null
      ? `${frame.file}:${frame.line}`
      : frame.file
    : "unknown file";
  return `${frame.function ?? "(anonymous)"} (${where})`;
}

/** The source line a frame stopped on, from its context lines, or null. */
function frameCode(frame: SentryFrame): string | null {
  const hit = frame.context.find((c) => c.line === frame.line);
  return hit ? hit.code.trim() : null;
}

/** The exception as "type: value", or the issue title when Sentry sent no exception. */
export function exceptionLine(detail: SentryIssueDetail): string {
  const text = detail.exception
    ? [detail.exception.type, detail.exception.value]
        .filter((part): part is string => part !== null)
        .join(": ")
    : "";
  return text || detail.title;
}

/**
 * Render an issue detail as the fenced plain text a ticket and an agent read.
 *
 * @remarks The order is fixed so the exception and the first in-app frame come first, and every
 * line is cut to 1000 characters, so the 6000 cap always keeps both. Backtick runs shrink to two
 * so the fence stays three backticks and the result always fits the 8000 character promote limit;
 * the fence also disarms any "DISPATCH_STATUS:" marker in the provider text.
 */
export function sentryContext(detail: SentryIssueDetail): string {
  const inApp = detail.frames.filter((f) => f.inApp);
  const other = detail.frames.filter((f) => !f.inApp);
  const lines = [
    clip(exceptionLine(detail)),
    clip(`Culprit: ${detail.culprit}`),
    `Seen ${detail.count} times by ${detail.userCount} users, last ${detail.lastSeen ?? "unknown"}`,
  ];
  if (inApp.length > 0) {
    lines.push("In-app frames (newest first):");
    inApp.forEach((frame, index) => {
      lines.push(clip(`- ${frameLabel(frame)}`));
      const code = index === 0 ? frameCode(frame) : null;
      if (code) lines.push(clip(`    ${code}`));
    });
  }
  if (other.length > 0) {
    lines.push("Other frames:");
    for (const frame of other) lines.push(clip(`- ${frameLabel(frame)}`));
  }
  if (detail.breadcrumbs.length > 0) {
    lines.push("Breadcrumbs (oldest first):");
    for (const b of detail.breadcrumbs) {
      const head = [b.timestamp, b.category, b.level]
        .filter((part): part is string => part !== null)
        .join(" ");
      lines.push(clip(`- ${head}: ${b.message ?? ""}`));
    }
  }
  if (detail.tags.length > 0) {
    lines.push(
      clip(`Tags: ${detail.tags.map((t) => `${t.key}=${t.value}`).join(", ")}`),
    );
  }
  return fenceUntrusted(
    lines.join("\n").replace(/`{3,}/g, "``"),
    PROMPT_CONTEXT_MAX,
  );
}
