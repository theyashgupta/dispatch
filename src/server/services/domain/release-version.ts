import type { ReleaseBump } from "../../../shared/orchestrator-limits.js";

const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The version after `bump`, or null when `version` is not a plain x.y.z. */
export function nextVersion(version: string, bump: ReleaseBump): string | null {
  const m = VERSION_RE.exec(version);
  if (m === null) return null;
  const [x, y, z] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (bump === "major") return `${x + 1}.0.0`;
  if (bump === "minor") return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
}

/**
 * The title of the release card for `version`.
 *
 * @remarks The title is the duplicate key of `release-exists`.
 */
export function releaseTitle(version: string): string {
  return `Release v${version}`;
}

/**
 * The markdown description of a release card.
 *
 * @remarks The line labels are what the Release playbook reads.
 */
export function releaseCardText(input: {
  previous: string;
  version: string;
  bump: ReleaseBump;
  repository: string;
  base: string;
  features: string[];
  prs: number[];
  shipRights: string;
}): string {
  const prs =
    input.prs.length === 0 ? "none" : input.prs.map((n) => `#${n}`).join(", ");
  return [
    `Previous version: ${input.previous}`,
    `Next version: ${input.version}`,
    `Bump: ${input.bump}`,
    `Repository: ${input.repository}`,
    `Base: ${input.base}`,
    `Ship rights: ${input.shipRights}`,
    "",
    "Features:",
    ...input.features.map((f) => `- ${f}`),
    "",
    "Pull requests:",
    prs,
  ].join("\n");
}
