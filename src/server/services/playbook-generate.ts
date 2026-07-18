import fsp from "node:fs/promises";
import path from "node:path";
import { run } from "../adapters/exec.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";
import { DISPATCH_DIR } from "./infra/paths.js";
import { isWithinHome } from "./workspaces.js";

const MAX_FILE_BYTES = 100 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_DEPTH = 6;
const SKIP_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build"]);

/**
 * The single typed error for any top-level source path that fails to stat/read. Its message is a
 * fixed constant, NEVER the attempted path — the route maps every instance to a constant 400 body
 * so an arbitrary local filesystem layout is never echoed back to the client.
 */
export class SourceUnreadableError extends Error {}

interface IngestState {
  total: number;
  blocks: string[];
}

/**
 * A file "looks binary" if a null byte appears in its first 8KB — cheap, dependency-free, and
 * sufficient to keep obvious binaries (images, archives) out of a text prompt without a content-type
 * library.
 */
async function looksBinary(filePath: string): Promise<boolean> {
  const handle = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function ingestFile(filePath: string, state: IngestState): Promise<void> {
  if (state.total >= MAX_TOTAL_BYTES) return;
  const stat = await fsp.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
  if (await looksBinary(filePath)) return;

  const content = await fsp.readFile(filePath, "utf8");
  if (state.total + content.length > MAX_TOTAL_BYTES) return;

  state.blocks.push(`===== Source: ${filePath} =====\n${content}\n`);
  state.total += content.length;
}

/**
 * Recursively read a directory's files into `state`, using ONLY `dirent.isFile()`/`isDirectory()`
 * (never following a symlink) so ingestion can never escape the walked tree via a link. Vendor/build
 * dirs and dotfiles are skipped by name; the walk stops the instant the running total would exceed
 * `MAX_TOTAL_BYTES` or `MAX_DEPTH` is exceeded.
 */
async function ingestDir(
  dirPath: string,
  depth: number,
  state: IngestState,
): Promise<void> {
  if (depth > MAX_DEPTH || state.total >= MAX_TOTAL_BYTES) return;

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (state.total >= MAX_TOTAL_BYTES) return;
    if (entry.name.startsWith(".") || SKIP_DIR_NAMES.has(entry.name)) continue;

    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await ingestDir(full, depth + 1, state);
    } else if (entry.isFile()) {
      await ingestFile(full, state);
    }
  }
}

function buildPrompt(direction: string, sources: string): string {
  return `You are writing a "playbook" for Dispatch, a local kanban tool that launches Claude Code agent sessions on tickets. A playbook is a reusable markdown instruction block appended to the agent's kickoff prompt for a ticket.

Output rules — follow exactly:
- Output ONLY the playbook's markdown body. No preamble, no closing remarks, no code fence wrapping the whole output, no YAML front-matter, no "name:" line.
- Start the body with this exact section:

## Extra direction
{extra}

  The literal token {extra} must appear exactly once in your output; Dispatch splices per-ticket direction there.
- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.
- Write imperative, concrete instructions for a coding agent: scope, method, constraints, and explicit stop conditions. Prefer short sections under ## headings. Keep the whole body under roughly 60 lines.

What the user wants this playbook to do:
${direction}

Reference material (context only — extract the method and conventions, do not copy verbatim):
${sources}`;
}

/**
 * Generate a playbook draft via a headless `claude -p` subprocess. Source paths are read server-side
 * into the prompt as plain text (never granted as tool-accessible paths) so the spawn can run with
 * `--tools ""` — zero tool access, which is what lets `-p` skip the interactive trust dialog
 * entirely (verified live on claude 2.1.212) rather than needing `preSeedTrust` plumbing. `cwd` is
 * `DISPATCH_DIR` (an app-owned 0o700 directory) purely as a conservative default; with zero tools the
 * cwd itself grants the subprocess no filesystem reach. The prompt is the ONLY request-derived argv
 * element — every flag is a fixed literal. Every `sourcePath` is confined to the home subtree via
 * {@link isWithinHome} (same realpath+case-fold recipe as `browseDirectory`) before it is ever
 * stat'd, so this is the one content-reading route and the one place that boundary must hold even
 * though every other filesystem reach in the app already goes through the confined folder browser.
 */
export async function generatePlaybookDraft(input: {
  direction: string;
  sourcePaths: string[];
}): Promise<string> {
  const state: IngestState = { total: 0, blocks: [] };

  for (const sourcePath of input.sourcePaths) {
    const absPath = path.resolve(sourcePath);
    if (!(await isWithinHome(absPath))) {
      throw new SourceUnreadableError("source unreadable");
    }
    let stat;
    try {
      stat = await fsp.stat(sourcePath);
    } catch {
      throw new SourceUnreadableError("source unreadable");
    }
    if (stat.isDirectory()) {
      await ingestDir(sourcePath, 0, state);
    } else if (stat.isFile()) {
      await ingestFile(sourcePath, state);
    }
  }

  const sources =
    state.blocks.length > 0 ? state.blocks.join("") : "(none provided)";
  const prompt = buildPrompt(input.direction, sources);

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
    { cwd: DISPATCH_DIR, timeout: 150_000, maxBuffer: 10 * 1024 * 1024 },
  );

  const draft = stdout.trim();
  if (draft === "") {
    throw new Error("empty generation output");
  }
  return draft;
}
