const PLAYBOOK_NAME_MAX = 80;

/**
 * Picks the name for a duplicated playbook: the source name with " copy" appended, repeated until
 * no existing name matches.
 * @remarks Names compare case-insensitively and the result stays within 80 characters because
 * the playbooks route rejects both a case-only variant (409) and a longer name (400); the base is
 * trimmed so the suffix always fits.
 */
export function duplicateName(
  existing: readonly string[],
  name: string,
): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  let suffix = " copy";
  for (;;) {
    const base = name
      .slice(0, Math.max(1, PLAYBOOK_NAME_MAX - suffix.length))
      .trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
    suffix += " copy";
  }
}
