import type { DiscoveredRepo } from "../../../../shared/types.js";
import type { RepoChoice } from "./start-request.js";

/**
 * Pick the folder that is selected for the picker.
 *
 * @remarks Keeps the chosen folder while it is registered, else the remembered folder, else the first one.
 */
export function resolveFolder(
  folders: readonly string[],
  lastUsed: string | null,
  chosen: string | null,
): string | null {
  if (chosen !== null && folders.includes(chosen)) return chosen;
  return lastUsed !== null && folders.includes(lastUsed)
    ? lastUsed
    : (folders[0] ?? null);
}

/** Tell whether a repo is ticked: every discovered repo starts ticked. */
export function isRepoChecked(
  toggles: Readonly<Record<string, boolean>>,
  path: string,
): boolean {
  return toggles[path] ?? true;
}

/** Return the ticked repos with their base branch, in discovery order. */
export function chosenRepos(
  repos: readonly DiscoveredRepo[] | null,
  toggles: Readonly<Record<string, boolean>>,
  bases: Readonly<Record<string, string>>,
): RepoChoice[] {
  return (repos ?? [])
    .filter((r) => isRepoChecked(toggles, r.path))
    .map((r) => ({ path: r.path, base: bases[r.path] ?? r.base }));
}
