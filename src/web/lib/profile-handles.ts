/**
 * Split the comma-separated Handles field into a clean list.
 *
 * @remarks Trims each entry, drops blanks and keeps the first of any duplicate, so the order the
 * user typed survives.
 */
export function parseHandles(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(",")) {
    const handle = part.trim();
    if (handle) seen.add(handle);
  }
  return [...seen];
}

/** Join a handles list back into the single text field. */
export function formatHandles(list: readonly string[]): string {
  return list.join(", ");
}
