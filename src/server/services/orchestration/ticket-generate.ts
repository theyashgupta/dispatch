import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import { hasDispatchMarker } from "../domain/playbooks.js";
import type { DecodedImage } from "../domain/attachments.js";

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
 * Build one stream-json user message carrying the prompt as a text block plus one base64 image block per
 * pasted image, so the zero-tools draft run sees the pixels directly.
 */
export function buildDraftInput(
  prompt: string,
  images: readonly DecodedImage[],
): string {
  const content = [
    { type: "text", text: prompt },
    ...images.map((img) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: `image/${img.ext === "jpg" ? "jpeg" : img.ext}`,
        data: img.bytes.toString("base64"),
      },
    })),
  ];
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

/**
 * Extract the assistant's final text from a stream-json stdout, taken from the `result` event.
 *
 * @remarks Throws when no result event is present so the caller's 502 path handles a truncated run.
 */
export function extractResultText(stdout: string): string {
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: { type?: unknown; result?: unknown };
    try {
      event = JSON.parse(line) as { type?: unknown; result?: unknown };
    } catch {
      continue;
    }
    if (event.type === "result" && typeof event.result === "string") {
      return event.result;
    }
  }
  throw new Error("missing result event in stream-json output");
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
 * — so the route layer can kill the subprocess on client disconnect (modal Cancel).
 * `killEscalationMs` arms `run()`'s SIGTERM→grace→SIGKILL escalation: both the abort and timeout
 * paths kill with a default SIGTERM, and a `claude` that ignores it would pend the promise forever
 * and wedge the route's `draftInFlight` single-flight guard into permanent 409s. The
 * `hasDispatchMarker` check inside {@link parseTicketDraft} is defense-in-depth alongside the
 * accept-time route guard in `cards.route.ts` (POST /cards), which covers a user editing the
 * marker back in during State 3 review. With `images`, the prompt moves off argv into a
 * stream-json stdin message that also carries the image blocks (`--verbose` is mandatory with
 * stream-json output in print mode); the no-image invocation is unchanged.
 */
export async function generateTicketDraft(
  direction: string,
  signal?: AbortSignal,
  images: readonly DecodedImage[] = [],
): Promise<{ title: string; description: string }> {
  const prompt = buildPrompt(direction);
  const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
  const execOpts = {
    cwd: DISPATCH_DIR,
    timeout: 150_000,
    maxBuffer: 10 * 1024 * 1024,
    signal,
    killEscalationMs: 5_000,
  };
  if (images.length > 0) {
    const { stdout } = await run(
      claudePath,
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
      ],
      { ...execOpts, input: buildDraftInput(prompt, images) },
    );
    return parseTicketDraft(extractResultText(stdout));
  }
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
    execOpts,
  );

  return parseTicketDraft(stdout);
}
