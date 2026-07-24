/**
 * Invariant-home audit gate for the Phase 10 knowledge migration (dev tooling,
 * NOT test code): imports no test framework, asserts nothing about app runtime
 * behavior, and lives outside src/ — the same category as eslint.config.ts.
 *
 * It answers one question as closed-set arithmetic instead of a read-through:
 * has every invariant ID in the frozen baseline reached a DURABLE home? A
 * durable home is an ID appearing inside a JSDoc block (/** ... *\/) in
 * src/**\/*.{ts,tsx} OR anywhere in docs/ARCHITECTURE.md. An ID sitting only in
 * a // body/line comment does NOT count as homed — that JSDoc-vs-body-comment
 * distinction (Pattern 2 in 10-RESEARCH.md) is what keeps the gate meaningful
 * while the original body comments still exist.
 *
 * Modes:
 *   node scripts/check-invariants.mjs               diff + exit 0 iff MISSING, ORPHAN, and EXTRA are ALL empty
 *   node scripts/check-invariants.mjs --generate-baseline   print sorted labeled IDs (src + docs)
 *
 * The bare `⏺` protocol glyph is DELIBERATELY excluded from ID_RE: it is a
 * marker character, not an invariant ID, and counting it would push the
 * baseline off its frozen count (the RATIFIED token already carries the
 * watcher-discriminator amendment).
 *
 * ID_RE tolerates a letter segment after each numeric segment so
 * letter-suffixed sub-IDs match WHOLE (`T-08b-01` is `T-08b-01`, never a
 * collapsed `T-08`; `T-01-04c` is `T-01-04c`): the T-08a/T-08b family and the
 * T-01-04/T-01-05 sub-controls are distinct invariants, and collapsing them
 * would let a deleted sub-control pass as long as any sibling token survived.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ID_RE =
  /\b(?:PANEL|WR|MARK|TERM|RESIL|REVIEW|ATTN|BUG|IN|ORCH|SYNC|LIFE|MODAL|BOARD|SEC|T)-\d+[a-z]?(?:-\d+[a-z]?)?|\bNEW-\d+|\bRATIFIED\b/g;

/**
 * The ratified size of the frozen baseline. `readBaseline` REJECTS any other
 * size so an accidentally emptied/truncated baseline (or an unratified
 * regeneration) can never silently disarm the gate into `PASS: 0/0`. Bump this
 * ONLY together with a deliberate, human-ratified baseline regeneration.
 */
const FROZEN_COUNT = 92;

const SRC_DIR = "src";
const SKIP_DIR = join("src", "web", "dist");
const DOCS_PATH = join("docs", "ARCHITECTURE.md");
const BASELINE_PATH = join("scripts", "invariant-baseline.txt");

/**
 * Recursively list every .ts/.tsx source file, skipping the built web bundle.
 * @param dir Directory to walk.
 * @returns Absolute-from-cwd file paths.
 */
function walkSrc(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full === SKIP_DIR) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkSrc(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Collect invariant IDs that appear inside JSDoc blocks only.
 * @remarks Toggles an in-block flag on `/**` and `*\/`; body/line `//` comments
 * are never scanned, so an undeleted original body comment is not a false home.
 * @param src File contents.
 * @returns The set of IDs found inside JSDoc blocks.
 */
function idsInJsDoc(src) {
  const found = new Set();
  let inDoc = false;
  for (const line of src.split("\n")) {
    if (line.includes("/**")) inDoc = true;
    if (inDoc) for (const m of line.match(ID_RE) ?? []) found.add(m);
    if (line.includes("*/")) inDoc = false;
  }
  return found;
}

/**
 * Collect every invariant ID anywhere in a blob (comments + code).
 * @param text Any text.
 * @returns The set of matched IDs.
 */
function allIds(text) {
  return new Set(text.match(ID_RE) ?? []);
}

/**
 * Read the frozen baseline: trimmed, non-empty, non-`#` lines.
 * @returns The baseline ID set.
 * @throws If the baseline file is missing, or if its entry count deviates from
 * `FROZEN_COUNT` — an emptied, truncated, or unratified-regenerated baseline
 * must FAIL the gate loudly, never shrink it into a silent `PASS: 0/0`.
 */
function readBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(`Missing baseline: ${BASELINE_PATH}`);
  }
  const set = new Set();
  for (const raw of readFileSync(BASELINE_PATH, "utf8").split("\n")) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) set.add(line);
  }
  if (set.size !== FROZEN_COUNT) {
    throw new Error(
      `Baseline has ${set.size} IDs, expected the frozen ${FROZEN_COUNT} (${BASELINE_PATH}). ` +
        `The baseline is corrupted or was regenerated without ratification — restore it from git, ` +
        `or, for a deliberate re-freeze, update FROZEN_COUNT in this script in the same commit.`,
    );
  }
  return set;
}

/**
 * Compute `a \ b` as a sorted array.
 * @param a Minuend set.
 * @param b Subtrahend set.
 * @returns Sorted members of a not in b.
 */
function diffSorted(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

/**
 * Print a labeled, sorted section.
 * @param label Header text.
 * @param ids Sorted ID list.
 */
function report(label, ids) {
  console.log(`\n${label} (${ids.length}):`);
  if (ids.length) console.log("  " + ids.join("\n  "));
}

/**
 * Extract the union of labeled IDs present anywhere in src OR in
 * docs/ARCHITECTURE.md.
 * @remarks The docs scan is load-bearing: some ratified IDs (e.g. `NEW-12`,
 * `NEW-13`) live ONLY in docs — a src-only scan would silently drop them from
 * any regenerated baseline and remove them from all future audits.
 * @returns Sorted unique ID list.
 */
function generateBaseline() {
  const present = new Set();
  for (const file of walkSrc(SRC_DIR)) {
    for (const id of allIds(readFileSync(file, "utf8"))) present.add(id);
  }
  if (existsSync(DOCS_PATH)) {
    for (const id of allIds(readFileSync(DOCS_PATH, "utf8"))) present.add(id);
  }
  return [...present].sort();
}

/**
 * Run the invariant-home diff and set the process exit code.
 * @remarks All three diff legs gate the exit, not just MISSING: in a
 * frozen-baseline world an EXTRA (homed but unbaselined — a typo'd ID in docs
 * or an unratified new ID in JSDoc) and an ORPHAN (present in src but
 * unbaselined) are always defects, and an informational-only leg would let
 * them accumulate silently through the body-comment deletion phases.
 * @returns Nothing; exits 0 iff MISSING, ORPHAN, and EXTRA are all empty.
 */
function run() {
  const home = new Set();
  const present = new Set();
  for (const file of walkSrc(SRC_DIR)) {
    const src = readFileSync(file, "utf8");
    for (const id of idsInJsDoc(src)) home.add(id);
    for (const id of allIds(src)) present.add(id);
  }
  if (existsSync(DOCS_PATH)) {
    for (const id of allIds(readFileSync(DOCS_PATH, "utf8"))) home.add(id);
  }

  const baseline = readBaseline();
  const missing = diffSorted(baseline, home);
  const orphan = diffSorted(present, baseline);
  const extra = diffSorted(home, baseline);

  report("MISSING (baseline - home)", missing);
  report("ORPHAN  (present - baseline)", orphan);
  report("EXTRA   (home - baseline)", extra);

  const defects = missing.length + orphan.length + extra.length;
  console.log(
    `\n${defects === 0 ? "PASS" : "FAIL"}: ${baseline.size - missing.length}/${baseline.size} invariants homed` +
      (missing.length ? ` (${missing.length} missing a home)` : "") +
      (orphan.length || extra.length
        ? ` (${orphan.length} orphan, ${extra.length} extra — unbaselined IDs)`
        : ""),
  );
  process.exit(defects === 0 ? 0 : 1);
}

if (process.argv.includes("--generate-baseline")) {
  console.error(
    "WARNING: --generate-baseline REPLACES the frozen invariant set. Regeneration requires\n" +
      "explicit human intent: ratify the new set, update FROZEN_COUNT in this script in the\n" +
      "same commit, and record the reason in the commit message. (Warning printed to stderr\n" +
      "so redirected stdout stays a clean baseline.)",
  );
  console.log(generateBaseline().join("\n"));
} else {
  run();
}
