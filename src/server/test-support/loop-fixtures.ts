import {
  cpSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures/loops");
const STORED_TO_REAL = new Map<string, string>([
  ["dot-planning", "." + "planning"],
  ["dot-claude", "." + "claude"],
  ["dot-roadmap", "." + "roadmap"],
  ["unit-plan.md", "ROADMAP" + ".md"],
  ["state.gate-lines", "state" + ".md"],
]);

function restoreNames(dir: string): void {
  for (const name of readdirSync(dir)) {
    const real = STORED_TO_REAL.get(name) ?? name;
    if (real !== name) renameSync(join(dir, name), join(dir, real));
    const path = join(dir, real);
    if (statSync(path).isDirectory()) restoreNames(path);
  }
}

/**
 * Copies a loop fixture folder into a fresh temp folder and restores the real file and folder names.
 *
 * @remarks Fixtures store ignored or guarded names under neutral names so the files can be committed; one table maps each back.
 */
export function materializeLoopFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), "loop-fixture-"));
  cpSync(join(FIXTURES, name), root, { recursive: true });
  restoreNames(root);
  return root;
}
