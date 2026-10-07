import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type Card,
  type Session,
} from "../../../shared/types.js";
import { resolveTranscriptPath } from "../../adapters/transcript.js";
import { CLAUDE_HOME_DIR } from "../infra/paths.js";
import { accountDir } from "./claude-accounts.js";
import { rootOf } from "./supervisor-record.js";

function configDirOf(session: Session): string {
  const account = session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID;
  if (account !== DEFAULT_CLAUDE_ACCOUNT_ID) {
    try {
      return accountDir(account);
    } catch {}
  }
  return CLAUDE_HOME_DIR;
}

/** Find the transcript file of one session from its stored path, Claude session id and cwd. */
export function sessionTranscriptPath(
  card: Card,
  session: Session,
): Promise<string | null> {
  return resolveTranscriptPath({
    stored: session.transcriptPath,
    configDir: configDirOf(session),
    cwd: rootOf(card, session),
    claudeSessionId: session.claudeSessionId,
  });
}
