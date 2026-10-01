import type { PrerequisiteStatus } from "../../../../shared/types.js";

export type RowInstall =
  { phase: "installing" } | { phase: "failed"; command: string };

export type RowInstalls = Record<string, RowInstall>;

export function startInstall(state: RowInstalls, name: string): RowInstalls {
  return { ...state, [name]: { phase: "installing" } };
}

export function failInstall(
  state: RowInstalls,
  name: string,
  command: string,
): RowInstalls {
  return { ...state, [name]: { phase: "failed", command } };
}

export function clearInstall(state: RowInstalls, name: string): RowInstalls {
  const next = { ...state };
  delete next[name];
  return next;
}

export function replaceStatus(
  rows: PrerequisiteStatus[],
  status: PrerequisiteStatus,
): PrerequisiteStatus[] {
  return rows.map((r) => (r.name === status.name ? status : r));
}

/**
 * Describe one prerequisite row for assistive tech.
 *
 * @remarks
 * A missing row says how to fix it: the install command for an installable one, the hint
 * otherwise, with a generic phrase when the server sent neither.
 */
export function prerequisiteRowLabel(p: PrerequisiteStatus): string {
  const commandText = p.command ?? p.hint;
  if (p.present) return `${p.name} installed`;
  return p.installable
    ? `${p.name} missing. Install with ${commandText ?? "your package manager"}`
    : `${p.name} missing. See ${commandText ?? "the docs"}`;
}

export function nodeDetail(node: {
  ok: boolean;
  version: string;
  floor: string;
}): string {
  return node.ok
    ? `v${node.version}`
    : `v${node.version}, below supported floor (${node.floor})`;
}

export function storageDetail(storage: { ok: boolean; path: string }): string {
  return storage.ok ? `OK: ${storage.path}` : `check failed: ${storage.path}`;
}
