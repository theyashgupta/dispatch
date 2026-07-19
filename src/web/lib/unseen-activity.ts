export type LastOpenedMap = Record<string, string>;

/**
 * Is this card's agent output unseen? True when the backend stamped `outputChangedAt` more recently
 * than the viewer last opened the card's panel. A missing `lastOpenedIso` (never opened) → unseen
 * as soon as `outputChangedAt` is set; a missing `outputChangedAt` (no divergence yet) → never
 * unseen. ISO-8601 timestamps compare correctly as strings.
 */
export function isUnseen(
  outputChangedAt: string | undefined,
  lastOpenedIso: string | undefined,
): boolean {
  if (outputChangedAt == null) return false;
  if (lastOpenedIso == null) return true;
  return outputChangedAt > lastOpenedIso;
}
