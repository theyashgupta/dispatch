import { formatCount } from "../../../../shared/format-count.js";
import type { BoardWorkspaceRepo } from "../../../../shared/types.js";

export type CountKind = "running" | "openGroups" | "attention";

/** The badge text of one count cell, or null for zero so the cell shows a plain "0". */
export function countLabel(kind: CountKind, n: number): string | null {
  if (n === 0) return null;
  switch (kind) {
    case "running":
      return `${formatCount(n)} running`;
    case "openGroups":
      return n === 1 ? "1 open group" : `${formatCount(n)} open groups`;
    case "attention":
      return n === 1 ? "1 needs attention" : `${formatCount(n)} need attention`;
  }
}

/** The Repositories cell text at 1024 px. */
export function repositoryCountLabel(n: number): string {
  return n === 1 ? "1 repository" : `${formatCount(n)} repositories`;
}

/** The folder names of a board, joined for the Repositories cell at 1440 px. */
export function repositoryNames(
  repositories: readonly Pick<BoardWorkspaceRepo, "path">[],
): string {
  return repositories
    .map((repo) => repo.path.replace(/\/+$/, "").split("/").pop() ?? "")
    .filter((name) => name !== "")
    .join(", ");
}
