import type { LoopProgress } from "../../../shared/types.js";
import { isPrdModel } from "./prd-progress.js";

export const DONE_MARKER =
  /^\s*(?:⏺\s*)?DISPATCH_STATUS:\s*DONE\b(?:\s*[\u2014\u2013-]\s*.*)?\s*$/;

/**
 * Reports whether a line is the loop's promise tag for a slug, alone on the line.
 *
 * @remarks The whole trimmed line must be the tag, after an optional leading `⏺`, so a tag quoted in prose, a diff line or another loop's slug never counts.
 */
export function isPromiseLine(line: string, slug: string): boolean {
  if (slug === "") return false;
  return new RegExp(
    `^(?:⏺\\s*)?<promise>\\s*(?:RALPH|ROADMAP) COMPLETE ${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</promise>$`,
  ).test(line.trim());
}

/**
 * Reports whether a text holds the loop's promise line for a slug and a DONE marker line.
 *
 * @remarks The promise counts only when a whole line is the promise tag with the exact slug, because the loop prompt and the ralph-loop Stop hook message also carry the bare phrase.
 */
export function loopCompletionOf(
  text: string | null | undefined,
  slug: string,
): { promise: boolean; done: boolean } {
  if (!text) {
    return { promise: false, done: false };
  }
  const lines = text.split(/\r?\n/);
  return {
    promise: lines.some((line) => isPromiseLine(line, slug)),
    done: lines.some((line) => DONE_MARKER.test(line)),
  };
}

/**
 * Reports whether the promise alone completes a single PRD loop whose engine is open.
 *
 * @remarks The promise decides only when the loop prompt names no PRD and no phases were read. When a PRD path is known or phases are read, they decide.
 */
export function promiseCompletes(
  progress: LoopProgress | undefined,
  engineOpen: boolean,
  lastAssistantText: string | null | undefined,
): boolean {
  return (
    engineOpen &&
    progress !== undefined &&
    isPrdModel(progress) &&
    progress.prdFile === undefined &&
    progress.units[0]?.phaseTotal == null &&
    loopCompletionOf(lastAssistantText, progress.slug).promise
  );
}
