import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { DISPATCH_DIR } from "../infra/paths.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9]+-\d+$/;

const SYNC_MCP_TOOLS = [
  "mcp__linear__list_issues",
  "mcp__linear__save_issue",
  "mcp__linear__list_teams",
  "mcp__linear__list_users",
  "mcp__linear__list_issue_statuses",
];

/**
 * Build the Sync-to-Linear prompt. Idempotency comes FIRST (search before any create) so a retry
 * of an ambiguous prior attempt (created-but-unparsed, RESEARCH pitfall 1) can never duplicate the
 * issue; `save_issue` is upsert-shaped (RESEARCH pitfall 2), so the create branch is told explicitly
 * to omit any id. The final line of the created description carries the token — load-bearing, not
 * decorative, since it is the ONLY thing a retry's search can match on.
 */
function buildPrompt(card: {
  id: string;
  title: string;
  description: string | null;
}): string {
  const token = `dispatch-sync:${card.id}`;
  return `You are syncing a local Dispatch kanban ticket out to Linear via the Linear MCP tools. Follow these steps exactly, in order.

Step 1 — idempotency check (do this FIRST, before anything else):
Call mcp__linear__list_issues searching for the exact literal token "${token}". If any returned issue's description contains this token, STOP — do not create anything — and skip straight to Step 4 using that issue's own identifier/url/id and its CURRENT title/description.

Step 2 — gather ids (only if Step 1 found nothing):
Call mcp__linear__list_teams to find the workspace's team. Call mcp__linear__list_issue_statuses to find the unstarted "To Do"-type state for that team. Call mcp__linear__list_users to find the authenticated user (the one whose credentials are running this session).

Step 3 — create the issue (only if Step 1 found nothing):
Call mcp__linear__save_issue to CREATE a new issue. Do NOT pass an id field — passing an id makes this an UPDATE of an existing issue instead of a create, which must never happen here. Set: team to the team found in Step 2; state to the unstarted To Do state found in Step 2; assignee to the user found in Step 2; title to exactly:
${card.title}
description to a well-structured, humanized Linear markdown rewrite of the following local ticket content (rewrite it properly for Linear — do not paste it raw):
${card.description ?? "(no description provided)"}

The description you write MUST end with its own final line containing exactly this literal text and nothing else on that line:
${token}

Step 4 — final output:
After the above steps, output ONE line containing ONLY a strict JSON object with exactly these five string fields and nothing else before or after it, no markdown code fence, no commentary:
{"identifier":"...","url":"...","issueId":"...","title":"...","description":"..."}

Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.`;
}

/**
 * Scan `stdout` for the LAST complete top-level JSON object (bracket-matched from the rightmost
 * `}` backward), so trailing prose after the strict-JSON contract line still resolves correctly —
 * mirrors `parseTicketDraft`'s "undecorated, scratchpad-verifiable" precedent, generalized from a
 * delimited-header scan to a brace-matched one since this contract's payload is JSON, not markdown
 * sections. Returns null when no balanced `{...}` substring parses as a JSON object.
 */
function findLastJsonObject(stdout: string): Record<string, unknown> | null {
  for (let end = stdout.length - 1; end >= 0; end--) {
    if (stdout[end] !== "}") continue;
    let depth = 0;
    for (let start = end; start >= 0; start--) {
      const ch = stdout[start];
      if (ch === "}") {
        depth++;
      } else if (ch === "{") {
        depth--;
        if (depth === 0) {
          const candidate = stdout.slice(start, end + 1);
          try {
            const parsed: unknown = JSON.parse(candidate);
            if (
              parsed !== null &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              return parsed as Record<string, unknown>;
            }
          } catch {}
          break;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a `syncCardToLinear` stdout into the five-field adopted-identity shape. Exported
 * (undecorated by any subprocess spawn) so a scratchpad script can assert its shape/footgun guards
 * without invoking `claude` (the `parseTicketDraft` precedent). Throws a plain `Error` when no JSON
 * object is found, when any of the five fields is not a non-empty string, or when `identifier`
 * fails the exact regex the start route enforces — an adopted identifier that cannot start a
 * session would brick the card.
 */
export function parseSyncResult(stdout: string): {
  identifier: string;
  url: string;
  issueId: string;
  title: string;
  description: string;
} {
  const obj = findLastJsonObject(stdout);
  if (obj === null) {
    throw new Error("no JSON object found in sync output");
  }

  const fields = [
    "identifier",
    "url",
    "issueId",
    "title",
    "description",
  ] as const;
  const out: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`missing or empty field "${field}" in sync output`);
    }
    out[field] = value;
  }

  const identifier = out.identifier!;
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`invalid Linear identifier in sync output: ${identifier}`);
  }

  return {
    identifier,
    url: out.url!,
    issueId: out.issueId!,
    title: out.title!,
    description: out.description!,
  };
}

/**
 * Sync a `source:"local"` card out to Linear via a headless `claude -p` subprocess restricted to
 * the five Linear MCP tools, reusing the USER-SCOPE MCP config already registered for the CLI
 * (never the stored, read-only Linear API key — PUSH-01). Deliberately deviates from
 * `ticket-generate.ts`'s invocation in two ways, both load-bearing: NO `--tools ""` and NO
 * `--strict-mcp-config` — both would sever the user-scope Linear MCP this feature exists to use.
 * NO `AbortSignal` is threaded through (asymmetric with `/cards/draft`'s cancel-on-disconnect):
 * killing this subprocess on client disconnect could orphan a created-but-unadopted Linear issue,
 * so the `timeout` alone bounds the run. `killEscalationMs` still arms the SIGTERM->SIGKILL
 * escalation so a `claude` that ignores the timeout's SIGTERM cannot wedge the route's per-card
 * single-flight guard forever.
 * @remarks `--allowedTools` is passed the five tool names as SEPARATE argv elements (the spike's
 * live-proven single-tool invocation, generalized) rather than one comma-joined string; 62-03's live
 * smoke is the first real proof of the variadic form against the CLI, and is the sanctioned place to
 * flip to a comma-joined single argument if the CLI rejects it.
 */
export async function syncCardToLinear(card: {
  id: string;
  title: string;
  description: string | null;
}): Promise<{
  identifier: string;
  url: string;
  issueId: string;
  title: string;
  description: string;
}> {
  const prompt = buildPrompt(card);
  const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
  const { stdout } = await run(
    claudePath,
    [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--allowedTools",
      ...SYNC_MCP_TOOLS,
      "--no-session-persistence",
    ],
    {
      cwd: DISPATCH_DIR,
      timeout: 150_000,
      maxBuffer: 10 * 1024 * 1024,
      killEscalationMs: 5_000,
    },
  );

  return parseSyncResult(stdout);
}
