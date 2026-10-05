export type LastOpenedMap = Record<string, string>;

/**
 * Tell whether a card's agent output is unseen since the viewer last opened its panel.
 *
 * @remarks
 * Unseen means the backend stamped `outputChangedAt` after `lastOpenedIso`. A card never opened is unseen once `outputChangedAt` is set, and a missing `outputChangedAt` is never unseen. ISO-8601 timestamps compare correctly as strings.
 */
export function isUnseen(
  outputChangedAt: string | undefined,
  lastOpenedIso: string | undefined,
): boolean {
  if (outputChangedAt == null) return false;
  if (lastOpenedIso == null) return true;
  return outputChangedAt > lastOpenedIso;
}
