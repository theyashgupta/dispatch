import fsp from "node:fs/promises";
import path from "node:path";
import { CLAUDE_SESSION_ID } from "../../shared/claude-session-id.js";

const TAIL_BYTES = 256 * 1024;
const SESSION_ID = /^[\w-]{1,256}$/;

export interface TranscriptTail {
  size: number;
  lastAssistantText: string | null;
  userTexts: string[];
}

/**
 * Accept a hook-reported transcript path only when it is an absolute, normalized `.jsonl` file
 * two levels under a `projects` folder, the layout Claude Code writes.
 */
export function isTranscriptPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    path.isAbsolute(value) &&
    path.normalize(value) === value &&
    value.endsWith(".jsonl") &&
    path.basename(path.dirname(path.dirname(value))) === "projects"
  );
}

const isFile = (file: string) =>
  fsp.stat(file).then(
    (s) => s.isFile(),
    () => false,
  );

/** The most recently modified `.jsonl` file in a folder, or null when there is none. */
export async function newestJsonl(dir: string): Promise<string | null> {
  const names = await fsp.readdir(dir).catch(() => []);
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    try {
      const stat = await fsp.stat(file);
      if (stat.isFile() && (best === null || stat.mtimeMs > best.mtime))
        best = { file, mtime: stat.mtimeMs };
    } catch {}
  }
  return best?.file ?? null;
}

/** The folder Claude Code keeps the conversation files of one working directory in. */
export function projectsDirOf(configDir: string, cwd: string): string {
  return path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

/**
 * List the conversations in a project folder: the top level `.jsonl` files, each with the time
 * its file was born.
 *
 * @remarks
 * The birth time stands for the start of a conversation because a resumed conversation keeps its
 * file and only moves its modified time. A file system with no birth time reports 0, and the
 * modified time is used instead. Top level `agent-*.jsonl` files are Claude subagent transcripts and
 * are left out because `--resume` refuses them.
 */
export async function listConversations(
  dir: string,
): Promise<{ id: string; bornAtMs: number }[]> {
  const names = await fsp.readdir(dir).catch(() => []);
  const found = await Promise.all(
    names
      .filter(
        (name) =>
          name.endsWith(".jsonl") &&
          !name.startsWith("agent-") &&
          CLAUDE_SESSION_ID.test(name.slice(0, -".jsonl".length)),
      )
      .map(async (name) => {
        try {
          const stat = await fsp.stat(path.join(dir, name));
          return stat.isFile()
            ? {
                id: name.slice(0, -".jsonl".length),
                bornAtMs:
                  stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs,
              }
            : undefined;
        } catch {
          return undefined;
        }
      }),
  );
  return found.filter((entry) => entry !== undefined);
}

/**
 * Find the transcript file of one session: the stored hook path, else the file named by the
 * Claude session id in the project folder of `cwd`, else the newest `.jsonl` in that folder.
 */
export async function resolveTranscriptPath(input: {
  stored?: string;
  configDir: string;
  cwd: string;
  claudeSessionId?: string;
}): Promise<string | null> {
  if (input.stored !== undefined && (await isFile(input.stored)))
    return input.stored;
  const dir = projectsDirOf(input.configDir, input.cwd);
  const sid = input.claudeSessionId;
  if (sid !== undefined && SESSION_ID.test(sid)) {
    const named = path.join(dir, `${sid}.jsonl`);
    if (await isFile(named)) return named;
  }
  return newestJsonl(dir);
}

interface ParsedEntry {
  type: "user" | "assistant";
  text: string;
}

function contentText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const part of content as { type?: unknown; text?: unknown }[]) {
    if (part?.type === "text" && typeof part.text === "string")
      texts.push(part.text);
  }
  return texts.length > 0 ? texts.join("\n") : null;
}

/** Parse one transcript line into a user or assistant text entry. */
function parseEntry(line: string): ParsedEntry | null {
  let entry: {
    type?: unknown;
    message?: { content?: unknown };
  } | null;
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return null;
  }
  const type = entry?.type;
  if (type !== "assistant" && type !== "user") return null;
  const text = contentText(entry?.message?.content);
  if (text === null) return null;
  return { type, text };
}

/**
 * Read the last 256 KiB of a file as whole lines.
 *
 * @remarks A tail that starts inside the file drops its partial first line. Resolves null when
 * the file cannot be read.
 */
async function readTailLines(
  file: string,
): Promise<{ size: number; lines: string[] } | null> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const from = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - from);
    await handle.read(buffer, 0, buffer.length, from);
    const skip = from > 0 ? buffer.indexOf(10) + 1 : 0;
    const lines = buffer.subarray(skip).toString("utf8").split("\n");
    return { size, lines };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Read the size of a transcript, the text of its last assistant message and its user texts.
 *
 * @remarks Reads the last 256 KiB only, so a long transcript costs one bounded read per sample.
 * Resolves null when the file cannot be read.
 */
export async function readTranscriptTail(
  file: string,
): Promise<TranscriptTail | null> {
  const tail = await readTailLines(file);
  if (tail === null) return null;
  let lastAssistantText: string | null = null;
  const userTexts: string[] = [];
  for (const line of tail.lines) {
    const entry = parseEntry(line);
    if (entry?.type === "assistant") lastAssistantText = entry.text;
    else if (entry?.type === "user") userTexts.push(entry.text);
  }
  return { size: tail.size, lastAssistantText, userTexts };
}
