import { withoutSyncTokens } from "../../../shared/sync-token.js";
import type { NewLinearIssue } from "../../../shared/types.js";

export interface LinearIssueCreateInput {
  teamId: string;
  title: string;
  description: string;
  stateId?: string;
  priority?: number;
}

/**
 * Build the issueCreate input for a synced card, with the idempotency token as the last line.
 *
 * @remarks The token is what a retry's search matches, so it always ends the description.
 */
export function buildCreateInput(
  input: NewLinearIssue,
): LinearIssueCreateInput {
  const body = withoutSyncTokens(input.description ?? "");
  const out: LinearIssueCreateInput = {
    teamId: input.teamId,
    title: input.title.replace(/[\r\n]+/g, " ").trim(),
    description: body ? `${body}\n\n${input.token}` : input.token,
  };
  if (input.stateId) out.stateId = input.stateId;
  if (input.priority && input.priority >= 1 && input.priority <= 4) {
    out.priority = input.priority;
  }
  return out;
}
