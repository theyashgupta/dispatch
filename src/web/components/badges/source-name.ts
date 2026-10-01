const SOURCE_NAME: Record<string, string> = {
  github: "GitHub",
};

/**
 * Returns the display name of a source id.
 *
 * @remarks The id `meeting` reads "Meeting" and not "Granola", because a pasted note carries the
 * same id.
 */
export function sourceName(source: string): string {
  if (Object.hasOwn(SOURCE_NAME, source)) return SOURCE_NAME[source];
  if (source.trim() === "") return "Source";
  return source.charAt(0).toUpperCase() + source.slice(1);
}
