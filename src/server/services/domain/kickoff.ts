import type { Card } from "../../../shared/types.js";

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
 *
 * @remarks The fourth line (HOOK-03) is prompt-engineering only, not a structural guarantee — a
 * tool call needs no preceding assistant text, so an agent may still invoke a pausing tool directly.
 * It is deliberately paired with the permanent PreToolUse/AskUserQuestion registration in
 * `hook-setup.ts` and its `hook-events.ts` marker-synthesis branch, which catch the pause
 * structurally regardless of whether this line is followed.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
const STATUS_PROTOCOL = [
  `## Status protocol (required)`,
  `Print these as standalone lines, in the exact format shown, as the LAST line of a reply:`,
  `- When blocked and needing human input: DISPATCH_STATUS: NEEDS_INPUT — <one-line reason>`,
  `- When the task is complete: DISPATCH_STATUS: DONE — <one-line summary>`,
  `- Before calling a tool that pauses for the user (AskUserQuestion, ExitPlanMode, or any action needing approval), print the NEEDS_INPUT line above as your entire reply first, then call the tool.`,
];

/**
 * Build the multi-line kickoff prompt: ticket line, a slim MCP-read ticket slot for
 * Linear-sourced cards (or an inline description block for any other source), optional
 * extra direction, workspace orientation, and the required Phase-4 status protocol. Pure —
 * joined with "\n".
 *
 * @remarks The two status-protocol lines are byte-identical to `parse.ts` MARKER_RE (NEW-08) and
 * their separator is an em-dash U+2014 whose paste fidelity is verified — do NOT swap it for a
 * hyphen (NEW-07). The wording is a contract between this file and the marker parser. The extra-
 * direction slot is now the ONLY playbook-sourced region; when `opts.playbookBody` is absent the
 * assembler falls back to today's exact `## Extra direction` block so a playbook-less kickoff is
 * unchanged. The slim-vs-description branch keys off `card.source ?? "linear"` (the absent-is-
 * linear convention documented on `Card.source`): Linear-sourced cards get the MCP-read ticket
 * slot, every other source keeps the inline description path byte-identical to before, so
 * Phase 61 local cards and Phase 63 group-member inlining fall to it unchanged. The opening
 * sentence's head wording reuses the SAME `slim` flag (Phase 61, Pitfall 2 fix): Linear-sourced
 * cards keep the byte-identical "You are working on Linear ticket …" head, every other source
 * reads the source-generic "You are working on ticket …" — cosmetic only, the status-protocol
 * block and the slim/fat branch below are untouched by this change.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function buildKickoff(
  card: Card,
  extraDirection: string,
  repoNames: string[],
  opts: { restarted?: boolean; playbookBody?: string } = {},
): string {
  const slim = (card.source ?? "linear") === "linear";
  const description = card.description?.trim() || "(no description provided)";
  const extra = extraDirection.trim();
  const url = card.url?.trim();
  const substituted =
    opts.playbookBody !== undefined
      ? substitutePlaybookBody(opts.playbookBody, extra)
      : null;

  return [
    ...(url ? [`Linear ticket: ${url}`, ``] : []),
    `You are working on ${slim ? "Linear ticket" : "ticket"} ${card.identifier}: ${card.title}`,
    ``,
    ...(slim
      ? [
          `## Ticket`,
          `Read the full ticket — description and comments — via the Linear MCP. If the MCP is unavailable, ${url ? "fall back to the ticket URL above or " : ""}ask the user.`,
        ]
      : [`## Description`, description]),
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
