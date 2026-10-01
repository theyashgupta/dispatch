import type { SlackChannel } from "../../../../shared/types.js";

/**
 * Build the body that saves the picked Slack channels.
 *
 * @remarks Only id and name go out, so a picked row never sends a field the server does not store.
 */
export function slackSavePayload(picked: readonly SlackChannel[]): {
  channels: SlackChannel[];
} {
  return { channels: picked.map(({ id, name }) => ({ id, name })) };
}
