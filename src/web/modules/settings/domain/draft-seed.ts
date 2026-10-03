/**
 * Decide whether a server read should replace the draft form state.
 *
 * @remarks
 * A background refetch must not overwrite an unsaved edit, and a form the user has not touched
 * follows the freshest read. Reads compare by identity, so a refetch that returns a new object seeds again.
 */
export function shouldSeedDraft<T>(
  read: T | undefined,
  lastSeeded: T | undefined,
  edited: boolean,
): boolean {
  return read !== undefined && read !== lastSeeded && !edited;
}
