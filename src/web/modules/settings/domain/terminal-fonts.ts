/**
 * Dropdown label for a font: the friendly name, with a "(not installed)" suffix when the family is
 * absent from this machine, so picking it never looks like a broken no-op that silently falls back.
 */
export function fontOptionLabel(
  name: string,
  installed: Set<string>,
  labels: Record<string, string>,
): string {
  const base = labels[name] ?? name;
  return installed.has(name) ? base : `${base} (not installed)`;
}
