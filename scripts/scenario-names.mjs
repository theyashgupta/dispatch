import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NUMBERED = /^scenario-(\d+[a-z]?)-([a-z0-9][a-z0-9-]*)\.e2e\.ts$/;
const TICKETED =
  /^scenario-([A-Z][A-Z0-9]*-\d+)-([a-z0-9][a-z0-9-]*)\.e2e\.ts$/;
const TITLE = /(["'`])scenario \d+[a-z]?(?: part [A-Z])?(?=[:\s])/g;
const NUMBERED_LABEL = /(["'`])(?:scenario[- ]|s)\d+[a-z]?(?=["'`\s:-])/g;
const NUMBERED_NAME = /scenario-\d+[a-z]?-[a-z0-9][a-z0-9-]*\.e2e\.ts/g;
const REFERENCE_PATHSPEC = [
  "--",
  ".",
  ":(exclude)scripts/scenario-names.test.mjs",
];
const LIST_START = "<!-- scenario-list:start -->";
const LIST_END = "<!-- scenario-list:end -->";
const MARKERS_MISSING =
  "docs/ARCHITECTURE.md: scenario list markers are missing";

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
 * Only whole string literals that start with `scenario-<token>` or `s<token>` change, so a path such as `./fixtures/scenario-1/repo.js` stays as it is. A rest that equals `-<slug>` is dropped to avoid a doubled slug. A literal that opens with `scenario <number>` takes the file stem whatever the number is, because a file renamed by hand in the past can carry another number.
 */
export function rewriteLabels(source, { token, ticket, slug }) {
  const tag = `${ticket.toLowerCase()}-${slug}`;
  const pattern = new RegExp(
    `(["'\`])(?:scenario-|s)${token}(-[^"'\`\\n]*)?(?=["'\`])`,
    "g",
  );
  return source
    .replace(
      pattern,
      (_match, quote, rest = "") =>
        quote + tag + (rest === `-${slug}` ? "" : rest),
    )
    .replace(TITLE, `$1scenario-${ticket}-${slug}`);
}

/**
 * Split a ticket-based scenario file name into its ticket and slug.
 */
export function parseTicketed(fileName) {
  const match = TICKETED.exec(fileName);
  return match ? { ticket: match[1], slug: match[2] } : undefined;
}

/**
 * Render the doc list of ticket-based scenario files.
 *
 * @remarks
 * Lines sort by ticket prefix, then ticket number, then slug. Test titles stay out of the list because they carry old numbers.
 */
export function renderList(names) {
  const rows = names.flatMap((name) => {
    const parsed = parseTicketed(name);
    if (!parsed) return [];
    const [, prefix, number] = /^(.+)-(\d+)$/.exec(parsed.ticket);
    return [{ name, prefix, number: Number(number), ...parsed }];
  });
  rows.sort(
    (a, b) =>
      (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0) ||
      a.number - b.number ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  return rows.map((r) => `- tests/e2e/${r.name} (${r.ticket})`).join("\n");
}

/**
 * Put the list between the two scenario list markers of a doc.
 *
 * @remarks
 * Returns undefined when a marker is missing. The block keeps a blank line on each side of the list so that prettier does not change it.
 */
export function replaceList(docText, list) {
  const start = docText.indexOf(LIST_START);
  const end = docText.indexOf(LIST_END);
  if (start < 0 || end < start) return undefined;
  const body = list ? `\n\n${list}\n\n` : "\n\n";
  return (
    docText.slice(0, start + LIST_START.length) + body + docText.slice(end)
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
 * Build a git runner that works in the given folder and returns its output.
 */
function gitIn(root) {
  return (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
}

/**
 * Rename the numbered scenario files to ticket-based names and fix every reference.
 *
 * @remarks
 * The ticket comes from the oldest commit that added the file, with the branch name as fallback. Any unresolved file aborts the whole run before the first rename. Returns the exit status.
 */
export function renameScenarios(root) {
  const git = gitIn(root);
  const dir = join(root, "tests", "e2e");
  const docPath = join(root, "docs", "ARCHITECTURE.md");
  if (replaceList(readFileSync(docPath, "utf8"), "") === undefined) {
    console.error(MARKERS_MISSING);
    return 1;
  }
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
    files = git(
      "grep",
      "-IlzE",
      "scenario-[0-9]+[a-z]?-[a-z0-9-]+\\.e2e\\.ts",
      ...REFERENCE_PATHSPEC,
    )
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
  const doc = readFileSync(docPath, "utf8");
  const nextDoc = replaceList(doc, renderList(readdirSync(dir)));
  if (nextDoc !== doc) writeFileSync(docPath, nextDoc);
  formatFiles(root, [
    ...readdirSync(dir)
      .filter((name) => parseTicketed(name))
      .map((name) => `tests/e2e/${name}`),
    ...files,
    "docs/ARCHITECTURE.md",
  ]);
  return 0;
}

/**
 * Run the repo's prettier on the files so the generated output passes the format check.
 *
 * @remarks
 * A longer label can push a line past the print width. A checkout without `node_modules` skips the step.
 */
function formatFiles(root, files) {
  const prettier = join(root, "node_modules", ".bin", "prettier");
  if (!existsSync(prettier)) return;
  execFileSync(
    prettier,
    ["--log-level", "warn", "--write", ...new Set(files)],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
}

/**
 * List the numbered scenario names, references and labels and the stale doc list, and change nothing.
 *
 * @remarks
 * The reference scan uses the same git grep and exclusion as the rename run. The label scan covers ticket-based files only.
 */
export function scenarioDrift(root) {
  const git = gitIn(root);
  const dir = join(root, "tests", "e2e");
  const names = readdirSync(dir);
  const violations = [];
  for (const name of names) {
    if (parseNumbered(name)) {
      violations.push(
        `tests/e2e/${name}: numbered scenario file, run node scripts/scenario-names.mjs`,
      );
    }
  }
  let lines = [];
  try {
    lines = git(
      "grep",
      "-nIE",
      "scenario-[0-9]+[a-z]?-[a-z0-9-]+\\.e2e\\.ts",
      ...REFERENCE_PATHSPEC,
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    lines = [];
  }
  for (const line of lines) {
    const match = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!match) continue;
    for (const [name] of match[3].matchAll(NUMBERED_NAME)) {
      violations.push(
        `${match[1]}:${match[2]}: numbered scenario reference ${name}`,
      );
    }
  }
  const ticketed = names.filter((name) => parseTicketed(name));
  for (const name of ticketed) {
    const source = readFileSync(join(dir, name), "utf8");
    for (const [label] of source.matchAll(NUMBERED_LABEL)) {
      violations.push(`tests/e2e/${name}: numbered label ${label.slice(1)}`);
    }
  }
  const doc = readFileSync(join(root, "docs", "ARCHITECTURE.md"), "utf8");
  const expected = replaceList(doc, renderList(ticketed));
  if (expected === undefined) violations.push(MARKERS_MISSING);
  else if (expected !== doc) {
    violations.push(
      "docs/ARCHITECTURE.md: scenario list is stale, run node scripts/scenario-names.mjs",
    );
  }
  return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
  if (process.argv.includes("--check")) {
    const violations = scenarioDrift(root);
    for (const line of violations) console.error(line);
    process.exitCode = violations.length > 0 ? 1 : 0;
  } else {
    process.exitCode = renameScenarios(root);
  }
}
