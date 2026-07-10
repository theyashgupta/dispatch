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
 * Substitute a playbook body's `{extra}` token with the extra direction, byte-safely: a non-empty
 * direction replaces the token in place; an empty direction DROPS the entire blank-line-delimited
 * block carrying the token and collapses the resulting blank lines. This is what lets code.md's lone
 * `## Extra direction`/`{extra}` block reproduce today's kickoff exactly — present when a direction
 * exists, wholly absent (header included) when it does not (PBK-03). A body missing the token can
 * never swallow a non-empty direction: the legacy `## Extra direction` block is appended after the
 * body instead, so typed direction always reaches the kickoff. The append fires only when the token
 * is absent, so the seeded playbooks (which carry it) keep their byte-exact substitution path.
 */
function substitutePlaybookBody(body: string, direction: string): string {
  const token = "{extra}";
  if (direction) {
    if (!body.includes(token)) {
      const trimmed = body.trimEnd();
      const extraBlock = `## Extra direction\n${direction}`;
      return trimmed ? `${trimmed}\n\n${extraBlock}` : extraBlock;
    }
    return body.split(token).join(direction);
  }
  return body
    .split(/\n\s*\n/)
    .filter((block) => block.trim() !== "" && !block.includes(token))
    .join("\n\n")
    .trim();
}

/**
 * The Phase-4 status-protocol block, the SINGLE source of the marker contract. Its two
 * DISPATCH_STATUS lines are byte-identical to `parse.ts` MARKER_RE (NEW-08) and their separator is
 * an em-dash U+2014 whose paste fidelity is verified — do NOT swap it for a hyphen (NEW-07). Shared
 * by both the saga kickoff and the implementation-handoff follow-up so one definition owns the
 * contract and a playbook body can neither alter nor suppress it.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
const STATUS_PROTOCOL = [
  `## Status protocol (required)`,
  `Print these as standalone lines, in the exact format shown, as the LAST line of a reply:`,
  `- When blocked and needing human input: DISPATCH_STATUS: NEEDS_INPUT — <one-line reason>`,
  `- When the task is complete: DISPATCH_STATUS: DONE — <one-line summary>`,
];

/**
 * Build the multi-line kickoff prompt: ticket line, description, optional extra direction,
 * workspace orientation, and the required Phase-4 status protocol. Pure — joined with "\n".
 *
 * @remarks The two status-protocol lines are byte-identical to `parse.ts` MARKER_RE (NEW-08) and
 * their separator is an em-dash U+2014 whose paste fidelity is verified — do NOT swap it for a
 * hyphen (NEW-07). The wording is a contract between this file and the marker parser. The extra-
 * direction slot is now the ONLY playbook-sourced region; when `opts.playbookBody` is absent the
 * assembler falls back to today's exact `## Extra direction` block so a playbook-less kickoff is
 * unchanged.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function buildKickoff(
  card: Card,
  extraDirection: string,
  repoNames: string[],
  opts: { restarted?: boolean; playbookBody?: string } = {},
): string {
  const description = card.description?.trim() || "(no description provided)";
  const extra = extraDirection.trim();
  const url = card.url?.trim();
  const substituted =
    opts.playbookBody !== undefined
      ? substitutePlaybookBody(opts.playbookBody, extra)
      : null;

  return [
    ...(url ? [`Linear ticket: ${url}`, ``] : []),
    `You are working on Linear ticket ${card.identifier}: ${card.title}`,
    ``,
    `## Description`,
    description,
    ...(substituted !== null
      ? substituted
        ? [``, ...substituted.split("\n")]
        : []
      : extra
        ? [``, `## Extra direction`, extra]
        : []),
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
    ...STATUS_PROTOCOL,
  ].join("\n");
}

/**
 * Assemble the implementation-handoff follow-up pasted into the SAME live session: the substituted
 * playbook body, the fixed approved-plan line, and the shared status-protocol reminder. Unlike
 * buildKickoff it re-emits no ticket header / description / workspace — the live session already
 * carries that context. An undefined body reduces to just the extra direction (or nothing) ahead of
 * the fixed lines; the shared STATUS_PROTOCOL keeps the marker contract byte-identical either way.
 */
export function buildFollowupKickoff(
  playbookBody: string | undefined,
  extraDirection: string,
): string {
  const extra = extraDirection.trim();
  const lead =
    playbookBody !== undefined
      ? substitutePlaybookBody(playbookBody, extra)
      : extra;
  return [
    ...(lead ? [...lead.split("\n"), ``] : []),
    `The approved plan from the planning phase is in this workspace.`,
    ``,
    ...STATUS_PROTOCOL,
  ].join("\n");
}
