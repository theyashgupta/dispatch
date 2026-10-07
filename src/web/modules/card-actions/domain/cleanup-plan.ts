import type { Card } from "../../../../shared/types.js";

export type CleanupPlan =
  | { blocked: false; message: string }
  | { blocked: true; lines: { key: string; text: string }[] };

function fileCount(count: number): string {
  return `${count} uncommitted file${count === 1 ? "" : "s"}`;
}

/**
 * Decide what the cleanup dialog tells the user for one card.
 *
 * @remarks
 * A card with two or more sessions is judged per session, so one dirty session blocks the whole
 * cleanup. A blocked plan lists each dirty repo, and its confirm discards the uncommitted work.
 */
export function cleanupPlan(
  card: Pick<Card, "cleanupBlocked" | "sessionSummaries">,
): CleanupPlan {
  const summaries =
    (card.sessionSummaries?.length ?? 0) >= 2
      ? card.sessionSummaries
      : undefined;
  if (summaries == null) {
    const blocked = card.cleanupBlocked ?? [];
    if (blocked.length === 0) {
      return {
        blocked: false,
        message:
          "Clean up workspace? Kills the session and removes worktrees; branches are kept.",
      };
    }
    return {
      blocked: true,
      lines: blocked.map((entry) => ({
        key: entry.repo,
        text: `${entry.repo}: ${fileCount(entry.count)}`,
      })),
    };
  }
  const lines = summaries.flatMap((s) =>
    (s.cleanupBlocked ?? []).map((entry) => ({
      key: `${s.id}:${entry.repo}`,
      text: `Session ${s.ordinal} (${entry.repo}): ${fileCount(entry.count)}`,
    })),
  );
  if (lines.length === 0) {
    return {
      blocked: false,
      message: `Clean up all ${summaries.length} sessions? Kills each session and removes its worktrees; branches are kept.`,
    };
  }
  return { blocked: true, lines };
}
