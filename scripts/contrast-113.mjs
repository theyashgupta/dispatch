/**
 * Phase 113 instrument script (LUI-01, dev/ops tooling, NOT test code): no test framework, no
 * assertion library, lives outside src/, the same category as panel-92 through panel-112.
 * `scripts/**` is eslint-ignored, so the JSDoc-only comment rule does not apply here, but prettier
 * still formats this file.
 *
 * SCOPE. Pure computation over `src/web/styles/tokens.css` (or an overridden path). It parses
 * every color custom-property declaration, computes the WCAG 2.x contrast ratio of every
 * text-role and non-text-role token pair against every surface tier, and asserts the four
 * elevation-ladder tiers strictly increase in relative luminance. It boots no server, spawns no
 * process, claims no port, and touches nothing under `src/` when run in check mode.
 *
 * DEVIATION FROM PRECEDENT. Every `panel-*.mjs` break mutates the real artifact it checks, in
 * place, then restores the captured bytes in a `finally`. This script's break deliberately does
 * NOT do that: this phase's hard invariant is that no `src/` file is ever touched, at any point,
 * so the break instead writes a mutated COPY of the token file under a private mkdtemp directory
 * and drives the exact same check function against that copy via the `tokens` flag. Each break
 * leg creates its own private directory via fs.mkdtempSync, so concurrent runs cannot clobber
 * each other and a pre-planted symlink at a predictable path is never followed. Do not
 * "correct" this back to in-place mutation; it would violate the phase's own acceptance criteria
 * (a clean git status for `src/` must hold through every task).
 *
 * PORT CLAIMS. None. This script never listens on or dials a network port.
 *
 * Usage:
 *   node scripts/contrast-113.mjs                 every registered check, exits non-zero on any
 *                                                    violation. Refuses to exit 0 if CHECKS is
 *                                                    empty, so an accidentally emptied map can
 *                                                    never read as a vacuous pass.
 *   node scripts/contrast-113.mjs --check <name>   one named leg only: "pairs" or "ladder".
 *                                                    Unknown name exits non-zero and lists the
 *                                                    registered names.
 *   node scripts/contrast-113.mjs --break <name>   that leg's own break ("pairs", "ladder", or
 *                                                    "all" for both): mutates a COPY of the token
 *                                                    file under /tmp, confirms the SAME check
 *                                                    function used by the real run reports the
 *                                                    violation by name (TRIP leg), removes the
 *                                                    temporary directory in a `finally`, then
 *                                                    re-runs the full check against the real,
 *                                                    unmodified token file and asserts a clean pass
 *                                                    (RESTORE leg).
 *   node scripts/contrast-113.mjs --tokens <path>  parse a different token file instead of the
 *                                                    default `src/web/styles/tokens.css`.
 *   node scripts/contrast-113.mjs --extra-bg name=hex   repeatable. Appends an additional
 *                                                    background tier to the pair set (NOT the
 *                                                    ladder assertion, which always checks the
 *                                                    fixed four tiers by name), so a later plan can
 *                                                    measure a new surface value against the same
 *                                                    pair set without editing this file.
 *
 * Exit-code contract: 0 when every pair passes or is a sound residual and the ladder holds, or
 * when a break's trip leg correctly fired and its restore leg re-passed. 1 on any violation, any
 * unknown check/break name, or a break whose trip/restore leg did not behave as expected.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_TOKENS_PATH = "src/web/styles/tokens.css";
const PREFIX = "-".repeat(2);
const LADDER_NAMES = [
  "--bg",
  "--surface-column",
  "--surface-card",
  "--surface-card-hover",
];

/**
 * Known, named pre-existing contrast failures. A failing pair present here is reported as
 * RESIDUAL rather than FAIL, subject to three guards: a measured ratio below `recordedRatio` is a
 * regression, a measured ratio meeting its floor is a stale entry that must be retired, and an
 * entry naming a pair absent from the generated pair set is stale too.
 *
 * Deliberately empty (Phase 115): the two entries that lived here (--destructive on
 * --surface-card at 4.40, --destructive on --surface-card-hover at 4.11) were retired by
 * splitting --destructive into a fill role (unchanged, non-text, 3:1 floor) and a new
 * --destructive-text role (4.5:1+ on every tier, measured). This array staying empty is the
 * tripwire: any future pair violation is a hard FAIL with nowhere to hide, never silently
 * re-absorbed into a residual entry.
 */
const RESIDUALS = [];

// ---------------------------------------------------------------------------
// WCAG relative luminance and contrast ratio
// ---------------------------------------------------------------------------

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lin(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relLum([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1, hex2) {
  const L1 = relLum(hexToRgb(hex1));
  const L2 = relLum(hexToRgb(hex2));
  const [a, b] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (a + 0.05) / (b + 0.05);
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

function loadTokens(tokensPath) {
  const text = fs
    .readFileSync(tokensPath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const re = new RegExp(
    PREFIX + "([a-zA-Z0-9-]+):\\s*(#[0-9a-fA-F]{6})\\s*;",
    "g",
  );
  const tokens = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.set(PREFIX + m[1], m[2].toLowerCase());
  }
  return tokens;
}

/**
 * Parses the token file and pushes a violation (rather than throwing) if fewer than 20 tokens
 * parse, so an emptied or renamed token file can never read as a vacuous pass.
 */
function loadTokensOrViolate(tokensPath, violations) {
  const tokens = loadTokens(tokensPath);
  if (tokens.size < 20) {
    violations.push(
      `parse: only ${tokens.size} token(s) parsed from ${tokensPath}, expected at least 20 (empty or renamed token file?)`,
    );
  }
  return tokens;
}

function findResidual(fg, bg) {
  return RESIDUALS.find((r) => r.fg === fg && r.bg === bg);
}

/**
 * Builds the background set (four fixed ladder tiers plus any --extra-bg additions) and the two
 * foreground sets (text-role: --text*, --destructive-text; non-text-role: --accent, --destructive,
 * --prio-*, --col-*, --status-*), then generates every background x foreground pair, excluding
 * --border and any pair where the foreground and background name are identical.
 */
function buildPairSet(tokens, extraBgs) {
  const backgrounds = new Map();
  for (const name of LADDER_NAMES) {
    if (tokens.has(name)) backgrounds.set(name, tokens.get(name));
  }
  for (const [name, hex] of extraBgs) {
    backgrounds.set(name, hex.toLowerCase());
  }

  const textFg = new Map();
  const nontextFg = new Map();
  for (const [name, hex] of tokens) {
    if (name === "--border") continue;
    if (name.startsWith("--text") || name === "--destructive-text") {
      textFg.set(name, hex);
    } else if (
      name === "--accent" ||
      name === "--destructive" ||
      name.startsWith("--prio-") ||
      name.startsWith("--col-") ||
      name.startsWith("--status-")
    ) {
      nontextFg.set(name, hex);
    }
  }

  const pairs = [];
  for (const [bgName, bgHex] of backgrounds) {
    for (const [fgName, fgHex] of textFg) {
      if (fgName === bgName) continue;
      pairs.push({ fg: fgName, fgHex, bg: bgName, bgHex, role: "text" });
    }
    for (const [fgName, fgHex] of nontextFg) {
      if (fgName === bgName) continue;
      pairs.push({ fg: fgName, fgHex, bg: bgName, bgHex, role: "nontext" });
    }
  }
  return { pairs };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VERDICT_RANK = { FAIL: 0, RESIDUAL: 1, PASS: 2 };

function checkPairs(tokensPath, extraBgs, violations) {
  const tokens = loadTokensOrViolate(tokensPath, violations);
  if (tokens.size < 20) {
    return { rows: [], pairCount: 0, failCount: 0, residualCount: 0 };
  }

  const { pairs } = buildPairSet(tokens, extraBgs);
  const rows = [];
  let failCount = 0;
  let residualCount = 0;

  for (const p of pairs) {
    const measured = round2(contrastRatio(p.fgHex, p.bgHex));
    const floor = p.role === "text" ? 4.5 : 3.0;
    const residual = findResidual(p.fg, p.bg);
    let verdict;

    if (residual) {
      if (measured < residual.recordedRatio) {
        violations.push(
          `residual regression: ${p.fg} on ${p.bg} measured ${measured.toFixed(2)}, below its recorded ${residual.recordedRatio.toFixed(2)}`,
        );
        verdict = "FAIL";
        failCount++;
      } else if (measured >= floor) {
        violations.push(
          `stale residual: ${p.fg} on ${p.bg} now measures ${measured.toFixed(2)}, meets the ${floor.toFixed(1)} floor; retire this RESIDUALS entry`,
        );
        verdict = "FAIL";
        failCount++;
      } else {
        verdict = "RESIDUAL";
        residualCount++;
      }
    } else if (measured >= floor) {
      verdict = "PASS";
    } else {
      violations.push(
        `FAIL: ${p.fg} on ${p.bg} (${p.role}) measured ${measured.toFixed(2)}, below the ${floor.toFixed(1)} floor`,
      );
      verdict = "FAIL";
      failCount++;
    }

    rows.push({
      pair: `${p.fg} on ${p.bg}`,
      role: p.role,
      ratio: measured.toFixed(2),
      floor: floor.toFixed(1),
      verdict,
    });
  }

  for (const r of RESIDUALS) {
    const found = pairs.some((p) => p.fg === r.fg && p.bg === r.bg);
    if (!found) {
      violations.push(
        `stale residual: RESIDUALS entry ${r.fg} on ${r.bg} does not name a pair in the generated pair set`,
      );
    }
  }

  rows.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
  return { rows, pairCount: pairs.length, failCount, residualCount };
}

function checkLadder(tokensPath, violations) {
  const tokens = loadTokensOrViolate(tokensPath, violations);
  if (tokens.size < 20) {
    return { rows: [] };
  }

  const rows = [];
  let prevLum = null;
  let prevName = null;
  for (const name of LADDER_NAMES) {
    const hex = tokens.get(name);
    if (!hex) {
      violations.push(`ladder: missing tier ${name} in ${tokensPath}`);
      continue;
    }
    const lum = relLum(hexToRgb(hex));
    rows.push({ tier: name, hex, luminance: lum.toFixed(5) });
    if (prevLum !== null && !(lum > prevLum)) {
      violations.push(
        `ladder: ${name} (luminance ${lum.toFixed(5)}) is not strictly greater than ${prevName} (luminance ${prevLum.toFixed(5)})`,
      );
    }
    prevLum = lum;
    prevName = name;
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function printPairsTable(rows) {
  const lines = [
    "| Pair | Role | Ratio | Floor | Verdict |",
    "|------|------|-------|-------|---------|",
    ...rows.map(
      (r) =>
        `| ${r.pair} | ${r.role} | ${r.ratio} | ${r.floor} | ${r.verdict} |`,
    ),
  ];
  console.log(lines.join("\n"));
}

function printLadderTable(rows) {
  const lines = [
    "| Tier | Hex | Luminance |",
    "|------|-----|-----------|",
    ...rows.map((r) => `| ${r.tier} | ${r.hex} | ${r.luminance} |`),
  ];
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Break legs
// ---------------------------------------------------------------------------

/**
 * --break pairs: writes a copy of the real token file with --text-muted rewritten to a value
 * whose contrast against --surface-card drops below the 4.5 text floor, runs the same pair check
 * function against that copy, and asserts the trip fires naming both tokens. Restores nothing on
 * disk (the real file was never opened for writing) and always re-confirms the real file still
 * passes clean.
 */
async function runBreakPairs() {
  const realPath = path.resolve(process.cwd(), DEFAULT_TOKENS_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-113-break-"));
  try {
    const original = fs.readFileSync(realPath, "utf8");
    const mutated = original.replace(
      /--text-muted:\s*#[0-9a-fA-F]{6}/,
      "--text-muted: #3a3d42",
    );
    if (mutated === original) {
      throw new Error(
        "break pairs: --text-muted declaration not found to mutate",
      );
    }
    const mutatedPath = path.join(tmpDir, "tokens.css");
    fs.writeFileSync(mutatedPath, mutated);

    const tripViolations = [];
    checkPairs(mutatedPath, [], tripViolations);
    const tripFired = tripViolations.some((v) =>
      v.includes("--text-muted on --surface-card ("),
    );
    console.log(
      `\n--break pairs TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );

    const restoreViolations = [];
    checkPairs(realPath, [], restoreViolations);
    const restoreClean = restoreViolations.length === 0;
    console.log(
      `\n--break pairs RESTORE leg (real, unmodified tokens.css): ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
    );

    return { tripFired, restoreClean };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * --break ladder: writes a copy of the real token file with --surface-card rewritten darker than
 * --surface-column, runs the same ladder check function against that copy, and asserts the trip
 * fires naming both tiers. Always re-confirms the real file still passes clean afterward.
 */
async function runBreakLadder() {
  const realPath = path.resolve(process.cwd(), DEFAULT_TOKENS_PATH);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-113-break-"));
  try {
    const original = fs.readFileSync(realPath, "utf8");
    const mutated = original.replace(
      /--surface-card:\s*#[0-9a-fA-F]{6}/,
      "--surface-card: #0f1013",
    );
    if (mutated === original) {
      throw new Error(
        "break ladder: --surface-card declaration not found to mutate",
      );
    }
    const mutatedPath = path.join(tmpDir, "tokens-ladder.css");
    fs.writeFileSync(mutatedPath, mutated);

    const tripViolations = [];
    checkLadder(mutatedPath, tripViolations);
    const tripFired = tripViolations.some(
      (v) => v.includes("--surface-card (") && v.includes("--surface-column ("),
    );
    console.log(
      `\n--break ladder TRIP leg output:\n${tripViolations.join("\n") || "(no violations)"}`,
    );

    const restoreViolations = [];
    checkLadder(realPath, restoreViolations);
    const restoreClean = restoreViolations.length === 0;
    console.log(
      `\n--break ladder RESTORE leg (real, unmodified tokens.css): ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
    );

    return { tripFired, restoreClean };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runBreakAll() {
  const pairsResult = await runBreakPairs();
  const ladderResult = await runBreakLadder();
  return {
    tripFired: pairsResult.tripFired && ladderResult.tripFired,
    restoreClean: pairsResult.restoreClean && ladderResult.restoreClean,
  };
}

const CHECKS = {
  pairs: (violations, tokensPath, extraBgs) =>
    checkPairs(tokensPath, extraBgs, violations),
  ladder: (violations, tokensPath) => checkLadder(tokensPath, violations),
};

const BREAKS = {
  pairs: runBreakPairs,
  ladder: runBreakLadder,
  all: runBreakAll,
};

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function readFlag(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const value = argv[idx + 1];
  if (value == null || value.startsWith("-")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function readAllFlags(argv, flag) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const value = argv[i + 1];
      if (value == null || value.startsWith("-")) {
        console.error(`${flag} requires a value`);
        process.exit(1);
      }
      values.push(value);
      i++;
    }
  }
  return values;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);

  const tokensFlagValue = readFlag(argv, "--tokens");
  const tokensPath = tokensFlagValue
    ? path.resolve(process.cwd(), tokensFlagValue)
    : path.resolve(process.cwd(), DEFAULT_TOKENS_PATH);

  const extraBgRaw = readAllFlags(argv, "--extra-bg");
  const extraBgs = extraBgRaw.map((raw) => {
    const eq = raw.indexOf("=");
    if (eq < 0) {
      console.error(`--extra-bg requires name=hex, got "${raw}"`);
      process.exit(1);
    }
    const name = raw.slice(0, eq);
    const hex = raw.slice(eq + 1);
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      console.error(`--extra-bg hex must be #rrggbb, got "${raw}"`);
      process.exit(1);
    }
    return [name, hex];
  });

  const checkName = readFlag(argv, "--check");
  if (checkName != null && !Object.hasOwn(CHECKS, checkName)) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ")}`,
    );
    process.exit(1);
  }

  const breakName = readFlag(argv, "--break");
  if (breakName != null && !Object.hasOwn(BREAKS, breakName)) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ")}`,
    );
    process.exit(1);
  }

  if (Object.keys(CHECKS).length === 0) {
    console.error(
      "contrast-113: refusing to exit 0, CHECKS is empty (would read as a vacuous pass)",
    );
    process.exit(1);
  }

  if (breakName != null) {
    const result = await BREAKS[breakName]();
    console.log(
      `\n--break ${breakName} summary: tripFired=${result.tripFired} restoreClean=${result.restoreClean}`,
    );
    if (!result.tripFired) {
      console.log(
        `FAIL (self-check): the trip leg did NOT report the expected violation for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!result.restoreClean) {
      console.log(
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after re-running against the real tokens.css.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS (--break ${breakName} self-check): trip leg correctly reported the violation, restore leg re-passed clean.`,
    );
    process.exit(0);
  }

  const violations = [];
  const legs = checkName != null ? [checkName] : Object.keys(CHECKS);
  let pairsSummary = null;

  for (const leg of legs) {
    if (leg === "pairs") {
      pairsSummary = checkPairs(tokensPath, extraBgs, violations);
      console.log("\n## Pair contrast");
      printPairsTable(pairsSummary.rows);
    } else if (leg === "ladder") {
      const ladderResult = checkLadder(tokensPath, violations);
      console.log("\n## Elevation ladder");
      printLadderTable(ladderResult.rows);
    }
  }

  if (pairsSummary) {
    console.log(
      `\nSummary: ${pairsSummary.pairCount} pair(s) checked, ${pairsSummary.failCount} failing, ${pairsSummary.residualCount} residual.`,
    );
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`contrast-113 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
