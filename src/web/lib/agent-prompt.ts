import type { PrDetail } from "../../shared/types.js";
import { fenceUntrusted } from "../../shared/untrusted.js";

export const PROMPT_CONTEXT_MAX = 6000;

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
