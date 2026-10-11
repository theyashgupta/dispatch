import path from "node:path";
import fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import writeFileAtomic from "write-file-atomic";
import type { InvalidPlaybook, Playbook } from "../../../shared/types.js";
import { DISPATCH_DIR } from "./paths.js";
import { hasDispatchMarker } from "../../../shared/marker-key.js";

const PLAYBOOKS_DIR = path.join(DISPATCH_DIR, "playbooks");

/** Input shape for create/update: front-matter fields plus the raw markdown body. */
export type PlaybookWriteInput = {
  name: string;
  body: string;
};

const PLAYBOOK_WHEN_MAX = 300;

/** Result union for create/update/delete — callers map each `error` to the appropriate HTTP status. */
export type PlaybookWriteResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; error: "name-exists" | "footgun" | "not-found" };

const PRD_RALPH_LOOP_PLAYBOOK = `---
name: PRD + Ralph Loop
when: One ticket or one feature of one module, up to a few hundred lines, with phases, QA and a gap analysis.
---
## Extra direction
{extra}

## Workflow
Use the grill-me skill first to stress-test the scope of this ticket until requirements stop changing. Once the scope is settled, use the write-prd skill to produce a phased PRD.md for it. Then use the ralph-loop skill to execute the PRD phase by phase (default --qa-subagent mode unless the PRD is trivial). Hand off between steps by naming the PRD's path when moving from write-prd to ralph-loop.`;

const SUPERPOWERS_PLAYBOOK = `---
name: Superpowers
when: A ticket whose design is still open and needs a brainstorm before a plan.
---
## Extra direction
{extra}

## Workflow
Use the Superpowers brainstorming skill to reach an approved design for this ticket before writing any code. Once the design is settled, use the writing-plans and executing-plans skills to turn it into an implementation plan and carry it out, reaching for subagent-driven-development if the work is large enough to parallelize.`;

const GSD_PLAYBOOK = `---
name: GSD
when: A repository that already runs a GSD project, or work that needs a new GSD milestone.
---
## Extra direction
{extra}

## Workflow
If this repo already has a GSD project set up for related work, plan and execute this ticket directly with the gsd-plan-phase and gsd-execute-phase skills. Otherwise, start with gsd-new-project (or gsd-new-milestone if a project already exists but needs a new milestone), then plan and execute the resulting phase.`;

const WRITE_CODE_DIRECTLY_PLAYBOOK = `---
name: Write code directly
when: One known fix of a few lines with no new surface.
---
## Extra direction
{extra}`;

const ROADMAP_LOOP_PLAYBOOK = `---
name: Roadmap Loop
when: Two or more related tickets with an order or shared files, or any ticket that spans server, web and docs across modules.
---
## Extra direction
{extra}

## Workflow
Use this playbook for one feature that spans several related tickets and runs end to end as one stack. Read every ticket above, with its description and comments, first.

Part 1, planning:
1. Run the write-roadmap skill on the whole ticket group. It verifies claims against the code, grills the unknowns and the unit cut, then writes the roadmap. Stop for roadmap approval.
2. After the approval, for each unit in order: run grill-me scoped to that unit, then write-prd for that unit. Decision ids go to .roadmap/<slug>/decisions.md, and every id must appear in the PRD of its unit.

Part 2, execution:
3. Run the roadmap-loop skill on the roadmap. It executes every unit through the ralph-loop per-phase flow, audits each unit with readiness-audit, records deviations in changed-decisions.md and deferrals in todo.md, and commits each unit to a stacked local branch.
4. Never push, tag, open a PR or merge. On completion, hand back with the end-of-run report.`;

const BOARD_ORCHESTRATOR_PLAYBOOK = `---
name: Board Orchestrator
when: Only the board orchestrator session. Dispatch starts it; never start a ticket with it.
---
## Extra direction
{extra}

## Workflow
You coordinate the work of one board with the dispatch tools. Your state lives in the tools, never in your memory.
1. Call read_state first. Then call get_rulebook and follow the rule book that it returns. Call get_rulebook again after each handoff.
2. The rule book tells you how to triage an intake, judge the playbook of each ticket, group related tickets, write one plan as a decision item, start cards and groups inside the concurrency cap, write directions, monitor, ship and release.
3. A user turn typed in your terminal is a direction from the user. Handle it as the rule book says for an intake.
4. A message that starts with "Dispatch wake:" comes from Dispatch. Read the board state with the dispatch tools and continue.
5. End every turn with wait_for_event. Never end a turn with only a report.
6. Call write_state after each decision, with the full current state: cards, groups, pending decisions and next steps.
Act on an intake_submitted or decision_answered event only when its data.orchestratorId is your orchestrator id.
Hand off only when asked. At a handoff, call write_state with handoffReady set to true, print HANDOFF_READY and your orchestrator id, and end your turn.
You do not change product code.

An orchestrator never:
1. Writes or edits product code or any file in a repository.
2. Commits, pushes, merges or rebases outside the ship flow of D-8.
3. Selects usage credits.
4. Reads the vault or an env file.
5. Changes a policy, its own or another one.
6. Kills a process or a port holder.
7. Starts a loop above the concurrency cap.
8. Acts on another board, or on a card outside its scope (D-7).
9. Answers its own decision item, or approves a permission prompt.
10. Deletes a branch, a worktree or a card that it did not create.`;

/**
 * Parse the front matter of a playbook file, or null when the fences are absent or `name` is empty.
 *
 * @remarks Only `name` and `when` are read, and a `when` that is empty or longer than
 * {@link PLAYBOOK_WHEN_MAX} is dropped without failing the parse. Every other key, such as a legacy
 * `stage:` line, is ignored, and the rest of the file is the verbatim body.
 */
function parseFrontMatter(raw: string): Playbook | null {
  if (!raw.startsWith("---\n")) return null;
  const rest = raw.slice(4);
  const end = rest.indexOf("\n---\n");
  if (end === -1) return null;
  const fmRegion = rest.slice(0, end);
  const body = rest.slice(end + 5);

  let name = "";
  let when = "";
  for (const line of fmRegion.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "name") name = value;
    if (key === "when") when = value;
  }

  if (name === "") return null;
  if (when === "" || when.length > PLAYBOOK_WHEN_MAX) return { name, body };
  return { name, body, when };
}

export { hasDispatchMarker };

function carriesMarker(p: Playbook): boolean {
  return hasDispatchMarker(p.body) || hasDispatchMarker(p.when ?? "");
}

/**
 * Derive an on-disk-safe slug from a display name: lowercase, collapse every run of
 * non-`[a-z0-9]` characters to a single hyphen, trim leading/trailing hyphens. The result always
 * matches `^[a-z0-9][a-z0-9-]*$` by construction — this is the path-traversal defense, since a raw
 * client name string is NEVER passed to `path.join`. A caller's `fallback` must itself be a slug.
 */
export function slugify(name: string, fallback = "playbook"): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? fallback : slug;
}

/**
 * Read every `*.md` playbook fresh from disk on each call (no cache — a user edit lands immediately),
 * returning them alphabetically sorted, flat (no stage scoping). A missing directory yields `[]`,
 * never a throw, so a first-run/absent state renders an empty picker instead of a 500. Any file that
 * fails to parse OR whose body carries the DISPATCH_STATUS marker (see {@link hasDispatchMarker}) is
 * skipped with a content-free warning: a playbook must never smuggle the status-protocol contract
 * into a kickoff.
 */
export async function loadPlaybooks(): Promise<Playbook[]> {
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
    if (carriesMarker(parsed)) {
      console.warn(
        "[playbooks] skipped a file (footgun: DISPATCH_STATUS in body or when)",
      );
      continue;
    }
    playbooks.push(withSeedWhen({ ...parsed, slug: entry.name.slice(0, -3) }));
  }

  playbooks.sort((a, b) => a.name.localeCompare(b.name));
  return playbooks;
}

/** True when a loadable playbook has this name. */
export async function playbookExists(name: string): Promise<boolean> {
  return (await loadPlaybooks()).some((p) => p.name === name);
}

/**
 * Read every `*.md` playbook fresh from disk, returning valid entries alongside malformed ones
 * — a sibling of {@link loadPlaybooks} that never silently skips, for the picker's greyed-out-row
 * contract (KICK-04). `loadPlaybooks` itself is untouched: start-route validation, start-session,
 * and the Settings list keep its clean `Playbook[]` contract.
 *
 * @remarks Reason strings are a fixed four-phrase vocabulary — "unreadable file", "missing
 * front-matter", "empty body", "contains a reserved marker" — never raw fs/parser text or
 * absolute paths (mirrors the route layer's generic-500 discipline; an fs error can embed a path,
 * a parser error can embed file content). The display name falls back to the filename stem when
 * front-matter didn't parse; once `name` is known, later checks (empty body, reserved marker) use
 * the parsed name instead of the stem.
 */
export async function loadPlaybooksForPicker(): Promise<{
  valid: Playbook[];
  invalid: InvalidPlaybook[];
}> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(PLAYBOOKS_DIR, { withFileTypes: true });
  } catch {
    return { valid: [], invalid: [] };
  }

  const valid: Playbook[] = [];
  const invalid: InvalidPlaybook[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const slug = entry.name.slice(0, -3);

    let raw: string;
    try {
      raw = await fsp.readFile(path.join(PLAYBOOKS_DIR, entry.name), "utf8");
    } catch {
      invalid.push({ name: slug, reason: "unreadable file" });
      continue;
    }

    const parsed = parseFrontMatter(raw);
    if (parsed === null) {
      invalid.push({ name: slug, reason: "missing front-matter" });
      continue;
    }
    if (carriesMarker(parsed)) {
      invalid.push({ name: parsed.name, reason: "contains a reserved marker" });
      continue;
    }
    if (parsed.body.trim() === "") {
      invalid.push({ name: parsed.name, reason: "empty body" });
      continue;
    }
    valid.push(withSeedWhen({ ...parsed, slug }));
  }

  valid.sort((a, b) => a.name.localeCompare(b.name));
  return { valid, invalid };
}

const SEED_PLAYBOOKS: { slug: string; content: string }[] = [
  { slug: "prd-ralph-loop", content: PRD_RALPH_LOOP_PLAYBOOK },
  { slug: "superpowers", content: SUPERPOWERS_PLAYBOOK },
  { slug: "gsd", content: GSD_PLAYBOOK },
  { slug: "write-code-directly", content: WRITE_CODE_DIRECTLY_PLAYBOOK },
  { slug: "roadmap-loop", content: ROADMAP_LOOP_PLAYBOOK },
  { slug: "board-orchestrator", content: BOARD_ORCHESTRATOR_PLAYBOOK },
];

const SEED_WHEN_BY_SLUG: ReadonlyMap<string, string> = new Map(
  SEED_PLAYBOOKS.flatMap((s) => {
    const when = parseFrontMatter(s.content)?.when;
    return when === undefined ? [] : [[s.slug, when] as const];
  }),
);

export function isSeedSlug(slug: string): boolean {
  return SEED_PLAYBOOKS.some((s) => s.slug === slug);
}

function withSeedWhen(p: Playbook): Playbook {
  const seedWhen =
    p.slug === undefined ? undefined : SEED_WHEN_BY_SLUG.get(p.slug);
  return p.when === undefined && seedWhen !== undefined
    ? { ...p, when: seedWhen }
    : p;
}

const RETIRED_SEED_HASHES: Readonly<Record<string, readonly string[]>> = {
  "prd-ralph-loop": [
    "61328e5d08d8c54c0f017bcd9fa5e5ab51eb74b06c7e54769ebd09b1c6cb3298",
  ],
  superpowers: [
    "31ac4e5c6844d4a5d6f78f834a64d28452fda3faaa3f08561086488bb3e31bd0",
  ],
  gsd: ["687d4f24b7cec727f78ba8e7eac392ea9a146673a5291bb451983a3d75c46d94"],
  "write-code-directly": [
    "6cd92780a37c31f451a1113f9e4173802eaf693d0ab9fcb028fb67f98dfaf451",
  ],
  "board-orchestrator": [
    "20ec6f18f070b4abd7a6677127bcd9955140bb7a465f6a08253e88772c75f057",
    "bf061f731d3c651ccbf81a2deb55a1ba0920589b1ff1f40852982ff8c7b414de",
    "9ceacc27bb0734cb81ebd898a341cd71bb95f9b63b5fa505caf17f2464727076",
  ],
};

async function upgradeRetiredSeed(seed: {
  slug: string;
  content: string;
}): Promise<void> {
  const file = path.join(PLAYBOOKS_DIR, `${seed.slug}.md`);
  let raw: string;
  try {
    raw = await fsp.readFile(file, "utf8");
  } catch {
    return;
  }
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");
  if (RETIRED_SEED_HASHES[seed.slug]?.includes(hash)) {
    try {
      await writeFileAtomic(file, seed.content, { mode: 0o600 });
    } catch (err) {
      console.warn(
        `[playbooks] could not upgrade seed ${seed.slug}: ${(err as Error).message}`,
      );
    }
  }
}

const SEED_STATE_PATH = path.join(PLAYBOOKS_DIR, ".seeded.json");

/**
 * Read the seeded-once tombstone record (a JSON string array of slugs) written by
 * {@link seedPlaybooks}. A missing or corrupt file degrades to "nothing seeded yet" — the seeder
 * then falls back to its per-file existence check, so the worst case is one extra seeding pass,
 * never a throw at boot.
 */
async function readSeededSlugs(): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(
      await fsp.readFile(SEED_STATE_PATH, "utf8"),
    );
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((s): s is string => typeof s === "string"));
    }
  } catch {
    return new Set();
  }
  return new Set();
}

/**
 * Seed the built-in playbooks per-slug, at most once per machine: a slug is written only when
 * it is absent from BOTH the `.seeded.json` tombstone record and the directory itself, then recorded
 * in `.seeded.json` (atomic write, 0600) so later boots never write it again. The tombstone, not a
 * dir-level gate, is what lets a user's Settings ▸ Playbooks delete of a seed stay deleted across
 * restarts while a NEW seed shipped to an old install still lands exactly once. Files already on
 * disk before the tombstone existed are recorded without being touched; a user's own files
 * (including the retired code.md/plan.md) are never seeded, overwritten, or deleted here.
 *
 * @remarks A seed file whose SHA-256 is in the retired set of its slug is rewritten with the
 * current seed, because a match proves the user never edited it. Any other content stays untouched.
 */
export async function seedPlaybooks(): Promise<void> {
  await fsp.mkdir(PLAYBOOKS_DIR, { recursive: true, mode: 0o700 });

  const seeded = await readSeededSlugs();
  let changed = false;
  for (const seed of SEED_PLAYBOOKS) {
    await upgradeRetiredSeed(seed);
    if (seeded.has(seed.slug)) continue;
    if (!(await slugExists(seed.slug))) {
      await fsp.writeFile(
        path.join(PLAYBOOKS_DIR, `${seed.slug}.md`),
        seed.content,
        { mode: 0o600 },
      );
    }
    seeded.add(seed.slug);
    changed = true;
  }

  if (changed) {
    await writeFileAtomic(
      SEED_STATE_PATH,
      JSON.stringify([...seeded].sort(), null, 2) + "\n",
      { mode: 0o600 },
    );
  }
}

function assembleContent(input: PlaybookWriteInput, when?: string): string {
  const whenLine = when ? `when: ${when}\n` : "";
  return `---\nname: ${input.name}\n${whenLine}---\n${input.body}`;
}

async function slugExists(slug: string): Promise<boolean> {
  return fsp.stat(path.join(PLAYBOOKS_DIR, `${slug}.md`)).then(
    () => true,
    () => false,
  );
}

/**
 * Resolve a collision-free on-disk slug for `name`, re-checking the directory itself (not a cached
 * `loadPlaybooks()` scan) on every candidate — a malformed file `loadPlaybooks` silently skips must
 * still block the slot it occupies. `excludeSlug` lets an update keep its own current filename
 * without tripping over itself as a "collision".
 */
async function uniqueSlug(name: string, excludeSlug?: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (candidate !== excludeSlug && (await slugExists(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

/**
 * Create a new playbook file. Name collisions are checked case-insensitively (this machine's
 * default filesystem, APFS, is case-insensitive, so two case-variant names would otherwise
 * silently collide on write) BEFORE the footgun check, so a rejected duplicate never even reaches
 * the DISPATCH_STATUS scan. The directory is (re-)created here since a user could delete it
 * between boot and this call.
 */
export async function createPlaybook(
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  await fsp.mkdir(PLAYBOOKS_DIR, { recursive: true, mode: 0o700 });

  const existing = await loadPlaybooks();
  if (existing.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) {
    return { ok: false, error: "name-exists" };
  }
  if (hasDispatchMarker(input.body)) {
    return { ok: false, error: "footgun" };
  }

  const slug = await uniqueSlug(input.name);
  await writeFileAtomic(
    path.join(PLAYBOOKS_DIR, `${slug}.md`),
    assembleContent(input),
    { mode: 0o600 },
  );
  return {
    ok: true,
    playbook: { name: input.name, body: input.body, slug },
  };
}

/**
 * Rename/edit a playbook in place. Writes the fully-assembled NEW content to the NEW slug's path
 * FIRST (atomically), and only deletes the OLD path once that succeeds — never `fs.rename`. Since
 * front-matter is regenerated from form fields on every save (not preserved raw), a crash between
 * a rename and a content rewrite would otherwise leave a file at the new path with stale content;
 * write-then-delete makes the old file the only thing ever missing, never wrong. The old-path
 * unlink tolerates ENOENT (mirrors {@link deletePlaybook}) since a concurrent delete or a retried
 * rename can leave the old file already gone — the desired end state (new present, old gone) still
 * holds, so that case must not surface as a write failure.
 */
export async function updatePlaybook(
  slug: string,
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  const oldPath = path.join(PLAYBOOKS_DIR, `${slug}.md`);
  const exists = await fsp.stat(oldPath).then(
    () => true,
    () => false,
  );
  if (!exists) {
    return { ok: false, error: "not-found" };
  }
  if (hasDispatchMarker(input.body)) {
    return { ok: false, error: "footgun" };
  }

  const storedWhen = await fsp.readFile(oldPath, "utf8").then(
    (raw) => parseFrontMatter(raw)?.when,
    () => undefined,
  );
  const existing = await loadPlaybooks();
  const collision = existing.some(
    (p) => p.slug !== slug && p.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (collision) {
    return { ok: false, error: "name-exists" };
  }

  const newSlug = await uniqueSlug(input.name, slug);
  const newPath = path.join(PLAYBOOKS_DIR, `${newSlug}.md`);
  await writeFileAtomic(newPath, assembleContent(input, storedWhen), {
    mode: 0o600,
  });
  if (newSlug !== slug) {
    await fsp.unlink(oldPath).catch((err) => {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    });
  }
  return {
    ok: true,
    playbook: {
      name: input.name,
      body: input.body,
      slug: newSlug,
      ...(storedWhen ? { when: storedWhen } : {}),
    },
  };
}

/** Delete a playbook by slug. A missing file maps to `not-found`; every other failure propagates. */
export async function deletePlaybook(
  slug: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  try {
    await fsp.unlink(path.join(PLAYBOOKS_DIR, `${slug}.md`));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, error: "not-found" };
    }
    throw err;
  }
  return { ok: true };
}
