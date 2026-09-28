import type { PrDetail, SentryIssueDetail } from "../../shared/types.js";
import { fenceUntrusted } from "../../shared/untrusted.js";

const MARKER = /DISPATCH_STATUS:/gi;

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

/**
 * The kickoff text for fixing a Sentry error whose context the ticket description carries.
 *
 * @remarks The short id, project and title are provider text outside a fence, so each is flattened
 * to one line, cut to 300 characters and has its status marker disarmed.
 */
export function sentryFixPrompt(
  detail: Pick<SentryIssueDetail, "shortId" | "project" | "title">,
): string {
  const line = (text: string) =>
    text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300)
      .replace(MARKER, "DISPATCH-STATUS:");
  return [
    `Fix the Sentry error ${line(detail.shortId)} in ${line(detail.project)}: ${line(detail.title)}.`,
    "The error context is in the ticket description under Context.",
    "Find the root cause in the code, fix it, and add a test that fails without the fix.",
    "Commit the fix. Do not push, and do not resolve the issue in Sentry; report what you changed.",
  ].join("\n");
}
