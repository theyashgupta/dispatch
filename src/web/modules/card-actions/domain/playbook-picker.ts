import { REVIEW_PLAYBOOK_TAG } from "../../../../shared/review-playbook.js";
import type { Playbook } from "../../../../shared/types.js";

const SEED_SLUG_ORDER = [
  "prd-ralph-loop",
  "roadmap-loop",
  "superpowers",
  "gsd",
  "write-code-directly",
];

const WRITE_CODE_DIRECTLY_NAME = "Write code directly";

/** Return the seeded playbooks that are present, in the fixed seed order. */
export function orderSeedRows(valid: readonly Playbook[]): Playbook[] {
  const bySlug = new Map(valid.map((p) => [p.slug, p]));
  const rows: Playbook[] = [];
  for (const slug of SEED_SLUG_ORDER) {
    const p = bySlug.get(slug);
    if (p) rows.push(p);
  }
  return rows;
}

/** Split the valid playbooks into the seed rows and the rest, both in picker order. */
export function splitPlaybooks(valid: readonly Playbook[]): {
  seedRows: Playbook[];
  restRows: Playbook[];
} {
  const seedRows = orderSeedRows(valid);
  return { seedRows, restRows: valid.filter((p) => !seedRows.includes(p)) };
}

export function filterPlaybooksByTag(
  valid: readonly Playbook[],
  tag: string | undefined,
): Playbook[] {
  return tag === undefined
    ? [...valid]
    : valid.filter((p) => p.tags?.includes(tag) === true);
}

export function noTaggedPlaybookText(tag: string): string {
  return `No playbook has the tag ${tag}.`;
}

/**
 * Pick the playbook that is selected before the user chooses one.
 *
 * @remarks Prefers the requested playbook when listed, then the remembered default, then "Write code directly", then the first row in picker order. The remembered default is skipped when its playbook has the review tag, so only a Review start preselects it.
 */
export function initialPlaybook(
  valid: readonly Playbook[],
  lastUsed: string | null,
  preferred: string | null = null,
): string | null {
  const names = new Set(valid.map((p) => p.name));
  if (preferred !== null && names.has(preferred)) return preferred;
  const remembered = valid.find((p) => p.name === lastUsed);
  if (remembered && !remembered.tags?.includes(REVIEW_PLAYBOOK_TAG)) {
    return remembered.name;
  }
  if (names.has(WRITE_CODE_DIRECTLY_NAME)) return WRITE_CODE_DIRECTLY_NAME;
  const { seedRows, restRows } = splitPlaybooks(valid);
  return [...seedRows, ...restRows][0]?.name ?? null;
}

/** Return the chosen playbook while it is still valid, else the initial one. */
export function resolvePlaybook(
  valid: readonly Playbook[],
  lastUsed: string | null,
  chosen: string | null,
  preferred: string | null = null,
): string | null {
  return chosen !== null && valid.some((p) => p.name === chosen)
    ? chosen
    : initialPlaybook(valid, lastUsed, preferred);
}
