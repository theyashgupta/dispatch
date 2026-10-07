import fsp from "node:fs/promises";
import path from "node:path";

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

function entryText(
  line: string,
): { type: "user" | "assistant"; text: string } | null {
  let entry: { type?: unknown; message?: { content?: unknown } } | null;
  try {
    entry = JSON.parse(line) as typeof entry;
  } catch {
    return null;
  }
  const type = entry?.type;
  if (type !== "assistant" && type !== "user") return null;
  const text = contentText(entry?.message?.content);
  return text === null ? null : { type, text };
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

/**
 * Read the size of a transcript, the text of its last assistant message and its user texts.
 *
 * @remarks Reads the last 256 KiB only, so a long transcript costs one bounded read per sample.
 * Resolves null when the file cannot be read.
 */
export async function readTranscriptTail(
  file: string,
): Promise<TranscriptTail | null> {
  let handle: fsp.FileHandle;
  try {
    handle = await fsp.open(file, "r");
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    let lastAssistantText: string | null = null;
    const userTexts: string[] = [];
    for (const line of lines) {
      const entry = entryText(line);
      if (entry?.type === "assistant") lastAssistantText = entry.text;
      else if (entry?.type === "user") userTexts.push(entry.text);
    }
    return { size, lastAssistantText, userTexts };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
