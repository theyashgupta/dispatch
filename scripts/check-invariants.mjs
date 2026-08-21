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
import ts from "typescript";

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
 * @remarks Moved from 122 to 123 for the deliberate one-ID attention single-source
 * re-freeze (`NEW-22`) — see docs/ARCHITECTURE.md#design-system-invariants.
 * @remarks Moved from 123 to 124 for the deliberate one-ID exec-chokepoint perf-record
 * mitigation re-freeze (`T-98-05`), see docs/ARCHITECTURE.md#exec-chokepoint.
 */
const FROZEN_COUNT = 124;

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
const CARD_ATTENTION_PATH = join(
  "src",
  "web",
  "features",
  "board",
  "card-attention.ts",
);

/**
 * The three `Card` fields the attention predicate is composed of. An ATTENTION CLAIM is a boolean
 * expression that ORs two or more of them together — "this card needs a human" — and
 * `card-attention.ts` must be the only place one is computed.
 * @remarks Two is the threshold, not three, because a duplication that drops a condition is worse
 * than one that copies all three: it is a predicate that silently disagrees with the shared one.
 */
const ATTENTION_FIELDS = ["startError", "sessionLost", "cleanupBlocked"];

/**
 * The two functions that together ARE the shared predicate. `NEW-22`'s single-definition half
 * asserts no `src/web` file other than {@link CARD_ATTENTION_PATH} declares either.
 */
const ATTENTION_EXPORTS = ["needsAttention", "attentionTitle"];
const STEPS_PATH = join(
  "src",
  "server",
  "services",
  "orchestration",
  "steps.ts",
);

/**
 * The six flat session fields on `Card`. These are a PROJECTION of the card's active session
 * record — derived convenience, not truth.
 */
const PROJECTION_FIELDS = [
  "tmuxSession",
  "ttydPort",
  "hookToken",
  "claudeSessionId",
  "workspacePath",
  "workspace",
];

/**
 * The two fields whose PAIRING is invariant `NEW-21` itself: a card is never observable with
 * `sessions` set and no `activeSessionId`, and `activeSessionId` never names a session absent from
 * `sessions`. Fencing only {@link PROJECTION_FIELDS} would police the derived convenience while
 * leaving the actual correctness property open to any future writer.
 */
const ENTITY_FIELDS = ["sessions", "activeSessionId"];

const SESSION_FIELDS = [...PROJECTION_FIELDS, ...ENTITY_FIELDS];

/**
 * The DECLARED writers of the fenced fields, each with the exact subset it is allowed to write.
 * Every other write anywhere in `src/` is a violation. Two properties make this a carve-out rather
 * than a blind spot: each entry is greppable by name, and each carries its own missing-subject
 * sentinel (see {@link checkSessionProjectionChokepoint}) so a rename or deletion FAILS instead of
 * silently widening the exemption to nothing.
 * @remarks `migrateCardsToSessionEntity` and `removeSessionRecord` are each deliberately allowed
 * ONLY {@link ENTITY_FIELDS}. Both contracts say "never writes any projection field"; granting
 * either the six projection fields too would turn a documented promise into an unenforced one.
 * `removeSessionRecord` (Phase 93) owns cleaned-session removal and active-pointer repair,
 * delegating every projection write it needs back to `setActiveSession`.
 */
const SANCTIONED_WRITERS = [
  { name: "setActiveSession", fields: SESSION_FIELDS },
  { name: "migrateCardsToSessionEntity", fields: ENTITY_FIELDS },
  { name: "removeSessionRecord", fields: ENTITY_FIELDS },
];

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
 * Every OR-expression in a parsed file that combines two or more distinct {@link ATTENTION_FIELDS}
 * — the shape of an independently-computed attention claim.
 * @remarks Reports only the OUTERMOST operator of a chain: `a || b || c` parses as `(a || b) || c`,
 * so without the parent check one duplication would report twice and the count would read as two
 * separate sites.
 * @remarks `??` counts alongside `||`. It is a strange way to write this predicate, but it is a
 * disjunction, and a rule that a one-character edit escapes is not a fence.
 * @param sourceFile Parsed file.
 * @returns One entry per claim: 1-based line number and the sorted field names it combined.
 */
function attentionClaims(sourceFile) {
  const claims = [];
  const isDisjunction = (node) =>
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken);

  const fieldsWithin = (node) => {
    const found = new Set();
    const walk = (n) => {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) {
        if (ATTENTION_FIELDS.includes(n.name.text)) found.add(n.name.text);
      } else if (
        ts.isElementAccessExpression(n) &&
        n.argumentExpression &&
        ts.isStringLiteralLike(n.argumentExpression) &&
        ATTENTION_FIELDS.includes(n.argumentExpression.text)
      ) {
        found.add(n.argumentExpression.text);
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };

  const visit = (node) => {
    if (isDisjunction(node) && !isDisjunction(node.parent)) {
      const fields = fieldsWithin(node);
      if (fields.size >= 2) {
        claims.push({
          lineNumber:
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
              .line + 1,
          fields: [...fields].sort(),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return claims;
}

/**
 * Attention single-source fence (`NEW-22`). Two halves, because the property has two halves:
 * the shared predicate has exactly one DEFINITION, and no other `src/web` file computes the
 * PREDICATE independently.
 * @remarks (`WR-02`) The predecessor censused files whose text merely CONTAINED the identifiers
 * `needsAttention`/`attentionTitle` against a closed expected list, which got the subject exactly
 * backwards on both sides. An independent computation is by definition one that does NOT reference
 * the shared helper, so it was invisible; meanwhile a new surface that correctly IMPORTED the
 * single source turned the build red until someone widened the list — a check that fires on the
 * good event and stays silent on the bad one. Real sites it could not see were already present
 * (`card-badges.ts`, `DetailPanel.tsx`, `App.tsx`). This is the same shape as Phase 90's `NEW-21`,
 * which shipped fenced against the wrong subject and reported PASS.
 * @remarks Consumers are deliberately UNRESTRICTED now. Importing the single source is the
 * behaviour this invariant wants, so it must never be what fails the build; the closed consumer
 * census is gone rather than merely widened.
 * @remarks The carve-out is the DEFINITION file only, and it is a carve-out rather than a blind
 * spot because {@link ATTENTION_EXPORTS}' own missing-subject sentinel makes a rename or deletion
 * FAIL instead of silently exempting nothing. Conjunctions are NOT claims: `card.sessionLost !==
 * true && isUnseen(…)` (`card-badges.ts`, deriving an activity dot), `c.tmuxSession &&
 * !c.sessionLost` (`DetailPanel.tsx`, deriving liveness), and `card.column !== "todo" &&
 * card.sessionLost !== true` (`App.tsx`, gating start-eligibility) each narrow ONE attention field
 * with unrelated state to make a different claim — a dot is not an attention ring — so fencing
 * them would be the cry-wolf failure in a new costume.
 * @remarks The definition half fences EXPORTED declarations only. `CardView.tsx` binds the shared
 * result to a local `const needsAttention` (the import is aliased `getNeedsAttention`), which is a
 * consumer, not a rival — flagging it would fire on the single source's own correct use. A
 * file-local rival that is never exported is left to the claim half below, which is what has the
 * teeth: if it does not OR two attention fields it is not this predicate, and if it does, it is
 * caught regardless of what it is named or whether it is exported.
 * @remarks Known residue, recorded rather than left implied: a duplication written as a ternary
 * chain or an `ATTENTION_FIELDS.some(…)` table is not a disjunction and is not detected. Closing
 * that needs type information this parse-only pass does not have.
 * @see docs/ARCHITECTURE.md#design-system-invariants
 * @returns Violation report lines: the missing-subject sentinel(s) if the definitions are gone or
 * renamed, one per rival definition, and one per independently-computed attention claim.
 */
function checkAttentionSingleSource() {
  const violations = [];
  if (!existsSync(CARD_ATTENTION_PATH)) {
    violations.push(
      `${CARD_ATTENTION_PATH}: file not found — NEW-22's attention-predicate subject is missing or renamed`,
    );
  } else {
    const content = readFileSync(CARD_ATTENTION_PATH, "utf8");
    for (const name of ATTENTION_EXPORTS) {
      if (!content.includes(`export function ${name}`)) {
        violations.push(
          `${CARD_ATTENTION_PATH}: export function ${name} not found — NEW-22's attention-predicate subject is missing or renamed`,
        );
      }
    }
  }

  for (const file of walkSrc(WEB_DIR)) {
    if (file === CARD_ATTENTION_PATH) continue;
    const content = readFileSync(file, "utf8");

    for (const name of ATTENTION_EXPORTS) {
      if (
        new RegExp(`export\\s+(?:function|const|let|var)\\s+${name}\\b`).test(
          content,
        )
      ) {
        violations.push(
          `${file}: retired pattern NEW-22 — exports a rival ${name}; the attention predicate has exactly one definition, in ${CARD_ATTENTION_PATH}`,
        );
      }
    }

    for (const claim of attentionClaims(parseSource(file, content))) {
      violations.push(
        `${file}:${claim.lineNumber}: retired pattern NEW-22 — computes an attention claim independently (ORs ${claim.fields.join(" + ")}); import needsAttention/attentionTitle from ${CARD_ATTENTION_PATH} instead`,
      );
    }
  }
  return violations;
}

/**
 * Parse one `src/` file with the TypeScript compiler's own parser.
 * @remarks This is the ONE leg in this file that parses rather than pattern-matches, and the
 * reason is specific: the chokepoint leg is the only rule here whose subject is a mutation rather
 * than a literal, and a mutation has too many surface forms for a line scan to enumerate — a
 * line-scan predecessor was blind to `Object.assign(card, { … })`, which is the very idiom
 * `setActiveSession` uses internally, so the rule could not see its own house style. `typescript`
 * is already a devDependency (`npm run typecheck`), so this adds no dependency.
 * @param file Path, used for the AST's file name and to pick the TSX scanner.
 * @param content Full file text.
 * @returns The parsed source file, with parent pointers set.
 */
function parseSource(file, content) {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : file.endsWith(".mjs")
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS,
  );
}

/**
 * Map every named function and method declaration in a parsed file to its full character span.
 * @remarks Replaces a brace-counting text slice, which had a silent-failure direction: an
 * unbalanced `{` inside a string literal or comment in a sanctioned writer's body would have
 * extended the exempt span PAST its real closing brace, silently exempting every method after it.
 * A parser cannot be confused by a brace in a string.
 * @param sourceFile Parsed file.
 * @returns Map of declaration name to `[start, end]` character offsets.
 */
function declarationSpans(sourceFile) {
  const spans = new Map();
  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      spans.set(node.name.text, [node.getStart(sourceFile), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return spans;
}

/**
 * Is this operator token any form of assignment (`=`, `+=`, `??=`, …)?
 * @remarks The `FirstAssignment`/`LastAssignment` range is a contiguous block in `ts.SyntaxKind`
 * that includes the logical-assignment operators and excludes `==`/`===`/`=>` — the three forms
 * the predecessor regex needed an explicit `(?![=>])` guard to reject.
 * @param kind A `ts.SyntaxKind`.
 * @returns True for assignment operators only.
 */
function isAssignmentToken(kind) {
  return (
    kind >= ts.SyntaxKind.FirstAssignment &&
    kind <= ts.SyntaxKind.LastAssignment
  );
}

/**
 * Find every write to a fenced session field in a parsed file, across all four mutation forms the
 * rule can see: plain and compound assignment (`card.ttydPort = p`, `card.ttydPort ??= p`),
 * computed member assignment (`card["ttydPort"] = p`), destructuring assignment
 * (`({ ttydPort: card.ttydPort } = fields)`, including array and defaulted forms), and
 * `Object.assign(card, { ttydPort })` with a literal source object. Increment/decrement
 * (`card.ttydPort++`) counts too.
 * @remarks TWO forms are deliberately NOT detected, and neither can be closed without type
 * information this parse-only pass does not have. (1) `Object.assign(card, opaqueVariable)` — the
 * source object's keys are unknown without resolving the variable; flagging every `Object.assign`
 * with a non-literal source would fire on unrelated call sites and train the gate to be ignored.
 * (2) `delete card.hookToken` — `redactCard` legitimately deletes `hookToken` and `sessions` from
 * its own shallow copy on every snapshot, so detecting deletion would be a permanent false
 * positive on the redaction chokepoint itself. Both residues are recorded here rather than left
 * implied, because an undocumented gap reads as coverage.
 * @param sourceFile Parsed file.
 * @returns One entry per write: 1-based line number, character offset (for the tier-2
 * span-containment check), the receiver's source text (so `ctx.workspacePath` — `SagaContext`'s
 * own unrelated field, not `card.workspacePath` — can be excluded by name), and the fenced field
 * name (so a sanctioned writer can be granted a SUBSET of the fenced fields, not all of them).
 */
function scanSessionFieldAssignments(sourceFile) {
  const results = [];
  const record = (node, field, receiver) => {
    const pos = node.getStart(sourceFile);
    results.push({
      lineNumber: sourceFile.getLineAndCharacterOfPosition(pos).line + 1,
      charOffset: pos,
      receiver,
      field,
    });
  };

  const recordTarget = (node) => {
    if (ts.isParenthesizedExpression(node)) {
      recordTarget(node.expression);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      recordTarget(node.left);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      SESSION_FIELDS.includes(node.name.text)
    ) {
      record(node, node.name.text, node.expression.getText(sourceFile));
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      SESSION_FIELDS.includes(node.argumentExpression.text)
    ) {
      record(
        node,
        node.argumentExpression.text,
        node.expression.getText(sourceFile),
      );
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) recordTarget(prop.initializer);
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) recordTarget(element);
    }
  };

  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      isAssignmentToken(node.operatorToken.kind)
    ) {
      recordTarget(node.left);
    } else if (
      (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      recordTarget(node.operand);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Object" &&
      node.expression.name.text === "assign" &&
      node.arguments.length > 0
    ) {
      const receiver = node.arguments[0].getText(sourceFile);
      for (const arg of node.arguments.slice(1)) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const prop of arg.properties) {
          if (
            !ts.isPropertyAssignment(prop) &&
            !ts.isShorthandPropertyAssignment(prop)
          ) {
            continue;
          }
          const name =
            ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)
              ? prop.name.text
              : null;
          if (name && SESSION_FIELDS.includes(name)) {
            record(prop, name, receiver);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return results;
}

/**
 * Session-projection chokepoint gate (`NEW-21`). The fenced set is EIGHT fields, in two groups
 * that fail differently: the six {@link PROJECTION_FIELDS} (a derived mirror of the card's active
 * session) and the two {@link ENTITY_FIELDS} `sessions`/`activeSessionId`, whose PAIRING is the
 * invariant itself. Fencing only the projection would leave any future writer free to set
 * `sessions` with no pointer, or to repoint `activeSessionId` at a session that is not in the
 * array, and still pass green.
 * @remarks This is a TWO-TIER check because every legitimate write site lives in one file: Tier 1
 * is a repo-wide fence (any match outside `src/server/store/board.store.ts` is a violation by
 * construction — that file is never even inspected for scope, it is simply not the owner), and
 * Tier 2 is an in-file slice (inside `board.store.ts`, a match is exempt only when it falls within
 * a {@link SANCTIONED_WRITERS} body, located by {@link declarationSpans}, AND the field it writes
 * is in that writer's own allowed subset — "the write lives in the owner file" is not by itself
 * sufficient to pass, and neither is "the write lives in a sanctioned writer").
 * @remarks Three deliberate scope exclusions, each because firing on it would be a permanent
 * false positive that trains the gate to be ignored: (1) `ctx.workspacePath` in
 * `src/server/services/orchestration/steps.ts` is `SagaContext`'s own plain string field on an
 * orchestration-local object, not `card.workspacePath`. That exclusion is FILE-SCOPED to
 * `steps.ts`: as a bare repo-wide identifier exemption it would have let any file in `src/` name a
 * `Card`-holding variable `ctx` — one of the commonest identifiers in an Express/saga codebase —
 * and write every fenced field on it with zero resistance. (2) `hookRoutedAt` and `branch` are
 * Card-only fields this phase deliberately left outside the chokepoint's scope; a parsed property
 * name matches whole, so neither can collide with a fenced name. (3) Object-literal properties
 * (`tmuxSession: value` inside a plain `{ … }`) are not writes to a card and never match — only a
 * destructuring TARGET or an `Object.assign` source object is treated as one.
 * @remarks See {@link scanSessionFieldAssignments} for the four mutation forms this covers and the
 * two it deliberately does not.
 * @remarks If a sanctioned writer's declaration cannot be found (renamed, deleted), this
 * emits a missing-subject sentinel rather than silently reporting zero violations — the exact
 * dead-instrument failure mode v2.9's audit found nine of, three of them in this milestone's own
 * prior plans. A rule whose subject vanished must FAIL, never pass vacuously. Each sanctioned
 * writer carries its OWN sentinel, so widening the carve-out by deleting one of them fails loudly.
 * @see docs/ARCHITECTURE.md#session-projection-chokepoint
 * @returns Violation report lines, one per illegal assignment, plus one missing-subject sentinel
 * per sanctioned writer that cannot be located.
 */
function checkSessionProjectionChokepoint() {
  const violations = [];
  const boardStoreContent = existsSync(BOARD_STORE_PATH)
    ? readFileSync(BOARD_STORE_PATH, "utf8")
    : null;

  const boardStoreSpans =
    boardStoreContent !== null
      ? declarationSpans(parseSource(BOARD_STORE_PATH, boardStoreContent))
      : new Map();

  const writers = [];
  for (const writer of SANCTIONED_WRITERS) {
    const slice = boardStoreSpans.get(writer.name);
    if (slice === undefined) {
      violations.push(
        `${BOARD_STORE_PATH}: ${writer.name} not found — NEW-21's projection-chokepoint subject is missing or renamed`,
      );
      continue;
    }
    writers.push({ ...writer, slice });
  }

  for (const file of walkSrc(SRC_DIR)) {
    const content =
      file === BOARD_STORE_PATH
        ? boardStoreContent
        : readFileSync(file, "utf8");
    if (content === null) continue;
    for (const match of scanSessionFieldAssignments(
      parseSource(file, content),
    )) {
      if (file === STEPS_PATH && match.receiver === "ctx") continue;
      if (file === BOARD_STORE_PATH) {
        const owner = writers.find(
          (w) =>
            match.charOffset >= w.slice[0] &&
            match.charOffset <= w.slice[1] &&
            w.fields.includes(match.field),
        );
        if (owner) continue;
        violations.push(
          `${file}:${match.lineNumber}: retired pattern NEW-21 — \`${match.field}\` assigned outside the sanctioned writers (${SANCTIONED_WRITERS.map((w) => w.name).join(", ")})`,
        );
      } else {
        violations.push(
          `${file}:${match.lineNumber}: retired pattern NEW-21 — \`${match.field}\` assigned outside the projection chokepoint (${BOARD_STORE_PATH}#setActiveSession)`,
        );
      }
    }
  }
  return violations;
}

/**
 * The sandbox harnesses that may only ever READ launchd. A sandboxed `HOME` redirects the plist
 * file and `~/.dispatch`, but `launchctl bootstrap`'s `gui/<uid>/<Label>` registration is a real,
 * per-user OS registry, so any mutating verb from inside a harness would clobber the researcher's
 * own live `com.dispatch.app` agent regardless of the sandbox.
 */
const LAUNCHCTL_READONLY_HARNESSES = [
  join("scripts", "reinstall-sim.mjs"),
  join("scripts", "session-liveness-v3.mjs"),
];

/**
 * launchctl-read-only gate over {@link LAUNCHCTL_READONLY_HARNESSES}, two arms over the AST. Arm 1,
 * the binary: a string literal whose text is `launchctl` or ends in `/launchctl` must be the first
 * argument of a call whose second argument is an array literal starting with `"print"`. Arm 2, the
 * command string: any other string or template literal whose text contains the token `launchctl`
 * (an `execSync` one-liner, a `sh -c` payload, a message) must follow EVERY occurrence inline with
 * `print`. Comments are never matched because the walk is over the AST, not the text.
 * @remarks Requiring the verb INLINE is deliberate: a `spawnSync("launchctl", args)` whose verb
 * lives in a variable cannot be audited by a pattern gate, and a gate that cannot see the verb
 * cannot fail for the reason it exists. Arm 2 exists because arm 1 alone was blind to the most
 * idiomatic shell form, `execSync("launchctl bootout ...")`. Out of scope on purpose: a binary
 * assembled at runtime (`"launch" + "ctl"`), which is evasion rather than accident.
 * @returns Violation report lines, one per offending occurrence, with line numbers from the original
 * buffer.
 */
function checkLaunchctlReadOnly() {
  const violations = [];
  for (const file of LAUNCHCTL_READONLY_HARNESSES) {
    if (!existsSync(file)) {
      violations.push(`${file}: missing, cannot audit launchctl usage`);
      continue;
    }
    const sourceFile = parseSource(file, readFileSync(file, "utf8"));
    const report = (node, reason) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      violations.push(`${file}:${line + 1}: ${reason}`);
    };
    const visit = (node) => {
      const isBinary =
        ts.isStringLiteralLike(node) &&
        (node.text === "launchctl" || node.text.endsWith("/launchctl"));
      if (isBinary) {
        const call = node.parent;
        const argv =
          ts.isCallExpression(call) && call.arguments[0] === node
            ? call.arguments[1]
            : undefined;
        const verb =
          argv && ts.isArrayLiteralExpression(argv)
            ? argv.elements[0]
            : undefined;
        if (!(verb && ts.isStringLiteralLike(verb) && verb.text === "print")) {
          report(
            node,
            `"launchctl" must be spawned with an argv array whose first element is the read-only "print" verb`,
          );
        }
      } else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteral(node)) {
        const text = node.getText(sourceFile);
        if (/\blaunchctl\b(?!\s+print\b)/.test(text)) {
          report(
            node,
            `a string mentioning "launchctl" must follow every occurrence inline with the read-only "print" verb`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
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
 * file-scoped terminal-client fence, the session-projection chokepoint check,
 * and the attention single-source census, then set the process exit code.
 * @remarks All seven diff legs gate the exit, not just MISSING: in a
 * frozen-baseline world an EXTRA (homed but unbaselined — a typo'd ID in docs
 * or an unratified new ID in JSDoc) and an ORPHAN (present in src but
 * unbaselined) are always defects, and an informational-only leg would let
 * them accumulate silently through the body-comment deletion phases. The
 * retired-pattern leg, the strip-cascade leg, the board reading-rhythm leg,
 * the terminal-fence leg, the session-projection chokepoint leg, and the
 * attention single-source leg are all independent of the ID-baseline
 * arithmetic above — a design literal coming back, the terminal-client
 * subject set changing, a flat session field being assigned outside its sole
 * chokepoint, or a second independent computation of "does this card need
 * attention" is a defect regardless of whether any invariant ID also moved.
 * The strip-cascade leg (`NEW-18`), the board reading-rhythm leg (`NEW-19`),
 * the terminal-fence leg (`NEW-20`), the session-projection chokepoint leg
 * (`NEW-21`), and the attention single-source leg (`NEW-22`) are all
 * deliberately scoped (file- or directory-scoped) rather than folded into
 * `RETIRED_PATTERNS`, since each pattern is legitimate outside its own scope.
 * The terminal-fence leg only proves the fenced SUBJECT SET is intact — it
 * cannot prove the fenced files' CONTENTS are unchanged; see
 * `checkTerminalFence`'s own JSDoc for the split. See
 * `checkSessionProjectionChokepoint`'s and `checkAttentionSingleSource`'s own
 * JSDoc for their respective two-tier fence/slice split and missing-subject
 * sentinels.
 * @returns Nothing; exits 0 iff MISSING, ORPHAN, EXTRA, RETIRED, STRIP
 * CASCADES, BOARD READING RHYTHM, TERMINAL FENCE, SESSION PROJECTION
 * CHOKEPOINT, ATTENTION SINGLE SOURCE, and LAUNCHCTL READ-ONLY are all empty.
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
  const attentionSingleSource = checkAttentionSingleSource();
  const launchctlReadOnly = checkLaunchctlReadOnly();

  report("MISSING (baseline - home)", missing);
  report("ORPHAN  (present - baseline)", orphan);
  report("EXTRA   (home - baseline)", extra);
  report("RETIRED (design literals that came back)", retired);
  report("STRIP CASCADES (NEW-18)", stripCascades);
  report("BOARD READING RHYTHM (NEW-19)", boardReadingRhythm);
  report("TERMINAL FENCE (NEW-20)", terminalFence);
  report("SESSION PROJECTION CHOKEPOINT (NEW-21)", sessionChokepoint);
  report("ATTENTION SINGLE SOURCE (NEW-22)", attentionSingleSource);
  report("LAUNCHCTL READ-ONLY (harnesses)", launchctlReadOnly);

  const defects =
    missing.length +
    orphan.length +
    extra.length +
    retired.length +
    stripCascades.length +
    boardReadingRhythm.length +
    terminalFence.length +
    sessionChokepoint.length +
    attentionSingleSource.length +
    launchctlReadOnly.length;
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
        : "") +
      (attentionSingleSource.length
        ? ` (${attentionSingleSource.length} attention-single-source violation(s))`
        : "") +
      (launchctlReadOnly.length
        ? ` (${launchctlReadOnly.length} launchctl read-only violation(s))`
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
