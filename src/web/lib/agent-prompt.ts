import type { PrDetail } from "../../shared/types.js";

export const PROMPT_CONTEXT_MAX = 6000;

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
  if (body.length > cap) body = `${body.slice(0, cap)}\n(truncated)`;
  const longest = Math.max(
    0,
    ...Array.from(body.matchAll(/`+/g), (m) => m[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}\n${body}\n${fence}`;
}

/** The kickoff text for an adversarial review that posts nothing. */
export function reviewPrompt(
  detail: PrDetail,
  repo: string,
  number: number,
): string {
  return [
    `Review pull request ${detail.url} (${repo}#${number}, ${detail.head} into ${detail.base}).`,
    `Check it out in this workspace with: gh pr checkout ${number}`,
    "Assume defects exist. Verify each finding against the code before you report it. Rank the findings by severity.",
    "Post nothing: no review, no comment, no push. Report the findings here.",
    "PR description:",
    fenceUntrusted(detail.body || "(no description)", PROMPT_CONTEXT_MAX),
  ].join("\n");
}

/** The kickoff text for fixing the failing CI checks of a pull request. */
export function fixCiPrompt(
  detail: PrDetail,
  repo: string,
  number: number,
): string {
  const failing = detail.checks.filter((c) => c.state === "fail");
  const lines = failing.map((c) =>
    c.url ? `- ${c.name}: ${c.url}` : `- ${c.name}`,
  );
  return [
    `Fix the failing CI checks on pull request ${detail.url} (${repo}#${number}, branch ${detail.head}).`,
    `Check it out in this workspace with: gh pr checkout ${number}`,
    "Failing checks:",
    fenceUntrusted(lines.join("\n"), PROMPT_CONTEXT_MAX),
    "Reproduce each failure locally, fix the cause and commit. Do not push; report what you changed.",
  ].join("\n");
}
