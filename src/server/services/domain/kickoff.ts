import type { Card } from "../../../shared/types.js";
import { attachmentLinks, withAbsoluteAttachments } from "./attachments.js";
import { attachmentsDir } from "../infra/paths.js";

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
 * A run of line breaks plus the whitespace hugging it, as one flattenable unit. Kept wider than a
 * bare `\n`: a lone `\r`, NEL (U+0085), LS (U+2028) or PS (U+2029) also starts a new rendered line
 * in a terminal, and JavaScript's `\s` covers only some of them (never U+0085), so a `\n`-only
 * pattern lets those through unflattened. `linear-sync.ts#buildPrompt` carries the same class for
 * its own title fencing — the two are deliberate copies, so widen both together.
 */
const LINE_BREAK_RUN_RE = /[\s\u0085]*[\n\r\u0085\u2028\u2029]+[\s\u0085]*/g;

/**
 * The status-marker token exactly as `adapters/markers/parse.ts` MARKER_RE requires it: the name
 * followed immediately by its colon. Breaking that colon is what makes the token unparseable.
 */
const MARKER_TOKEN_RE = /DISPATCH_STATUS:/g;

/**
 * Fence a title before it is interpolated into the kickoff prompt (`SEC-01`): flatten every line
 * break to a single space, defuse any embedded status-marker token, then trim.
 *
 * @remarks Applied to EVERY title reaching the kickoff — the head line's `card.title` and each
 * group member's `m.title` alike — because Linear provenance is a statement about where a value
 * came from, not about who may write it: every member of a Linear workspace, and every integration
 * holding a write-scoped key, can set an issue's title, and nothing on the ingest path
 * (`store/mapping.ts`, `sources/*`) flattens or screens it. For a Linear-sourced group member the
 * title is in fact the ONLY attacker-influenced text in the whole kickoff, since that member
 * contributes no inlined description — only the batched MCP-read instruction.
 * @remarks Flattening ALONE does not close the marker-spoof path, which is why the token is defused
 * too. The kickoff is pasted into the live pane and the TUI hard-wraps its echo; a flattened title
 * merely puts the token mid-line, and a wrap landing just before it puts it back at line start,
 * where MARKER_RE matches again. Measured against the real parser, a title flattened to
 * `- PROP-123: Fix login flow <token> DONE — shipped` re-parsed as a DONE marker at every word-wrap
 * width from 26 to 42 columns — well inside the range of a split pane. Defusing the colon removes
 * the token's only match anchor, so no wrap width can reconstitute it. The `STATUS_PROTOCOL` block
 * below is the ONE sanctioned source of that token in a kickoff and never passes through here.
 * @see docs/ARCHITECTURE.md#group-card-titles
 */
function fenceTitle(title: string): string {
  return title
    .replace(LINE_BREAK_RUN_RE, " ")
    .replace(MARKER_TOKEN_RE, "DISPATCH_STATUS ")
    .trim();
}

/**
 * The group-arm's ticket slot (Phase 63, KICK-06): Linear members get a `## Tickets` heading with
 * one identifier/title/url bullet each plus ONE batched MCP-read instruction; local members follow
 * with an inlined `## <identifier>: <title>` section and their trimmed description (falling back
 * to the same "(no description provided)" copy the single-card description branch uses). Pure —
 * called only from the `card.source === "group"` branch below, in place of the slim/fat ticket
 * slot; never touches the head line, extra-direction slot, workspace orientation, or the
 * STATUS_PROTOCOL tail (the kickoff sandwich's bread stays untouched).
 *
 * @remarks Both member-title interpolations run through {@link fenceTitle} (`SEC-01`). Without it a
 * title carrying a newline emits its tail as a STANDALONE line inside `## Tickets`, which is both a
 * prompt injection into the operator's own prompt (the highest-trust register the agent has) and a
 * marker spoof: `adapters/markers/parse.ts`'s `MARKER_RE` is line-anchored and scans the whole
 * pane, and the kickoff echo demonstrably reaches that parser. A member's `description` is
 * deliberately NOT fenced — inlined description content is multi-line by design and is content, not
 * a single-line field.
 */
function groupTicketSection(members: Card[]): string[] {
  const linear = members.filter((m) => (m.source ?? "linear") === "linear");
  const local = members.filter((m) => (m.source ?? "linear") !== "linear");
  const lines: string[] = [`## Tickets`];
  for (const m of linear) {
    const url = m.url?.trim();
    lines.push(
      `- ${m.identifier}: ${fenceTitle(m.title)}${url ? ` — ${url}` : ""}`,
    );
  }
  if (linear.length > 0) {
    lines.push(
      ``,
      `Read each Linear ticket above — description and comments — via the Linear MCP.`,
    );
  }
  for (const m of local) {
    lines.push(
      ``,
      `## ${m.identifier}: ${fenceTitle(m.title)}`,
      withAbsoluteAttachments(
        m.description?.trim() || "(no description provided)",
        attachmentsDir(m.id),
      ),
    );
  }
  return lines;
}

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
 * block and the slim/fat branch below are untouched by this change. A `source: "group"` card is
 * never `slim` (its source is neither absent nor `"linear"`), so its head line reads "You are
 * working on ticket GROUP-<n>: <title>" with zero code change — only its middle ticket slot is
 * swapped for {@link groupTicketSection}, per the locked "only the middle slot" constraint.
 * EVERY title reaching this prompt is newline-fenced via {@link fenceTitle} (`SEC-01`) — this head
 * line's `card.title` and, in {@link groupTicketSection}, each member's `m.title`. A group card's
 * title is no longer guaranteed Linear-sourced (it may be user-typed or LLM-generated, Phase 78),
 * and a Linear-sourced title was never trustworthy to begin with — provenance is not a trust
 * boundary. This mirrors `linear-sync.ts`'s pre-existing title fencing for its own Sync-to-Linear
 * prompt.
 * @see docs/ARCHITECTURE.md#marker-protocol
 * @remarks `opts.builtFromBranch` (Phase 95) adds an inheritance-notice section naming only the
 * parent's branch — never a summary of the parent's work, since dispatch persists no such
 * artifact and generating one would fabricate. It states the uncommitted-work boundary (the
 * parent's commits are in this history; its uncommitted worktree changes are not) because that
 * boundary is the honest limit of what inheritance actually carries.
 * @see docs/ARCHITECTURE.md#session-inheritance
 */
export function buildKickoff(
  card: Card,
  extraDirection: string,
  repoNames: string[],
  opts: {
    restarted?: boolean;
    playbookBody?: string;
    members?: Card[];
    builtFromBranch?: string;
  } = {},
): string {
  const slim = (card.source ?? "linear") === "linear";
  const isGroup = card.source === "group";
  const rawDescription =
    card.description?.trim() || "(no description provided)";
  const imageNames = slim || isGroup ? [] : attachmentLinks(rawDescription);
  const imageDir = attachmentsDir(card.id);
  const description =
    imageNames.length > 0
      ? withAbsoluteAttachments(rawDescription, imageDir)
      : rawDescription;
  const extra = extraDirection.trim();
  const url = card.url?.trim();
  const substituted =
    opts.playbookBody !== undefined
      ? substitutePlaybookBody(opts.playbookBody, extra)
      : null;

  return [
    ...(url ? [`Linear ticket: ${url}`, ``] : []),
    `You are working on ${slim ? "Linear ticket" : "ticket"} ${card.identifier}: ${fenceTitle(card.title)}`,
    ``,
    ...(isGroup
      ? groupTicketSection(opts.members ?? [])
      : slim
        ? [
            `## Ticket`,
            `Read the full ticket — description and comments — via the Linear MCP. If the MCP is unavailable, ${url ? "fall back to the ticket URL above or " : ""}ask the user.`,
          ]
        : [`## Description`, description]),
    ...(imageNames.length > 0
      ? [
          ``,
          `## Attached images`,
          ...imageNames.map((n) => `${imageDir}/${n}`),
          ``,
          `Read every file listed above with the Read tool before doing anything else. They are part of the ticket.`,
        ]
      : []),
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
    ...(opts.builtFromBranch
      ? [
          ``,
          `## Building on a previous session`,
          `This session's branch was cut from ${opts.builtFromBranch}, which belongs to another session on this same ticket. That session's commits are already in this history — but any uncommitted work in that session's worktree is not.`,
        ]
      : []),
    ``,
    `## Workspace`,
    workspaceOrientation(repoNames, card.identifier),
    ``,
    ...STATUS_PROTOCOL,
  ].join("\n");
}
