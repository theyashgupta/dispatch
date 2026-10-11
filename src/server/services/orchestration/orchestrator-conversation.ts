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

function roleOf(
  entry: TranscriptEntry,
  kickoff: boolean,
): ConversationMessage["role"] {
  if (entry.type === "assistant") return "orchestrator";
  return kickoff || isDispatchLine(entry.text) ? "system" : "user";
}

/**
 * Read the conversation of one orchestrator from the transcript of its active session.
 *
 * @remarks
 * Dispatch types the first prompt of every orchestrator transcript (the kickoff, or the resume
 * prompt after a handoff), so the first user entry is a system message when the read starts at
 * the beginning of the file. A wake or handoff line is a system message wherever it sits.
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
  const firstUser = read.fromStart
    ? read.entries.findIndex((e) => e.type === "user")
    : -1;
  return {
    status: "ok",
    messages: read.entries.map((entry, index) => ({
      id: entry.id,
      at: entry.at,
      role: roleOf(entry, index === firstUser),
      text: entry.text,
    })),
    truncated: read.truncated,
  };
}
