import path from "node:path";
import fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import type { Playbook } from "../../shared/types.js";
import { DISPATCH_DIR } from "./paths.js";

type Stage = "planning" | "implementation";

const PLAYBOOKS_DIR = path.join(DISPATCH_DIR, "playbooks");

const CODE_PLAYBOOK = `---
name: Code
stage: implementation
---
## Extra direction
{extra}`;

const PLAN_PLAYBOOK = `---
name: Plan
stage: planning
---
## Extra direction
{extra}

## Planning task
Interview me about the scope, constraints, and acceptance criteria for this ticket before writing anything. Once we agree on the approach, write a PLAN.md at the root of this workspace folder capturing the plan, then stop for my approval — do not start implementing until I approve the plan.`;

/**
 * Hand-rolled front-matter parser (no YAML dependency): the file must open with a `---\n` fence and
 * close it with a `\n---\n` fence; only `name` and `stage` are read from the fenced region and the
 * remainder is the verbatim body. Returns null (caller SKIPS) when the fences are absent, `name` is
 * empty, or `stage` is not exactly `planning`/`implementation` — a permissive parser would let a
 * malformed playbook silently join the picker.
 */
function parseFrontMatter(raw: string): Playbook | null {
  if (!raw.startsWith("---\n")) return null;
  const rest = raw.slice(4);
  const end = rest.indexOf("\n---\n");
  if (end === -1) return null;
  const fmRegion = rest.slice(0, end);
  const body = rest.slice(end + 5);

  let name = "";
  let stage = "";
  for (const line of fmRegion.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "name") name = value;
    else if (key === "stage") stage = value;
  }

  if (name === "") return null;
  if (stage !== "planning" && stage !== "implementation") return null;
  return { name, stage, body };
}

/**
 * Read every `*.md` playbook fresh from disk on each call (no cache — a user edit lands immediately),
 * returning them stage-filtered and alphabetically sorted. A missing directory yields `[]`, never a
 * throw, so a first-run/absent state renders an empty picker instead of a 500. Any file that fails to
 * parse OR whose body carries the literal `DISPATCH_STATUS:` marker is skipped with a content-free
 * warning: a playbook must never be able to smuggle the status-protocol contract into a kickoff.
 */
export async function loadPlaybooks(stage?: Stage): Promise<Playbook[]> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(PLAYBOOKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const playbooks: Playbook[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    let raw: string;
    try {
      raw = await fsp.readFile(path.join(PLAYBOOKS_DIR, entry.name), "utf8");
    } catch {
      continue;
    }

    const parsed = parseFrontMatter(raw);
    if (parsed === null) {
      console.warn("[playbooks] skipped a file (missing front-matter)");
      continue;
    }
    if (parsed.body.includes("DISPATCH_STATUS:")) {
      console.warn(
        "[playbooks] skipped a file (footgun: DISPATCH_STATUS in body)",
      );
      continue;
    }
    if (stage !== undefined && parsed.stage !== stage) continue;
    playbooks.push(parsed);
  }

  playbooks.sort((a, b) => a.name.localeCompare(b.name));
  return playbooks;
}

/**
 * Seed the two default playbooks (Code, Plan) on first run ONLY — the directory's absence is the
 * first-run signal, mirroring config.ts. An existing directory is never touched so a user's edits and
 * custom playbooks always survive a restart.
 */
export async function seedPlaybooks(): Promise<void> {
  const exists = await fsp.stat(PLAYBOOKS_DIR).then(
    () => true,
    () => false,
  );
  if (exists) return;

  await fsp.mkdir(PLAYBOOKS_DIR, { recursive: true, mode: 0o700 });
  await fsp.writeFile(path.join(PLAYBOOKS_DIR, "code.md"), CODE_PLAYBOOK, {
    mode: 0o600,
  });
  await fsp.writeFile(path.join(PLAYBOOKS_DIR, "plan.md"), PLAN_PLAYBOOK, {
    mode: 0o600,
  });
}
