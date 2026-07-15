import type { PrerequisiteStatus } from "../../shared/types.js";
import { probePreflight } from "./preflight.js";

/**
 * Probe every required binary on PATH and return a per-binary status.
 * @remarks BOARD-05: the boot preflight is INFORMATIVE — the backend boots regardless so the setup
 * screen can render live status; sessions needing a missing binary still fail at use-time. Thin
 * delegate to `preflight.ts`, the single source of truth; kept so the remaining importer stays green.
 * @see docs/ARCHITECTURE.md#startup-preflight
 */
export async function probePrerequisites(): Promise<PrerequisiteStatus[]> {
  return (await probePreflight()).binaries;
}
