import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { MEETINGS_DIR } from "../infra/paths.js";

/**
 * The transcript file of one meeting, named by a hash so no request text ever reaches a path.
 */
export function transcriptPath(meetingId: string): string {
  const name = createHash("sha256").update(meetingId).digest("hex");
  return path.join(MEETINGS_DIR, `${name}.txt`);
}

/**
 * Store a meeting's pasted notes, replacing any earlier copy, readable by the owner only.
 */
export async function writeTranscript(
  meetingId: string,
  text: string,
): Promise<void> {
  await fs.mkdir(MEETINGS_DIR, { recursive: true, mode: 0o700 });
  await fs.chmod(MEETINGS_DIR, 0o700);
  await writeFileAtomic(transcriptPath(meetingId), text, { mode: 0o600 });
}

/**
 * A meeting's stored notes, or null when none were stored.
 */
export async function readTranscript(
  meetingId: string,
): Promise<string | null> {
  try {
    return await fs.readFile(transcriptPath(meetingId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
