import path from "node:path";
import fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import writeFileAtomic from "write-file-atomic";
import type { InvalidPlaybook, Playbook } from "../../shared/types.js";
import { DISPATCH_DIR } from "./paths.js";

const PLAYBOOKS_DIR = path.join(DISPATCH_DIR, "playbooks");

/** Input shape for create/update: front-matter fields plus the raw markdown body. */
export type PlaybookWriteInput = {
  name: string;
  body: string;
};

/** Result union for create/update/delete — callers map each `error` to the appropriate HTTP status. */
export type PlaybookWriteResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; error: "name-exists" | "footgun" | "not-found" };

const PRD_RALPH_LOOP_PLAYBOOK = `---
name: PRD + Ralph Loop
---
## Extra direction
{extra}

## Workflow
Use the grill-me skill first to stress-test the scope of this ticket until requirements stop changing. Once the scope is settled, use the write-prd skill to produce a phased PRD.md for it. Then use the ralph-loop skill to execute the PRD phase by phase (default --qa-subagent mode unless the PRD is trivial). Hand off between steps by naming the PRD's path when moving from write-prd to ralph-loop.`;

const SUPERPOWERS_PLAYBOOK = `---
name: Superpowers
---
## Extra direction
{extra}

## Workflow
Use the Superpowers brainstorming skill to reach an approved design for this ticket before writing any code. Once the design is settled, use the writing-plans and executing-plans skills to turn it into an implementation plan and carry it out, reaching for subagent-driven-development if the work is large enough to parallelize.`;

const GSD_PLAYBOOK = `---
name: GSD
---
## Extra direction
{extra}

## Workflow
If this repo already has a GSD project set up for related work, plan and execute this ticket directly with the gsd-plan-phase and gsd-execute-phase skills. Otherwise, start with gsd-new-project (or gsd-new-milestone if a project already exists but needs a new milestone), then plan and execute the resulting phase.`;

const WRITE_CODE_DIRECTLY_PLAYBOOK = `---
name: Write code directly
---
## Extra direction
{extra}`;

/**
 * Hand-rolled front-matter parser (no YAML dependency): the file must open with a `---\n` fence and
 * close it with a `\n---\n` fence; only `name` is read from the fenced region and the remainder is
 * the verbatim body — any other key (including a legacy `stage:` line, still present on files
 * written before the stage split was retired) is silently ignored, never validated. Returns null
 * (caller SKIPS) when the fences are absent or `name` is empty — a permissive parser would let a
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
  for (const line of fmRegion.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "name") name = value;
  }

  if (name === "") return null;
  return { name, body };
}

/**
 * The single write-time-AND-load-time footgun predicate: a playbook body must never be able to
 * smuggle the status-protocol marker into a kickoff. Both `loadPlaybooks` (skip) and the write
 * path (reject) call this one expression so the two checks can never drift apart.
 */
function hasDispatchMarker(body: string): boolean {
  return body.includes("DISPATCH_STATUS:");
}

/**
 * Derive an on-disk-safe slug from a display name: lowercase, collapse every run of
 * non-`[a-z0-9]` characters to a single hyphen, trim leading/trailing hyphens. The result always
 * matches `^[a-z0-9][a-z0-9-]*$` by construction — this is the path-traversal defense, since a raw
 * client name string is NEVER passed to `path.join`.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "playbook" : slug;
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
    if (hasDispatchMarker(parsed.body)) {
      console.warn(
        "[playbooks] skipped a file (footgun: DISPATCH_STATUS in body)",
      );
      continue;
    }
    playbooks.push({ ...parsed, slug: entry.name.slice(0, -3) });
  }

  playbooks.sort((a, b) => a.name.localeCompare(b.name));
  return playbooks;
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
    if (hasDispatchMarker(parsed.body)) {
      invalid.push({ name: parsed.name, reason: "contains a reserved marker" });
      continue;
    }
    if (parsed.body.trim() === "") {
      invalid.push({ name: parsed.name, reason: "empty body" });
      continue;
    }
    valid.push({ ...parsed, slug });
  }

  valid.sort((a, b) => a.name.localeCompare(b.name));
  return { valid, invalid };
}

const SEED_PLAYBOOKS: { slug: string; content: string }[] = [
  { slug: "prd-ralph-loop", content: PRD_RALPH_LOOP_PLAYBOOK },
  { slug: "superpowers", content: SUPERPOWERS_PLAYBOOK },
  { slug: "gsd", content: GSD_PLAYBOOK },
  { slug: "write-code-directly", content: WRITE_CODE_DIRECTLY_PLAYBOOK },
];

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
 * Seed the four pipeline playbooks per-slug, at most once per machine: a slug is written only when
 * it is absent from BOTH the `.seeded.json` tombstone record and the directory itself, then recorded
 * in `.seeded.json` (atomic write, 0600) so later boots never write it again. The tombstone — not a
 * dir-level gate — is what lets a user's Settings ▸ Playbooks delete of a seed stay deleted across
 * restarts while a NEW seed shipped to an old install still lands exactly once. Files already on
 * disk before the tombstone existed are recorded without being touched; a user's own files
 * (including the retired code.md/plan.md) are never seeded, overwritten, or deleted here.
 */
export async function seedPlaybooks(): Promise<void> {
  await fsp.mkdir(PLAYBOOKS_DIR, { recursive: true, mode: 0o700 });

  const seeded = await readSeededSlugs();
  let changed = false;
  for (const seed of SEED_PLAYBOOKS) {
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

function assembleContent(input: PlaybookWriteInput): string {
  return `---\nname: ${input.name}\n---\n${input.body}`;
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

  const existing = await loadPlaybooks();
  const collision = existing.some(
    (p) => p.slug !== slug && p.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (collision) {
    return { ok: false, error: "name-exists" };
  }

  const newSlug = await uniqueSlug(input.name, slug);
  const newPath = path.join(PLAYBOOKS_DIR, `${newSlug}.md`);
  await writeFileAtomic(newPath, assembleContent(input), { mode: 0o600 });
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
