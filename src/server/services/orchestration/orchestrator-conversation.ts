import { isDispatchLine } from "../../../shared/dispatch-lines.js";
import { CONVERSATION_TEXT_MAX } from "../../../shared/orchestrator-limits.js";
import type {
  Board,
  ConversationMessage,
  OrchestratorConversation,
} from "../../../shared/types.js";
import {
  readTranscriptConversation,
  type TranscriptEntry,
} from "../../adapters/transcript.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { NotFoundError } from "../domain/errors.js";
import { sessionTranscriptPath } from "./supervisor-transcript.js";

const empty = (
  status: OrchestratorConversation["status"],
): OrchestratorConversation => ({ status, messages: [], truncated: false });

function roleOf(entry: TranscriptEntry): ConversationMessage["role"] {
  if (entry.type === "assistant") return "orchestrator";
  return isDispatchLine(entry.text) ? "system" : "user";
}

/**
 * Read the conversation of one orchestrator from the transcript of its active session.
 *
 * @remarks A user entry is a system message when Dispatch typed it (kickoff, wake, handoff,
 * resume or continue line), so the user sees only their own turns as "You".
 */
export async function readOrchestratorConversation(
  board: Board,
  orchestratorId: string,
  limit: number,
): Promise<OrchestratorConversation> {
  const record = board.orchestrators.find((r) => r.id === orchestratorId);
  if (!record) throw new NotFoundError("unknown-orchestrator");
  const card = record.cardId ? store.getCard(record.cardId) : undefined;
  const session = card?.sessions?.find((s) => s.id === card.activeSessionId);
  if (!card || !session) return empty("no-session");
  const file = await sessionTranscriptPath(card, session);
  if (file === null) return empty("no-transcript");
  const read = await readTranscriptConversation(
    file,
    limit,
    CONVERSATION_TEXT_MAX,
  );
  if (read === null) return empty("unreadable");
  return {
    status: "ok",
    messages: read.entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      role: roleOf(entry),
      text: entry.text,
    })),
    truncated: read.truncated,
  };
}
