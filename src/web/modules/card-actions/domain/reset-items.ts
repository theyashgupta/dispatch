import type { Card } from "../../../../shared/types.js";

/**
 * List what a reset deletes for one card, one line per item.
 *
 * @remarks A card with several sessions gets two summary lines because each session owns its own workspace and branch.
 */
export function resetItems(
  card: Pick<
    Card,
    "sessionCount" | "tmuxSession" | "sessionLost" | "workspacePath" | "branch"
  >,
): string[] {
  const sessionCount = card.sessionCount ?? 1;
  if (sessionCount > 1) {
    return [
      `${sessionCount} Claude sessions`,
      "Each session's workspace folder and local branch",
    ];
  }
  const items: string[] = [];
  if (card.tmuxSession != null || card.sessionLost === true) {
    items.push("The Claude session");
  }
  if (card.workspacePath != null) {
    items.push(`Workspace folder ${card.workspacePath}`);
  }
  if (card.branch != null) items.push(`Local branch ${card.branch}`);
  return items;
}
