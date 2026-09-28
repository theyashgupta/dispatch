import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";
import { DISPATCH_DIR } from "../infra/paths.js";
import {
  buildPastePrompt,
  parseActionItems,
  type ActionDraft,
} from "../domain/meeting-actions.js";

export interface MeetingDraftInput {
  meeting: string;
  notes: string;
  me?: string;
}

/**
 * Draft the user's action items from pasted meeting notes through one headless `claude -p` run.
 *
 * @remarks The prompt goes on stdin, never argv, because up to 100000 characters of notes would
 * otherwise be visible in the process list. A paste is one meeting, so any meeting, date or link
 * line the model echoes is dropped and each key appears once.
 */
export async function generateMeetingDrafts(
  input: MeetingDraftInput,
  signal?: AbortSignal,
): Promise<ActionDraft[]> {
  const claudePath = (await resolveBinaryPath("claude")) ?? "claude";
  const { stdout } = await run(
    claudePath,
    [
      "-p",
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
      killEscalationMs: 5_000,
      input: buildPastePrompt(input.meeting, input.notes, input.me),
    },
  );
  const drafts: ActionDraft[] = [];
  for (const { key, title, description } of parseActionItems(stdout)) {
    if (!drafts.some((draft) => draft.key === key)) {
      drafts.push({ key, title, description });
    }
  }
  return drafts;
}
