const MARKER = /DISPATCH_STATUS:/gi;

/**
 * Wrap provider text in a code fence the text cannot close, with every status marker disarmed.
 *
 * @remarks The kickoff reaches a Claude session whose pane the marker parser reads, so a PR body or an
 * exception message holding "DISPATCH_STATUS:" could fake a status line; the rewrite breaks the
 * token. The fence is one backtick longer than the longest run inside, so the text stays inside it.
 */
export function fenceUntrusted(text: string, cap: number): string {
  let body = text.replace(MARKER, "DISPATCH-STATUS:");
  const chars = Array.from(body);
  if (chars.length > cap) body = `${chars.slice(0, cap).join("")}\n(truncated)`;
  const longest = Math.max(
    0,
    ...Array.from(body.matchAll(/`+/g), (m) => m[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}`;
}

/**
 * Flatten provider text onto one line with every status marker disarmed, for use outside a fence.
 *
 * @remarks A name that holds a newline could otherwise start a fresh line with "DISPATCH_STATUS:",
 * which the marker parser reads as a live status.
 */
export function inlineUntrusted(text: string): string {
  return text
    .replace(/[\s\u0085]+/g, " ")
    .trim()
    .replace(MARKER, "DISPATCH-STATUS:");
}
