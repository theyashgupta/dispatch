import type { Card } from "../../shared/types.js";

/**
 * Describe the workspace layout for any repo count (N ≥ 1): a comma-joined list of `<name>/`
 * folders, phrased so a single repo reads naturally and multiple repos invite Claude to pick.
 */
function workspaceOrientation(repoNames: string[], identifier: string): string {
  const folders = repoNames.map((n) => `${n}/`);
  if (folders.length === 1) {
    return (
      `This folder contains a git worktree for the repo ${folders[0]}, ` +
      `on branch ${identifier}. Work there.`
    );
  }
  const joined =
    folders.slice(0, -1).join(", ") + " and " + folders[folders.length - 1];
  return (
    `This folder contains git worktrees for ${folders.length} repos: ${joined}, ` +
    `each on branch ${identifier}. Decide which repo(s) this ticket touches and work there.`
  );
}

/**
 * Build the multi-line kickoff prompt: ticket line, description, optional extra direction,
 * workspace orientation, and the required Phase-4 status protocol. Pure — joined with "\n".
 *
 * @remarks The two status-protocol lines are byte-identical to `parse.ts` MARKER_RE (NEW-08) and
 * their separator is an em-dash U+2014 whose paste fidelity is verified — do NOT swap it for a
 * hyphen (NEW-07). The wording is a contract between this file and the marker parser.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function buildKickoff(
  card: Card,
  extraDirection: string,
  repoNames: string[],
  opts: { restarted?: boolean } = {},
): string {
  const description = card.description?.trim() || "(no description provided)";
  const extra = extraDirection.trim();
  const url = card.url?.trim();

  return [
    ...(url ? [`Linear ticket: ${url}`, ``] : []),
    `You are working on Linear ticket ${card.identifier}: ${card.title}`,
    ``,
    `## Description`,
    description,
    ...(extra ? [``, `## Extra direction`, extra] : []),
    ...(opts.restarted
      ? [
          ``,
          `## Restarted session`,
          "This session was restarted (the previous one was lost, likely after a reboot). Your prior work may already exist in this workspace — run `git status` first before continuing.",
        ]
      : []),
    ``,
    `## Workspace`,
    workspaceOrientation(repoNames, card.identifier),
    ``,
    `## Status protocol (required)`,
    `Print these as standalone lines, in the exact format shown, as the LAST line of a reply:`,
    `- When blocked and needing human input: AK_STATUS: NEEDS_INPUT — <one-line reason>`,
    `- When the task is complete: AK_STATUS: DONE — <one-line summary>`,
  ].join("\n");
}
