import path from "node:path";
import fsp from "node:fs/promises";
import type { Dirent } from "node:fs";
import writeFileAtomic from "write-file-atomic";
import type { Playbook } from "../../shared/types.js";
import { DISPATCH_DIR } from "./paths.js";

type Stage = "planning" | "implementation";

const PLAYBOOKS_DIR = path.join(DISPATCH_DIR, "playbooks");

/** Input shape for create/update: front-matter fields plus the raw markdown body. */
export type PlaybookWriteInput = {
  name: string;
  stage: Stage;
  body: string;
};

/** Result union for create/update/delete — callers map each `error` to the appropriate HTTP status. */
export type PlaybookWriteResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; error: "name-exists" | "footgun" | "not-found" };

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
 * returning them stage-filtered and alphabetically sorted. A missing directory yields `[]`, never a
 * throw, so a first-run/absent state renders an empty picker instead of a 500. Any file that fails to
 * parse OR whose body carries the DISPATCH_STATUS marker (see {@link hasDispatchMarker}) is skipped
 * with a content-free warning: a playbook must never smuggle the status-protocol contract into a kickoff.
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
    if (hasDispatchMarker(parsed.body)) {
      console.warn(
        "[playbooks] skipped a file (footgun: DISPATCH_STATUS in body)",
      );
      continue;
    }
    if (stage !== undefined && parsed.stage !== stage) continue;
    playbooks.push({ ...parsed, slug: entry.name.slice(0, -3) });
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

function assembleContent(input: PlaybookWriteInput): string {
  return `---\nname: ${input.name}\nstage: ${input.stage}\n---\n${input.body}`;
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
  if (
    existing.some((p) => p.name.toLowerCase() === input.name.toLowerCase())
  ) {
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
    playbook: { name: input.name, stage: input.stage, body: input.body, slug },
  };
}

/**
 * Rename/edit a playbook in place. Writes the fully-assembled NEW content to the NEW slug's path
 * FIRST (atomically), and only deletes the OLD path once that succeeds — never `fs.rename`. Since
 * front-matter is regenerated from form fields on every save (not preserved raw), a crash between
 * a rename and a content rewrite would otherwise leave a file at the new path with stale content;
 * write-then-delete makes the old file the only thing ever missing, never wrong.
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
    (p) =>
      p.slug !== slug && p.name.toLowerCase() === input.name.toLowerCase(),
  );
  if (collision) {
    return { ok: false, error: "name-exists" };
  }

  const newSlug = await uniqueSlug(input.name, slug);
  const newPath = path.join(PLAYBOOKS_DIR, `${newSlug}.md`);
  await writeFileAtomic(newPath, assembleContent(input), { mode: 0o600 });
  if (newSlug !== slug) {
    await fsp.unlink(oldPath);
  }
  return {
    ok: true,
    playbook: {
      name: input.name,
      stage: input.stage,
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
