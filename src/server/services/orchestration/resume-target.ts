import type { Card, ResumeTarget, Session } from "../../../shared/types.js";
import { listConversations, projectsDirOf } from "../../adapters/transcript.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { latestClaudeSession, startOf } from "../../store/claude-sessions.js";
import { chooseResumeTarget } from "../domain/resume-target.js";
import { configDirOf } from "./supervisor-transcript.js";

/**
 * Decide which conversation Resume launches for a session, from the files in its project folder.
 *
 * @remarks The folder is the one Resume launches claude in (`card.workspacePath`) under the config
 * dir of the session's account. A file whose id is a node stamped missing is left out, so a
 * conversation Claude refused is not chosen again. Writes nothing.
 */
export async function resolveResumeTarget(
  card: Card,
  session: Session,
): Promise<ResumeTarget> {
  const nodes = session.claudeSessions;
  const refused = new Set(
    nodes?.filter((n) => n.missingAt != null).map((n) => n.id),
  );
  const onDisk = card.workspacePath
    ? await listConversations(
        projectsDirOf(configDirOf(session), card.workspacePath),
      )
    : [];
  const stored = latestClaudeSession(nodes);
  return chooseResumeTarget(
    stored && { id: stored.id, startedAt: startOf(stored) },
    onDisk.filter((entry) => !refused.has(entry.id)),
  );
}

/**
 * Resolve the Resume target and record a chosen conversation that differs from the stored latest.
 *
 * @remarks This also covers a session with no stored node. Errors propagate to the caller.
 */
export async function recordResumeTarget(
  card: Card,
  session: Session,
): Promise<ResumeTarget> {
  const target = await resolveResumeTarget(card, session);
  if (
    target.mode === "resume" &&
    target.sessionId !== latestClaudeSession(session.claudeSessions)?.id
  ) {
    await store.startClaudeSession(
      card.id,
      session.id,
      target.sessionId,
      target.startedAt,
    );
  }
  return target;
}

/**
 * Record the newest conversation file as the session's latest when it is newer than the stored one.
 *
 * @remarks A launch without hooks never gets a SessionStart event, so the folder is the only
 * witness of a conversation that began in the pane. Never throws.
 */
export async function recordNewestConversation(
  cardId: string,
  sessionId: string | undefined,
): Promise<void> {
  try {
    const card = store.getCard(cardId);
    const session = card?.sessions?.find(
      (s) => s.id === (sessionId ?? card.activeSessionId),
    );
    if (card && session) await recordResumeTarget(card, session);
  } catch (err) {
    console.warn(
      `[resume] could not record the newest conversation for card ${cardId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
