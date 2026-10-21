const DONE_MARKER =
  /^\s*(?:⏺\s*)?DISPATCH_STATUS:\s*DONE\b(?:\s*[\u2014\u2013-]\s*.*)?\s*$/;

/**
 * Reports whether a text holds the loop's promise tag for a slug and a DONE marker line.
 *
 * @remarks The promise counts only inside promise tags with the exact slug, because the loop prompt and the ralph-loop Stop hook message also carry the bare phrase. The DONE check mirrors the marker regex of the supervisor state.
 */
export function loopCompletionOf(
  text: string | null | undefined,
  slug: string,
): { promise: boolean; done: boolean } {
  if (text === null || text === undefined || text === "") {
    return { promise: false, done: false };
  }
  const promise =
    slug !== "" &&
    new RegExp(
      `<promise>\\s*RALPH COMPLETE ${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</promise>`,
    ).test(text);
  const done = text.split(/\r?\n/).some((line) => DONE_MARKER.test(line));
  return { promise, done };
}
