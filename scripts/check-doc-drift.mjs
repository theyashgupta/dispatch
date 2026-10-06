/**
 * Doc-drift gate (dev tooling, NOT test code): mechanically catches two classes of stale
 * documentation drift between docs/ARCHITECTURE.md and src/ — the same category as
 * check-invariants.mjs (plain Node ESM, no assertion framework, no test runner, lives outside
 * src/). It answers narrow, grep-shaped questions only, never "is this paragraph still true":
 *
 *   1. STALE REFERENCES — do the doc's own pointers still resolve?
 *      1a. Every `@see docs/ARCHITECTURE.md#anchor` in src/**\/*.{ts,tsx} must name a real
 *          heading anchor in this doc (a renamed section silently orphans its pointers).
 *      1b. Every backtick-quoted `*.ts`/`*.tsx`/`*.mjs`/`*.js` path this doc cites (optionally
 *          with a `#symbol` suffix, e.g. `board.store.ts#applyMarker`) must resolve, by path
 *          SUFFIX, to a real file under src/, scripts/, or the repo root (`eslint.config.ts`,
 *          `vite.config.ts`). `.json` is deliberately excluded from this check — the doc also
 *          cites RUNTIME data files (`board.json`, `config.json`) that never exist in the repo
 *          itself, and a filename-pattern check has no way to tell those apart from a real
 *          repo-relative config file.
 *   2. PLANNING VOCABULARY IN SHIPPED SOURCE — src/** must not carry this project's own
 *      internal planning-process vocabulary where it can leak into what a user reads or a
 *      future maintainer relies on. Patterns (case-insensitive): `this phase`,
 *      `pre-this-phase`, `Plan NN-NN`, `Phase <number>`, `phase-smoke-tester`, `ROADMAP`,
 *      `.planning/`.
 *
 * TRADEOFF (read before "fixing" a Class-2 finding away): `Phase <number>` / `Plan NN-NN` fire
 * everywhere EXCEPT inside a JSDoc block — the same JSDoc-vs-body distinction
 * check-invariants.mjs already uses, for an analogous reason: JSDoc `@remarks` is this repo's
 * OWN sanctioned home for engineering rationale (docs/standards/comments.md), and an ABSOLUTE,
 * numbered phase/plan citation there — "added in Phase 61" — does not rot the way a RELATIVE
 * one does; it stays true forever. A dry run against the real tree found ~40 such numbered
 * JSDoc citations, all legitimate history, none the bug class this gate exists to catch —
 * rewriting them would degrade real documentation just to chase a clean grep. `this phase`,
 * `pre-this-phase`, `phase-smoke-tester`, `ROADMAP`, and `.planning/` have no legitimate
 * permanent form anywhere in src/ (a self-referencing "this phase" or an internal-only tool
 * name is exactly the shape that rotted into the shipped SettingsModal bug this gate was
 * written for), so those five fire in JSDoc too, not just in strings/JSX.
 *
 * Bare `phase`/`plan` are deliberately NOT matched on their own — that would also fire on
 * legitimate English prose (a hypothetical "phase of the moon") — every Class-2 pattern is a
 * specific multi-word or numbered shape instead.
 *
 * OUT OF SCOPE, DELIBERATELY: BEHAVIORAL claims are not mechanizable and this gate does not
 * attempt them. `LIFE-03` once asserted the scheduler "never dispatches for a card outside
 * Done" while the dispatch-time check was exactly what was missing — no grep catches "the code
 * does not do what this paragraph says." A green run of this gate means the doc's own
 * cross-references resolve and no planning vocabulary leaked into src — nothing more. Do not
 * read a green run as proof "the docs are true".
 *
 * Usage: `node scripts/check-doc-drift.mjs` — exits 0 with a `PASS: ...` summary line iff all
 * checks are clean, exits 1 with a per-violation file:line report otherwise.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const SCRIPTS_DIR = "scripts";
const DOCS_PATH = join("docs", "ARCHITECTURE.md");
const SKIP_DIRS = new Set([join("src", "web", "dist")]);

const SOURCE_EXT_RE = /\.(ts|tsx|mjs|js)$/;

/**
 * Recursively list every file under `dir` as a repo-relative path, skipping the built web
 * bundle and any `node_modules` that sneaks under a scanned root.
 * @param dir Directory to walk.
 * @returns Repo-relative file paths using forward slashes.
 */
function walkAll(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (SKIP_DIRS.has(full) || entry === "node_modules") continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkAll(full));
    else out.push(full.split("\\").join("/"));
  }
  return out;
}

/**
 * Recursively list every `.ts`/`.tsx` file under `dir`, skipping the built web bundle.
 * @param dir Directory to walk.
 * @returns Repo-relative file paths.
 */
function walkTsFiles(dir) {
  return walkAll(dir).filter((f) => /\.(ts|tsx)$/.test(f));
}

/**
 * List top-level repo-root config files (non-recursive) matching the source extensions — the
 * doc cites a handful of these (`eslint.config.ts`, `vite.config.ts`) alongside its src/scripts
 * references, and they are real repo-relative paths too, just rooted one level up from src/.
 * @returns Repo-root file paths matching SOURCE_EXT_RE.
 */
function listRootConfigFiles() {
  return readdirSync(".")
    .filter((entry) => statSync(entry).isFile() && SOURCE_EXT_RE.test(entry))
    .map((entry) => entry);
}

/**
 * GitHub-flavored heading slug: lowercase, strip everything but word chars/hyphens/spaces, then
 * turn runs of whitespace into a single hyphen.
 * @remarks Does not handle GitHub's duplicate-heading `-1`/`-2` suffixing — this doc has no
 * duplicate heading text today, so that edge case is knowingly unhandled rather than guarded.
 * @param heading Raw heading text (without the leading `#` markers).
 * @returns The anchor slug GitHub would generate for this heading.
 */
function slugify(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Collect every `##`/`###` heading anchor in docs/ARCHITECTURE.md.
 * @param docText Full doc contents.
 * @returns Set of valid anchor slugs.
 */
function collectDocAnchors(docText) {
  const anchors = new Set();
  for (const line of docText.split("\n")) {
    const m = /^#{2,3}\s+(.+)$/.exec(line);
    if (m) anchors.add(slugify(m[1]));
  }
  return anchors;
}

/**
 * Class 1a — find every `@see docs/ARCHITECTURE.md#anchor` in src/**\/*.{ts,tsx} whose anchor
 * is not a real heading in the doc.
 * @param anchors Valid anchor slugs from the doc.
 * @returns Violation report lines.
 */
function checkDanglingSeeAnchors(anchors) {
  const violations = [];
  for (const file of walkTsFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const re = /@see docs\/ARCHITECTURE\.md#([\w-]+)/g;
      let m;
      while ((m = re.exec(line))) {
        const anchor = m[1];
        if (!anchors.has(anchor)) {
          violations.push(
            `${file}:${i + 1}: dangling @see anchor "#${anchor}" (no matching heading in ${DOCS_PATH})`,
          );
        }
      }
    });
  }
  return violations;
}

/**
 * Class 1b — find every backtick-quoted source-file reference in docs/ARCHITECTURE.md that
 * does not resolve, by path suffix, to a real file under src/ or scripts/.
 * @param realFiles Every repo-relative file path under src/ and scripts/.
 * @param docText Full doc contents.
 * @returns Violation report lines.
 */
function checkDanglingDocPaths(realFiles, docText) {
  const violations = [];
  const lines = docText.split("\n");
  const seenOnLine = new Map();
  lines.forEach((line, i) => {
    const re = /`([\w./-]+\.(?:ts|tsx|mjs|js))(?:#[\w.]+)?`/g;
    let m;
    while ((m = re.exec(line))) {
      const candidate = m[1];
      const key = `${i}:${candidate}`;
      if (seenOnLine.has(key)) continue;
      seenOnLine.set(key, true);
      const resolved = realFiles.some(
        (real) => real === candidate || real.endsWith(`/${candidate}`),
      );
      if (!resolved) {
        violations.push(
          `${DOCS_PATH}:${i + 1}: dangling source reference "${candidate}" (no file under src/ or scripts/ ends with this path)`,
        );
      }
    }
  });
  return violations;
}

/**
 * Class 2 patterns. `phaseNumbered` entries are suppressed inside JSDoc blocks (see the
 * module-level TRADEOFF note); the rest fire everywhere.
 */
const ALWAYS_PATTERNS = [
  { name: "this phase", re: /this phase/i },
  { name: "pre-this-phase", re: /pre-this-phase/i },
  { name: "phase-smoke-tester", re: /phase-smoke-tester/i },
  { name: "ROADMAP", re: /\broadmap\b/i },
  { name: ".planning/", re: /\.planning\// },
];

const JSDOC_EXEMPT_PATTERNS = [
  { name: "Plan NN-NN", re: /\bplan\s+\d{2}-\d{2}\b/i },
  { name: "Phase <number>", re: /\bphase\s+\d+\b/i },
];

const LOOP_FORMAT_FILES = [
  /^src\/server\/services\/domain\/loop-progress(\.test)?\.ts$/,
  /^src\/server\/services\/orchestration\/loop-progress-reader(\.test)?\.ts$/,
  /^src\/server\/services\/orchestration\/loop-progress-model\.test\.ts$/,
  /^src\/server\/test-support\/loop-fixtures\.ts$/,
];
const LOOP_FORMAT_PATTERNS = new Set([
  "ROADMAP",
  ".planning/",
  "Phase <number>",
]);

/**
 * Class 2 — scan every src/**\/*.{ts,tsx} line for planning-process vocabulary.
 * @remarks Files in `LOOP_FORMAT_FILES` parse roadmap loop files, so `.planning/`, ROADMAP and phase lines are their input format and skip those patterns only.
 * @returns Violation report lines.
 */
function checkPlanningVocabulary() {
  const violations = [];
  for (const file of walkTsFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    const loopFormat = LOOP_FORMAT_FILES.some((re) => re.test(file));
    const applies = ({ name }) =>
      !(loopFormat && LOOP_FORMAT_PATTERNS.has(name));
    let inDoc = false;
    lines.forEach((line, i) => {
      if (line.includes("/**")) inDoc = true;
      for (const { name, re } of ALWAYS_PATTERNS.filter(applies)) {
        if (re.test(line)) {
          violations.push(
            `${file}:${i + 1}: planning vocabulary "${name}" — ${line.trim()}`,
          );
        }
      }
      if (!inDoc) {
        for (const { name, re } of JSDOC_EXEMPT_PATTERNS.filter(applies)) {
          if (re.test(line)) {
            violations.push(
              `${file}:${i + 1}: planning vocabulary "${name}" — ${line.trim()}`,
            );
          }
        }
      }
      if (line.includes("*/")) inDoc = false;
    });
  }
  return violations;
}

/**
 * Run all three checks and set the process exit code.
 * @returns Nothing; exits 0 iff every check is clean, 1 otherwise.
 */
function run() {
  const docText = readFileSync(DOCS_PATH, "utf8");
  const anchors = collectDocAnchors(docText);
  const realFiles = [
    ...walkAll(SRC_DIR),
    ...walkAll(SCRIPTS_DIR),
    ...listRootConfigFiles(),
  ].filter((f) => SOURCE_EXT_RE.test(f));

  const danglingAnchors = checkDanglingSeeAnchors(anchors);
  const danglingDocPaths = checkDanglingDocPaths(realFiles, docText);
  const planningVocab = checkPlanningVocabulary();

  const sections = [
    ["Class 1a — dangling @see anchors", danglingAnchors],
    ["Class 1b — dangling doc source references", danglingDocPaths],
    ["Class 2 — planning vocabulary in src/", planningVocab],
  ];

  let total = 0;
  for (const [label, violations] of sections) {
    if (violations.length === 0) continue;
    total += violations.length;
    console.log(`\n${label} (${violations.length}):`);
    for (const v of violations) console.log(`  ${v}`);
  }

  if (total === 0) {
    console.log(
      `PASS: doc-drift clean (0 dangling anchors, 0 dangling doc references, 0 planning-vocabulary hits)`,
    );
    process.exit(0);
  }
  console.log(`\nFAIL: ${total} doc-drift violation(s)`);
  process.exit(1);
}

run();
