import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NUMBERED = /^scenario-(\d+[a-z]?)-([a-z0-9][a-z0-9-]*)\.e2e\.ts$/;

/**
 * Return the first ticket id that opens a parenthesized group in a commit subject.
 */
export function ticketOfSubject(subject) {
  return /\(([A-Z][A-Z0-9]*-\d+)[\s,)]/.exec(subject)?.[1];
}

/**
 * Split a numbered scenario file name into its token and slug.
 */
export function parseNumbered(fileName) {
  const match = NUMBERED.exec(fileName);
  return match ? { token: match[1], slug: match[2] } : undefined;
}

/**
 * Build the ticket-based file name for a numbered scenario file.
 */
export function targetName(fileName, ticket) {
  const { slug } = parseNumbered(fileName);
  return `scenario-${ticket}-${slug}.e2e.ts`;
}

/**
 * Replace the old scenario labels in string literals with the ticket tag.
 *
 * @remarks
 * Only whole string literals that start with `scenario-<token>` or `s<token>` change, so a path such as `./fixtures/scenario-1/repo.js` stays as it is. A rest that equals `-<slug>` is dropped to avoid a doubled slug.
 */
export function rewriteLabels(source, { token, ticket, slug }) {
  const tag = `${ticket.toLowerCase()}-${slug}`;
  const pattern = new RegExp(
    `(["'\`])(?:scenario-|s)${token}(-[^"'\`\\n]*)?(?=["'\`])`,
    "g",
  );
  return source.replace(
    pattern,
    (_match, quote, rest = "") =>
      quote + tag + (rest === `-${slug}` ? "" : rest),
  );
}

/**
 * Point references to an old scenario file name at the renamed file.
 *
 * @remarks
 * A reference changes only when exactly one existing ticket-based file has the same slug. In markdown, the old "Scenario N (path)" lead-in becomes "The scenario in path".
 */
export function rewriteReferences(text, existingNames, markdown) {
  const existing = new Set(existingNames);
  let out = text.replace(
    /scenario-(\d+[a-z]?)-([a-z0-9][a-z0-9-]*)\.e2e\.ts/g,
    (match, _token, slug) => {
      if (existing.has(match)) return match;
      const sameSlug = new RegExp(
        `^scenario-[A-Z][A-Z0-9]*-\\d+-${slug}\\.e2e\\.ts$`,
      );
      const hits = existingNames.filter((name) => sameSlug.test(name));
      return hits.length === 1 ? hits[0] : match;
    },
  );
  if (markdown) {
    out = out.replace(
      /Scenario \d+[a-z]?(?: part [A-Z])? \((tests\/e2e\/scenario-[A-Z][A-Z0-9]*-\d+-[a-z0-9-]+\.e2e\.ts)\)/g,
      "The scenario in $1",
    );
  }
  return out;
}

/**
 * Rename the numbered scenario files to ticket-based names and fix every reference.
 *
 * @remarks
 * The ticket comes from the oldest commit that added the file, with the branch name as fallback. Any unresolved file aborts the whole run before the first rename. Returns the exit status.
 */
export function renameScenarios(root) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const dir = join(root, "tests", "e2e");
  const names = readdirSync(dir);
  const plan = [];
  const errors = [];
  let branchTicket;
  try {
    branchTicket = /[A-Z][A-Z0-9]*-\d+/.exec(
      git("rev-parse", "--abbrev-ref", "HEAD"),
    )?.[0];
  } catch {
    branchTicket = undefined;
  }
  for (const name of names) {
    const parsed = parseNumbered(name);
    if (!parsed) continue;
    const subjects = git(
      "log",
      "--diff-filter=A",
      "--format=%s",
      "--",
      `tests/e2e/${name}`,
    )
      .split("\n")
      .filter(Boolean);
    const ticket =
      subjects.length > 0
        ? ticketOfSubject(subjects[subjects.length - 1])
        : branchTicket;
    if (!ticket) {
      errors.push(`${name}: no ticket found in the commit subject or branch`);
      continue;
    }
    const target = targetName(name, ticket);
    if (names.includes(target) || plan.some((p) => p.target === target)) {
      errors.push(`${name}: target ${target} already exists`);
      continue;
    }
    plan.push({ name, target, ticket, ...parsed });
  }
  if (errors.length > 0) {
    for (const line of errors) console.error(line);
    return 1;
  }
  for (const { name, target, ticket, token, slug } of plan) {
    const from = `tests/e2e/${name}`;
    const to = `tests/e2e/${target}`;
    let tracked = true;
    try {
      git("ls-files", "--error-unmatch", from);
    } catch {
      tracked = false;
    }
    if (tracked) git("mv", from, to);
    else renameSync(join(root, from), join(root, to));
    const source = readFileSync(join(root, to), "utf8");
    const next = rewriteLabels(source, { token, ticket, slug });
    if (next !== source) writeFileSync(join(root, to), next);
    console.log(`${name} -> ${target}`);
  }
  let files = [];
  try {
    files = git("grep", "-IlzE", "scenario-[0-9]+[a-z]?-[a-z0-9-]+\\.e2e\\.ts")
      .split("\0")
      .filter(Boolean);
  } catch {
    files = [];
  }
  const existingNames = readdirSync(dir);
  for (const file of files) {
    const path = join(root, file);
    const text = readFileSync(path, "utf8");
    const next = rewriteReferences(text, existingNames, file.endsWith(".md"));
    if (next !== text) writeFileSync(path, next);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  process.exitCode = renameScenarios(root);
}
