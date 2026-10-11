import fsp from "node:fs/promises";
import path from "node:path";

const TAIL_BYTES = 256 * 1024;
const SESSION_ID = /^[\w-]{1,256}$/;

export interface TranscriptEntry {
  id: string;
  at: string | null;
  type: "user" | "assistant";
  text: string;
}

export interface TranscriptConversation {
  entries: TranscriptEntry[];
  truncated: boolean;
}

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
  const dir = path.join(
    input.configDir,
    "projects",
    input.cwd.replace(/[^a-zA-Z0-9]/g, "-"),
  );
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
  uuid: string | null;
  at: string | null;
  hidden: boolean;
}

const SYNTHETIC_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<local-command-",
  "[Request interrupted by user",
];

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

/**
 * Parse one transcript line into a user or assistant text entry.
 *
 * @remarks `hidden` marks the entries Claude Code writes for itself (meta, sidechain, compact
 * summary, slash command echoes, interrupt notes); the conversation skips them, the supervisor
 * samples still count them.
 */
function parseEntry(line: string): ParsedEntry | null {
  let entry: {
    type?: unknown;
    uuid?: unknown;
    timestamp?: unknown;
    isMeta?: unknown;
    isSidechain?: unknown;
    isCompactSummary?: unknown;
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
  return {
    type,
    text,
    uuid: typeof entry?.uuid === "string" ? entry.uuid : null,
    at: typeof entry?.timestamp === "string" ? entry.timestamp : null,
    hidden:
      entry?.isMeta === true ||
      entry?.isSidechain === true ||
      entry?.isCompactSummary === true ||
      SYNTHETIC_PREFIXES.some((prefix) => text.startsWith(prefix)),
  };
}

/**
 * Read the last 256 KiB of a file as whole lines, with the byte offset of the first kept line.
 *
 * @remarks A tail that starts inside the file drops its partial first line. Resolves null when
 * the file cannot be read.
 */
async function readTailLines(
  file: string,
): Promise<{ size: number; start: number; lines: string[] } | null> {
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
    return { size, start: from + skip, lines };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Read the user and assistant text entries of a transcript in order, newest `limit` kept.
 *
 * @remarks
 * Tool calls, tool results, thinking and the entries Claude Code writes for itself carry no
 * conversation text and are skipped, as is a line that does not parse. An entry with no uuid
 * takes its byte offset as its id, so the id stays the same while the tail window moves.
 */
export async function readTranscriptConversation(
  file: string,
  limit: number,
  textMax: number,
): Promise<TranscriptConversation | null> {
  const tail = await readTailLines(file);
  if (tail === null) return null;
  const entries: TranscriptEntry[] = [];
  let offset = tail.start;
  for (const line of tail.lines) {
    const parsed = parseEntry(line);
    if (parsed !== null && !parsed.hidden) {
      entries.push({
        id: parsed.uuid ?? `offset-${offset}`,
        at: parsed.at,
        type: parsed.type,
        text:
          parsed.text.length > textMax
            ? `${parsed.text.slice(0, textMax)}\n[cut at ${textMax} characters]`
            : parsed.text,
      });
    }
    offset += Buffer.byteLength(line) + 1;
  }
  const kept = entries.slice(-limit);
  return {
    entries: kept,
    truncated: tail.start > 0 || kept.length < entries.length,
  };
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
