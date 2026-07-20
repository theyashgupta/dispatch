import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import { hasDispatchMarker } from "../domain/playbooks.js";

const TITLE_HEADER = "## Title";
const DESCRIPTION_HEADER = "## Description";

function buildPrompt(direction: string): string {
  return `You are drafting a ticket for Dispatch, a local kanban tool. Turn the user's freeform direction into a concise title and a well-structured markdown description for a coding ticket.

Output rules — follow exactly:
- Output ONLY two markdown sections, in this exact order, with no preamble, no closing remarks, and no code fence wrapping the whole output.
- Start with the exact literal header line:

${TITLE_HEADER}
<one concise plain-text line: no markdown, no trailing period>

- Then the exact literal header line:

${DESCRIPTION_HEADER}
<a well-structured markdown ticket description covering what/why, concrete scope, and acceptance notes>

- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.

What the user wants this ticket to capture:
${direction}`;
}

/**
 * Parse a `generateTicketDraft` stdout into `{ title, description }`. Exported (undecorated by any
 * subprocess spawn) so a scratchpad/verify script can assert its shape/footgun guards without
 * invoking `claude`. Splits on the first anchored, case-sensitive occurrence of each header (Title
 * before Description), trims both sections, and throws a plain `Error` — the caller maps every
 * throw to the same 502 `generate-failed` surface `playbooks.route.ts` already uses — when either
 * header is missing, either section is empty after trim, or either field carries the
 * `DISPATCH_STATUS:` marker (the parse-time half of the footgun defense; the accept-time route
 * guard in `cards.route.ts` is the other half, covering a user's State-3 edit).
 */
export function parseTicketDraft(stdout: string): {
  title: string;
  description: string;
} {
  const titleIdx = stdout.indexOf(TITLE_HEADER);
  if (titleIdx === -1) {
    throw new Error("missing ## Title header in generation output");
  }
  const descIdx = stdout.indexOf(
    DESCRIPTION_HEADER,
    titleIdx + TITLE_HEADER.length,
  );
  if (descIdx === -1) {
    throw new Error("missing ## Description header in generation output");
  }

  const title = stdout
    .slice(titleIdx + TITLE_HEADER.length, descIdx)
    .trim()
    .split("\n")[0]
    .trim();
  const description = stdout.slice(descIdx + DESCRIPTION_HEADER.length).trim();

  if (title === "" || description === "") {
    throw new Error("empty title or description in generation output");
  }
  if (hasDispatchMarker(title) || hasDispatchMarker(description)) {
    throw new Error("generated content contains the DISPATCH_STATUS marker");
  }

  return { title, description };
}

/**
 * Generate a ticket draft (title + description) via a headless `claude -p` subprocess, mirroring
 * `playbook-generate.ts`'s invocation contract EXACTLY (same binary resolution, `--tools ""` —
 * which is what lets `-p` skip the interactive trust dialog entirely, verified live on claude
 * 2.1.212, rather than needing `preSeedTrust` plumbing — `--strict-mcp-config`,
 * `--no-session-persistence`, 150s timeout, 10MB maxBuffer, `cwd: DISPATCH_DIR`). The prompt is the
 * ONLY request-derived argv element; every flag is a fixed literal. Output uses delimited markdown
 * sections (`## Title` / `## Description`) rather than JSON: a raw two-field JSON object risks
 * escaping fragility on markdown content (backticks/quotes/backslashes), the same failure-flakiness
 * hazard a strict format-contract prompt (mirroring the existing playbook-body register) avoids.
 * `signal` (optional) threads an `AbortSignal` through to `execFile` via `run()`'s opts spread —
 * `run()` needed no body change for this, since Node's `execFile` already honors `signal` natively
 * — so the route layer can kill the subprocess on client disconnect (modal Cancel). The
 * `hasDispatchMarker` check inside {@link parseTicketDraft} is defense-in-depth alongside the
 * accept-time route guard in `cards.route.ts` (POST /cards), which covers a user editing the
 * marker back in during State 3 review.
 */
export async function generateTicketDraft(
  direction: string,
  signal?: AbortSignal,
): Promise<{ title: string; description: string }> {
  const prompt = buildPrompt(direction);
  const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
  const { stdout } = await run(
    claudePath,
    [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
    ],
    {
      cwd: DISPATCH_DIR,
      timeout: 150_000,
      maxBuffer: 10 * 1024 * 1024,
      signal,
    },
  );

  return parseTicketDraft(stdout);
}
