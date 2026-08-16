/**
 * Invariant-home audit gate for the Phase 10 knowledge migration (dev tooling,
 * NOT test code): imports no test framework, asserts nothing about app runtime
 * behavior, and lives outside src/ — the same category as eslint.config.ts.
 *
 * It answers two questions as closed-set arithmetic instead of a read-through:
 *
 * 1. Has every invariant ID in the frozen baseline reached a DURABLE home? A
 *    durable home is an ID appearing inside a JSDoc block (/** ... *\/) in
 *    src/**\/*.{ts,tsx} OR anywhere in docs/ARCHITECTURE.md. An ID sitting only in
 *    a // body/line comment does NOT count as homed — that JSDoc-vs-body-comment
 *    distinction (Pattern 2 in 10-RESEARCH.md) is what keeps the gate meaningful
 *    while the original body comments still exist.
 * 2. Has any design literal this project deliberately retired come back into
 *    src/**\/*.{ts,tsx}? See RETIRED_PATTERNS below.
 *
 * Modes:
 *   node scripts/check-invariants.mjs               diff + exit 0 iff MISSING, ORPHAN, EXTRA, and RETIRED are ALL empty
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
 * @remarks Moved from 120 to 121 for the deliberate one-ID terminal-fence
 * re-freeze (`NEW-20`) — see docs/ARCHITECTURE.md#design-system-invariants.
 * @remarks Moved from 121 to 122 for the deliberate one-ID session-projection
 * chokepoint re-freeze (`NEW-21`) — see docs/ARCHITECTURE.md#session-projection-chokepoint.
 */
const FROZEN_COUNT = 122;

const SRC_DIR = "src";
const SKIP_DIR = join("src", "web", "dist");
const DOCS_PATH = join("docs", "ARCHITECTURE.md");
const BASELINE_PATH = join("scripts", "invariant-baseline.txt");
const SYNC_STRIP_PATH = join("src", "web", "features", "sync", "SyncStrip.tsx");
const TOKENS_PATH = join("src", "web", "styles", "tokens.css");
const BOARD_DIR = join("src", "web", "features", "board");
const WEB_DIR = join("src", "web");
const TERMINAL_CLIENT_PATHS = [
  join("src", "web", "terminal-main.ts"),
  join("src", "web", "terminal.html"),
];
const BOARD_STORE_PATH = join("src", "server", "store", "board.store.ts");
const SET_ACTIVE_SESSION_MARKER = "private setActiveSession(";
const SESSION_FIELDS = [
  "tmuxSession",
  "ttydPort",
  "hookToken",
  "claudeSessionId",
  "workspacePath",
  "workspace",
];
const SESSION_FIELD_ASSIGN_RE = new RegExp(
  `(\\w+)\\.(?:${SESSION_FIELDS.join("|")})\\b\\s*=(?![=>])`,
  "g",
);

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
 * Design literals this project deliberately retired during the Phase 84 design-system
 * migration, each replaced by a single named definition. `pattern` is a plain substring, not a
 * regex — every one of these literals contains regex metacharacters, and a substring
 * `includes()` check is both simpler and impossible to get subtly wrong.
 */
const RETIRED_PATTERNS = [
  {
    id: "NEW-15",
    pattern: "0 0 0 2px var(--accent)",
    replacement: "focusRing() in src/web/primitives/focus-ring.ts",
  },
  {
    id: "NEW-16",
    pattern: "0 6px 16px rgba(0,0,0,0.45)",
    replacement: "var(--shadow-float) in src/web/styles/tokens.css",
  },
  {
    id: "NEW-17",
    pattern: "fontWeight: 800",
    replacement: "wordmarkStyle in src/web/primitives/Glyph.tsx",
  },
];

/**
 * Find every line under src/**\/*.{ts,tsx} that still contains a retired design literal.
 * @remarks Scans comments as well as code, deliberately: a comment that reproduces a retired
 * literal is exactly how the pattern gets copied back into real code by the next reader. Only
 * `.ts`/`.tsx` are scanned (via `walkSrc`), so `src/web/styles/tokens.css` can remain the
 * canonical home of the float-shadow value this gate otherwise forbids.
 * @returns Violation report lines, one per matching line.
 */
function checkRetiredPatterns() {
  const violations = [];
  for (const file of walkSrc(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const { id, pattern, replacement } of RETIRED_PATTERNS) {
        if (line.includes(pattern)) {
          violations.push(
            `${file}:${i + 1}: retired pattern ${id} — use ${replacement}`,
          );
        }
      }
    });
  }
  return violations;
}

/**
 * The two sync-strip token cascades `SyncStrip.tsx` consumes, each asserted at both ends: the
 * component reads the token, and `tokens.css` defines the wide value in `:root` plus the narrow
 * value inside the 767px block.
 */
const STRIP_CASCADES = [
  {
    token: "--strip-padding",
    consumer: 'padding: "0 var(--strip-padding)"',
    wide: "--strip-padding: 24px;",
    narrow: "--strip-padding: 16px;",
    what: "strip padding",
  },
  {
    token: "--strip-grid-columns",
    consumer: 'gridTemplateColumns: "var(--strip-grid-columns)"',
    wide: "--strip-grid-columns: minmax(0, 1fr) auto minmax(0, 1fr);",
    narrow: "--strip-grid-columns: auto auto minmax(0, 1fr);",
    what: "the strip zone grid",
  },
];

/**
 * File-scoped strip-cascade gate (`NEW-18`). Deliberately NOT a `RETIRED_PATTERNS` entry: the
 * retired 16px padding literal below is a legitimate value in eight other files, so a global scan
 * would false-positive on all of them — this reads only `SyncStrip.tsx`, where that same literal is
 * a retired regression back to the strip's hardcoded pre-cascade padding. See
 * docs/ARCHITECTURE.md#app-shell-zones for the durable home.
 * @remarks Asserts the MECHANISM, not just the absence of the retired literal. A check that only
 * fenced the retired literal would pass unchanged against any implementation at all — including one
 * that silently reverted a cascade to a flat inline value — so it could never fail for the reason
 * it exists. Both cascades are covered, because both encode a measured narrow-viewport fix that an
 * inline value would erase while still rendering correctly at desktop widths, where it would go
 * unnoticed.
 * @returns Violation report lines, one per defect; a single line if a subject file is missing.
 */
function checkStripCascades() {
  if (!existsSync(SYNC_STRIP_PATH)) {
    return [
      `${SYNC_STRIP_PATH}: file not found — NEW-18 cannot verify the strip cascades`,
    ];
  }
  if (!existsSync(TOKENS_PATH)) {
    return [
      `${TOKENS_PATH}: file not found — NEW-18 cannot verify the strip cascades`,
    ];
  }
  const violations = [];
  const strip = readFileSync(SYNC_STRIP_PATH, "utf8");
  strip.split("\n").forEach((line, i) => {
    if (line.includes('padding: "0 var(--space-lg)"')) {
      violations.push(
        `${SYNC_STRIP_PATH}:${i + 1}: retired pattern NEW-18 — strip padding must read var(--strip-padding)`,
      );
    }
  });

  const tokens = readFileSync(TOKENS_PATH, "utf8");
  const rootBlock = tokens.slice(0, tokens.indexOf("@media"));
  const narrowStart = tokens.indexOf("@media (max-width: 767px)");
  const narrowBlock =
    narrowStart === -1
      ? ""
      : tokens.slice(narrowStart, tokens.indexOf("}\n}", narrowStart));

  for (const cascade of STRIP_CASCADES) {
    if (!strip.includes(cascade.consumer)) {
      violations.push(
        `${SYNC_STRIP_PATH}: retired pattern NEW-18 — ${cascade.what} must read var(${cascade.token})`,
      );
    }
    if (!rootBlock.includes(cascade.wide)) {
      violations.push(
        `${TOKENS_PATH}: retired pattern NEW-18 — :root must define ${cascade.wide.replace(/;$/, "")}`,
      );
    }
    if (!narrowBlock.includes(cascade.narrow)) {
      violations.push(
        `${TOKENS_PATH}: retired pattern NEW-18 — the max-width: 767px block must step ${cascade.narrow.replace(/;$/, "")}`,
      );
    }
  }
  return violations;
}

/**
 * Directory-scoped board reading-rhythm gate (`NEW-19`). Deliberately NOT a `RETIRED_PATTERNS`
 * entry: that array scans all of `src/**`, and `.reading-surface` is legitimately used outside
 * `board/` (`Modal.tsx`, `DetailPanel.tsx`) — a global scan would false-positive on both.
 * @remarks Quotes are stripped from each line before matching because a `.tsx` inline-style
 * override is written with a quoted custom-property key (`"--line-body": "1.6"`), so the raw
 * `--line-body:` declaration form never appears verbatim — stripping `"`/`'` first normalizes
 * that form to the same shape as a plain CSS declaration.
 * @remarks `var(--line-body)` CONSUMPTION is deliberately permitted, not fenced: the token
 * resolves to 1.5 globally and only the `.reading-surface` class lifts it to 1.6
 * (`src/web/styles/tokens.css`), and `docs/standards/design-contract.md`'s Typography table
 * names `--line-body` as the card title's own mandated line height — barring consumption would
 * force a card-height change, which criterion 2 forbids outright.
 * @see docs/ARCHITECTURE.md#design-system-invariants
 * @returns Violation report lines, one per matching line; a single line if the directory is missing.
 */
function checkBoardReadingRhythm() {
  if (!existsSync(BOARD_DIR)) {
    return [
      `${BOARD_DIR}: directory not found — NEW-19 cannot verify board surfaces`,
    ];
  }
  const violations = [];
  for (const file of walkSrc(BOARD_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const stripped = line.replaceAll('"', "").replaceAll("'", "");
      if (stripped.includes("reading-surface")) {
        violations.push(
          `${file}:${i + 1}: retired pattern NEW-19 — the .reading-surface class is barred from src/web/features/board/`,
        );
      }
      if (stripped.includes("--line-body:")) {
        violations.push(
          `${file}:${i + 1}: retired pattern NEW-19 — a local --line-body redefinition is barred from src/web/features/board/`,
        );
      }
    });
  }
  return violations;
}

/**
 * File-scoped embedded-terminal-client fence (`NEW-20`). The fenced subject is exactly
 * `TERMINAL_CLIENT_PATHS` — there is no terminal-client directory on disk, so this names paths
 * rather than a glob. `TerminalRegion.tsx` (the panel container that renders the terminal
 * `<iframe>`) is a different file and is NOT fenced.
 * @remarks This leg detects the fence's SUBJECT SET silently changing — a rename, a deletion, or
 * a new sibling terminal-client file appearing beside the fenced two. It does NOT and CANNOT
 * detect an edit to the CONTENTS of a fenced file: `check-invariants.mjs`'s entire mechanism is
 * point-in-time pattern matching against the current tree, with zero `git diff`/`execSync` calls
 * anywhere in this file. Proving the fenced files' CONTENTS are unchanged since a given commit is
 * a separate, on-demand `git diff <base-sha>..HEAD -- src/web/terminal-main.ts
 * src/web/terminal.html` run — see docs/ARCHITECTURE.md#design-system-invariants for the split.
 * @see docs/ARCHITECTURE.md#design-system-invariants
 * @returns Violation report lines: a missing/renamed fenced path (SUBJECT PRESENT), or a new
 * `terminal*` sibling file outside the fence (SUBJECT COMPLETE).
 */
function checkTerminalFence() {
  const violations = [];
  for (const path of TERMINAL_CLIENT_PATHS) {
    if (!existsSync(path)) {
      violations.push(
        `${path}: file not found — NEW-20's fenced terminal-client subject is missing or renamed`,
      );
    }
  }
  if (existsSync(WEB_DIR)) {
    for (const entry of readdirSync(WEB_DIR)) {
      if (!entry.startsWith("terminal")) continue;
      const full = join(WEB_DIR, entry);
      if (!TERMINAL_CLIENT_PATHS.includes(full)) {
        violations.push(
          `${full}: retired pattern NEW-20 — a new embedded-terminal-client file appeared outside the fenced set`,
        );
      }
    }
  }
  return violations;
}

/**
 * Locate `setActiveSession`'s own method body inside `board.store.ts` by brace-counting from its
 * declaration marker — the same plain-text marker-slice idiom `checkStripCascades` uses for the
 * narrow-viewport `@media` block, not an AST parse. The method's parameter types contain no
 * braces of their own, so the FIRST `{` found after the marker is reliably the method's opening
 * brace; depth-counting from there to the matching `}` needs no knowledge of the method's contents.
 * @param content Full text of `board.store.ts`.
 * @returns `[startIndex, endIndex]` character offsets spanning the marker through the method's
 * closing brace (inclusive), or `null` if the marker is missing.
 */
function sliceSetActiveSessionBody(content) {
  const markerIdx = content.indexOf(SET_ACTIVE_SESSION_MARKER);
  if (markerIdx === -1) return null;
  const braceStart = content.indexOf("{", markerIdx);
  if (braceStart === -1) return null;
  let depth = 0;
  for (let i = braceStart; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return [markerIdx, i];
    }
  }
  return null;
}

/**
 * Find every `<receiver>.<sessionField> =` assignment in a file's text, one line at a time.
 * @remarks The `(?![=>])` guard immediately after the required `=` rejects `==`/`===`/`=>` — a
 * `!=`/`!==`/`<=`/`>=` comparison never reaches that guard at all, because the character
 * immediately after the field name (once whitespace is skipped) is `!`/`<`/`>`, not the literal
 * `=` this pattern anchors on, so those comparisons fail to match in the first place. The `\b`
 * after the field alternation is load-bearing: without it `workspace` would falsely match as a
 * prefix of `workspaceFolders`/`workspacePath`, and `hookToken`/`hookRoutedAt` would otherwise
 * rely on lucky non-overlap instead of an asserted boundary.
 * @param content Full file text.
 * @returns One entry per match: its 1-based line number, absolute character offset into
 * `content` (for the tier-2 slice-containment check), and the receiver identifier text (so
 * `ctx.workspacePath` — `SagaContext`'s own unrelated field, not `card.workspacePath` — can be
 * excluded by name).
 */
function scanSessionFieldAssignments(content) {
  const results = [];
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = new RegExp(SESSION_FIELD_ASSIGN_RE.source, "g");
    let m;
    while ((m = re.exec(line))) {
      results.push({
        lineNumber: i + 1,
        charOffset: offset + m.index,
        receiver: m[1],
      });
    }
    offset += line.length + 1;
  }
  return results;
}

/**
 * Session-projection chokepoint gate (`NEW-21`): the six flat session fields on `Card` —
 * `tmuxSession`, `ttydPort`, `hookToken`, `claudeSessionId`, `workspacePath`, `workspace` — are a
 * projection of the card's active session, and `board.store.ts#setActiveSession` is the ONLY
 * method allowed to assign them. This is a TWO-TIER check because all sixteen legitimate write
 * sites live in one file: Tier 1 is a repo-wide fence (any match outside
 * `src/server/store/board.store.ts` is a violation by construction — that file is never even
 * inspected for scope, it is simply not the owner), and Tier 2 is an in-file slice (inside
 * `board.store.ts`, only a match falling within `setActiveSession`'s own body, located by
 * {@link sliceSetActiveSessionBody}, is exempt — "the write lives in the owner file" is not by
 * itself sufficient to pass).
 * @remarks Three deliberate scope exclusions, each because firing on it would be a permanent
 * false positive that trains the gate to be ignored: (1) `ctx.workspacePath` in
 * `src/server/services/orchestration/steps.ts` is `SagaContext`'s own plain string field on an
 * orchestration-local object, not `card.workspacePath` — excluded by receiver identifier name.
 * (2) `hookRoutedAt` and `branch` are Card-only fields this phase deliberately left outside the
 * chokepoint's scope; neither is a substring of any of the six field names (the `\b` boundary in
 * {@link scanSessionFieldAssignments} makes this an assertion, not luck). (3) Object-literal
 * properties (`tmuxSession: value` inside `{ … }`) never match — the pattern requires a leading
 * `.`, which a colon-form property never has.
 * @remarks This is a plain line-scan + marker-slice, deliberately not an AST/compiler-API pass —
 * every other leg in this file works the same way, and a parser here would be the first of its
 * kind in the file (no new dependency).
 * @remarks If `setActiveSession`'s declaration marker cannot be found (renamed, deleted), this
 * emits a missing-subject sentinel rather than silently reporting zero violations — the exact
 * dead-instrument failure mode v2.9's audit found nine of, three of them in this milestone's own
 * prior plans. A rule whose subject vanished must FAIL, never pass vacuously.
 * @see docs/ARCHITECTURE.md#session-projection-chokepoint
 * @returns Violation report lines, one per illegal assignment, plus the missing-subject sentinel
 * if `setActiveSession` cannot be located.
 */
function checkSessionProjectionChokepoint() {
  const violations = [];
  const boardStoreContent = existsSync(BOARD_STORE_PATH)
    ? readFileSync(BOARD_STORE_PATH, "utf8")
    : null;
  const slice =
    boardStoreContent !== null
      ? sliceSetActiveSessionBody(boardStoreContent)
      : null;

  if (boardStoreContent === null || slice === null) {
    violations.push(
      `${BOARD_STORE_PATH}: setActiveSession not found — NEW-21's projection-chokepoint subject is missing or renamed`,
    );
  }

  for (const file of walkSrc(SRC_DIR)) {
    const content =
      file === BOARD_STORE_PATH
        ? boardStoreContent
        : readFileSync(file, "utf8");
    if (content === null) continue;
    for (const match of scanSessionFieldAssignments(content)) {
      if (match.receiver === "ctx") continue;
      if (file === BOARD_STORE_PATH) {
        if (
          slice &&
          match.charOffset >= slice[0] &&
          match.charOffset <= slice[1]
        ) {
          continue;
        }
        violations.push(
          `${file}:${match.lineNumber}: retired pattern NEW-21 — flat session-field assignment outside setActiveSession, the sole projection chokepoint`,
        );
      } else {
        violations.push(
          `${file}:${match.lineNumber}: retired pattern NEW-21 — flat session-field assignment outside the projection chokepoint (${BOARD_STORE_PATH}#setActiveSession)`,
        );
      }
    }
  }
  return violations;
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
 * Run the invariant-home diff, the global retired-pattern scan, the file-scoped
 * strip-cascade check, the directory-scoped board reading-rhythm check, the
 * file-scoped terminal-client fence, and the session-projection chokepoint
 * check, then set the process exit code.
 * @remarks All six diff legs gate the exit, not just MISSING: in a
 * frozen-baseline world an EXTRA (homed but unbaselined — a typo'd ID in docs
 * or an unratified new ID in JSDoc) and an ORPHAN (present in src but
 * unbaselined) are always defects, and an informational-only leg would let
 * them accumulate silently through the body-comment deletion phases. The
 * retired-pattern leg, the strip-cascade leg, the board reading-rhythm leg,
 * the terminal-fence leg, and the session-projection chokepoint leg are all
 * independent of the ID-baseline arithmetic above — a design literal coming
 * back, the terminal-client subject set changing, or a flat session field
 * being assigned outside its sole chokepoint is a defect regardless of
 * whether any invariant ID also moved. The strip-cascade leg (`NEW-18`), the
 * board reading-rhythm leg (`NEW-19`), the terminal-fence leg (`NEW-20`), and
 * the session-projection chokepoint leg (`NEW-21`) are all deliberately
 * scoped (file- or directory-scoped) rather than folded into
 * `RETIRED_PATTERNS`, since each pattern is legitimate outside its own scope.
 * The terminal-fence leg only proves the fenced SUBJECT SET is intact — it
 * cannot prove the fenced files' CONTENTS are unchanged; see
 * `checkTerminalFence`'s own JSDoc for the split. See
 * `checkSessionProjectionChokepoint`'s own JSDoc for its two-tier fence/slice
 * split and its missing-subject sentinel.
 * @returns Nothing; exits 0 iff MISSING, ORPHAN, EXTRA, RETIRED, STRIP
 * CASCADES, BOARD READING RHYTHM, TERMINAL FENCE, and SESSION PROJECTION
 * CHOKEPOINT are all empty.
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
  const retired = checkRetiredPatterns();
  const stripCascades = checkStripCascades();
  const boardReadingRhythm = checkBoardReadingRhythm();
  const terminalFence = checkTerminalFence();
  const sessionChokepoint = checkSessionProjectionChokepoint();

  report("MISSING (baseline - home)", missing);
  report("ORPHAN  (present - baseline)", orphan);
  report("EXTRA   (home - baseline)", extra);
  report("RETIRED (design literals that came back)", retired);
  report("STRIP CASCADES (NEW-18)", stripCascades);
  report("BOARD READING RHYTHM (NEW-19)", boardReadingRhythm);
  report("TERMINAL FENCE (NEW-20)", terminalFence);
  report("SESSION PROJECTION CHOKEPOINT (NEW-21)", sessionChokepoint);

  const defects =
    missing.length +
    orphan.length +
    extra.length +
    retired.length +
    stripCascades.length +
    boardReadingRhythm.length +
    terminalFence.length +
    sessionChokepoint.length;
  console.log(
    `\n${defects === 0 ? "PASS" : "FAIL"}: ${baseline.size - missing.length}/${baseline.size} invariants homed` +
      (missing.length ? ` (${missing.length} missing a home)` : "") +
      (orphan.length || extra.length
        ? ` (${orphan.length} orphan, ${extra.length} extra — unbaselined IDs)`
        : "") +
      (retired.length
        ? ` (${retired.length} retired pattern(s) reappeared)`
        : "") +
      (stripCascades.length
        ? ` (${stripCascades.length} strip-cascade regression(s))`
        : "") +
      (boardReadingRhythm.length
        ? ` (${boardReadingRhythm.length} board reading-rhythm regression(s))`
        : "") +
      (terminalFence.length
        ? ` (${terminalFence.length} terminal-fence regression(s))`
        : "") +
      (sessionChokepoint.length
        ? ` (${sessionChokepoint.length} session-projection-chokepoint violation(s))`
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
