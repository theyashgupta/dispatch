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
 * THEMES (G9, LOCAL-55). Every check runs once per theme, against that theme's own token map and
 * ladder order. The rules are in docs/ARCHITECTURE.md, Theme Engine, "The instrument".
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
 *   node scripts/contrast-113.mjs                 every registered check on both themes, exits
 *                                                    non-zero on any violation in either theme,
 *                                                    and on a token file with no light block.
 *                                                    Refuses to exit 0 if CHECKS is empty, so an
 *                                                    accidentally emptied map can never read as a
 *                                                    vacuous pass.
 *   node scripts/contrast-113.mjs --theme <name>   one theme only: "dark" or "light".
 *   node scripts/contrast-113.mjs --check <name>   one named leg only: "pairs" or "ladder".
 *                                                    Unknown name exits non-zero and lists the
 *                                                    registered names.
 *   node scripts/contrast-113.mjs --break <name>   that leg's own break ("pairs", "ladder",
 *                                                    "light", or "all"): mutates a COPY of the token
 *                                                    file under /tmp, confirms the SAME check
 *                                                    function used by the real run reports the
 *                                                    violation by name (TRIP leg), removes the
 *                                                    temporary directory in a `finally`, then
 *                                                    re-runs the full check against the real,
 *                                                    unmodified token file and asserts a clean pass
 *                                                    (RESTORE leg). The "light" leg mutates a
 *                                                    token inside the light block and asserts the
 *                                                    light run trips while the dark run of the same
 *                                                    copy still passes.
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
const LIGHT_SELECTOR = ':root[data-theme="light"]';
const THEMES = ["dark", "light"];
const LADDER_ORDER = {
  dark: ["--bg", "--surface-column", "--surface-card", "--surface-card-hover"],
  light: ["--bg", "--surface-column", "--surface-card-hover", "--surface-card"],
};
const BACKGROUND_NAMES = [...LADDER_ORDER.dark, "--surface-inset"];

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
const COLUMN_INK_NAMES = [
  "col-todo",
  "col-in-progress",
  "col-needs-input",
  "col-agent-done",
  "col-in-review",
  "col-parked",
  "col-done",
];
const DATA_INK_SHARE = 0.35;
const MARK_NAMES = [
  "src-github",
  "src-linear",
  "src-slack",
  "src-sentry",
  "src-meeting",
  "src-calendar",
  "src-agent",
];

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

function readWithoutComments(tokensPath) {
  return fs.readFileSync(tokensPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Returns the declarations of the first rule that starts with this selector, or null.
 *
 * @remarks A plain slice to the next closing brace, so the palette must stay the first `:root {`
 * rule of the file and a token block must hold no nested rule.
 */
function declarationsOf(text, selector) {
  const at = text.indexOf(`${selector} {`);
  if (at < 0) return null;
  const declaration = new RegExp(
    PREFIX + "([a-zA-Z0-9-]+)\\s*:\\s*([^;{}]+)(?:;|$)",
    "g",
  );
  const found = new Map();
  const body = text.slice(at, text.indexOf("}", at));
  for (const m of body.matchAll(declaration)) {
    found.set(PREFIX + m[1], m[2].trim());
  }
  return found;
}

/** Splits the token file into the dark palette and the light block, `light` null when absent. */
function parseBlocks(tokensPath) {
  const text = readWithoutComments(tokensPath);
  return {
    dark: declarationsOf(text, ":root") ?? new Map(),
    light: declarationsOf(text, LIGHT_SELECTOR),
  };
}

function parseMixPart(part, rawTokens, seen) {
  const m =
    /^(#[0-9a-fA-F]{6}|black|white|var\(\s*--[a-zA-Z0-9-]+\s*\))(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(
      part.trim(),
    );
  if (m == null) return null;
  const named = { black: "#000000", white: "#ffffff" };
  const isShade = Object.hasOwn(named, m[1]);
  const hex = isShade ? named[m[1]] : resolveValue(m[1], rawTokens, seen);
  if (hex == null) return null;
  return { hex, isShade, pct: m[2] == null ? null : Number(m[2]) };
}

/**
 * Resolves one raw declaration value to a hex, or null when the form is not supported.
 *
 * @remarks The forms are a hex, a var() of a token, and a mix of one color with `black` or `white`.
 */
function resolveValue(raw, rawTokens, seen = new Set()) {
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();

  const ref = /^var\(\s*(--[a-zA-Z0-9-]+)\s*\)$/.exec(value);
  if (ref != null) {
    if (seen.has(ref[1]) || !rawTokens.has(ref[1])) return null;
    seen.add(ref[1]);
    return resolveValue(rawTokens.get(ref[1]), rawTokens, seen);
  }

  const mix = /^color-mix\(\s*in srgb\s*,([^,]+),([^,]+)\)$/.exec(value);
  if (mix != null) {
    const a = parseMixPart(mix[1], rawTokens, seen);
    const b = parseMixPart(mix[2], rawTokens, seen);
    if (a == null || b == null || a.isShade === b.isShade) return null;
    let pa = a.pct;
    let pb = b.pct;
    if (pa == null && pb == null) pa = pb = 50;
    else if (pa == null) pa = 100 - pb;
    else if (pb == null) pb = 100 - pa;
    if (pa + pb <= 0) return null;
    return srgbMix(a.hex, b.hex, pa / (pa + pb));
  }
  return null;
}

function isColorRole(name) {
  return (
    BACKGROUND_NAMES.includes(name) || isTextRole(name) || isNontextRole(name)
  );
}

function isTextRole(name) {
  return (
    name.startsWith("--text") ||
    name === "--destructive-text" ||
    name === "--accent-text" ||
    name === "--status-ok" ||
    name === "--status-stale" ||
    name.startsWith("--src-")
  );
}

function isNontextRole(name) {
  if (isTextRole(name)) return false;
  return (
    name === "--accent" ||
    name === "--destructive" ||
    name.startsWith("--prio-") ||
    name.startsWith("--col-") ||
    name.startsWith("--status-")
  );
}

/**
 * Builds the resolved token map of one theme.
 *
 * @remarks A missing light block, an unresolved color role and fewer than 20 tokens each push a
 * violation, so an emptied or renamed token file can never read as a vacuous pass.
 */
function loadTokensOrViolate(tokensPath, theme, violations) {
  const blocks = parseBlocks(tokensPath);
  const tokens = new Map();
  if (theme === "light" && blocks.light == null) {
    violations.push(
      `light: no ${LIGHT_SELECTOR} block in ${tokensPath}, the light theme cannot be measured`,
    );
    return tokens;
  }
  const rawTokens = new Map(blocks.dark);
  if (theme === "light") {
    for (const [name, raw] of blocks.light) rawTokens.set(name, raw);
  }
  for (const [name, raw] of rawTokens) {
    const hex = resolveValue(raw, rawTokens);
    if (hex != null) {
      tokens.set(name, hex);
    } else if (isColorRole(name)) {
      violations.push(
        `unresolved (${theme}): ${name} has the value "${raw}", which is not a hex, a color-mix of a hex with black or white, or a var() of a token`,
      );
    }
  }
  if (tokens.size < 20) {
    violations.push(
      `parse (${theme}): only ${tokens.size} token(s) parsed from ${tokensPath}, expected at least 20 (empty or renamed token file?)`,
    );
  }
  return tokens;
}

function findResidual(fg, bg) {
  return RESIDUALS.find((r) => r.fg === fg && r.bg === bg);
}

/**
 * Generates every background x foreground pair of one theme.
 *
 * @remarks --status-ok and --status-stale sit in the text set because chips and pace badges render
 * them as text. --border and a pair of one name with itself are left out.
 */
function buildPairSet(tokens, extraBgs) {
  const backgrounds = new Map();
  for (const name of BACKGROUND_NAMES) {
    if (tokens.has(name)) backgrounds.set(name, tokens.get(name));
  }
  for (const [name, hex] of extraBgs) {
    backgrounds.set(name, hex.toLowerCase());
  }

  const textFg = new Map();
  const nontextFg = new Map();
  for (const [name, hex] of tokens) {
    if (isTextRole(name)) textFg.set(name, hex);
    else if (isNontextRole(name)) nontextFg.set(name, hex);
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

/**
 * The exact sRGB mix a browser's `color-mix(in srgb, A p%, B)` computes for two opaque hex
 * colors, so derived-pair backgrounds below re-derive from the live token values rather than
 * pinning a resolved hex that would go stale on a base-token retune.
 */
function srgbMix(hexA, hexB, pctA) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const mixed = a.map((v, i) => Math.round(v * pctA + b[i] * (1 - pctA)));
  return "#" + mixed.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Real rendered pairs whose background (or foreground) is not itself a raw token, so the
 * generated ladder-tier cross-product can never produce them (115 review WR-01/WR-02):
 *
 * 1. The filled Button labels, `--on-accent` and `--on-danger`, on their fill at rest, on the
 *    hover state token and on the pressed state token (Button.tsx primary and danger variants),
 *    and `--accent-text` on the 16% accent tint over every background tier.
 * 2. `--destructive-text` on the Lost-chip tint, `color-mix(in srgb, var(--destructive) 16%,
 *    var(--surface-card))` (CardView.tsx:149). The chip's background is this one opaque computed
 *    color: it is deliberately pinned to the resting `--surface-card` tier and does NOT re-base
 *    when the card behind it hovers, so the hover-tier mix is not a rendered text background and
 *    is excluded here. Measured for the record: at 16% over `--surface-card-hover` the mix would
 *    be #40272c and `--destructive-text` on it 4.48:1, BELOW the text floor, so any future
 *    re-base of the chip tint onto the hover tier must change the tint formula and this list.
 * 3. The account popover's pace badges (AccountPopover.tsx): `--status-ok` and `--status-stale`
 *    as text on their own 16% tint over `--surface-column`, and `--destructive-text` on the
 *    `--status-down` 16% tint, because `--status-down` itself is below the text floor there.
 * 4. A column colour as text (`dataInk` in src/web/primitives/data-ink.ts): 35% of the `--col-*` token
 *    mixed with `--text`, on the 16% tint of the same token over every background tier. The
 *    column tokens themselves stay graphic tokens.
 * 5. A source mark (SourceBadge.tsx, SourceIcon.tsx): the `--src-*` token as a graphic on the 16%
 *    tint of the same token over every background tier, at the 3:1 floor.
 *
 * A referenced token missing from the parsed file is pushed as a violation, never silently
 * skipped, so deleting a token cannot retire its guard.
 */
function buildDerivedTextPairs(tokens, violations) {
  const pairs = [];
  const need = (name) => {
    const hex = tokens.get(PREFIX + name);
    if (hex == null) {
      violations.push(
        `derived: token ${PREFIX + name} is missing or does not resolve, its derived pair cannot be checked`,
      );
    }
    return hex;
  };
  const label = (labelName, fills) => {
    const labelHex = need(labelName);
    for (const fillName of fills) {
      const fillHex = need(fillName);
      if (labelHex == null || fillHex == null) continue;
      pairs.push({
        fg: PREFIX + labelName,
        fgHex: labelHex,
        bg: PREFIX + fillName,
        bgHex: fillHex,
        role: "text",
      });
    }
  };
  label("on-accent", [
    "accent",
    "hover-button-primary",
    "pressed-button-primary",
  ]);
  label("on-danger", [
    "destructive-button-fill",
    "hover-button-danger",
    "pressed-button-danger",
  ]);
  const accent = need("accent");
  const accentText = need("accent-text");
  if (accent != null && accentText != null) {
    for (const tier of BACKGROUND_NAMES) {
      const tierHex = tokens.get(tier);
      if (tierHex == null) continue;
      pairs.push({
        fg: PREFIX + "accent-text",
        fgHex: accentText,
        bg: `accent-tint-on-${tier.slice(2)}(computed)`,
        bgHex: srgbMix(accent, tierHex, 0.16),
        role: "text",
      });
    }
  }
  const destructive = need("destructive");
  const card = need("surface-card");
  const destructiveText = need("destructive-text");
  if (destructive != null && card != null && destructiveText != null) {
    pairs.push({
      fg: PREFIX + "destructive-text",
      fgHex: destructiveText,
      bg: "lost-chip-tint(computed)",
      bgHex: srgbMix(destructive, card, 0.16),
      role: "text",
    });
  }
  const column = need("surface-column");
  const statusOk = need("status-ok");
  const statusStale = need("status-stale");
  const statusDown = need("status-down");
  if (
    column != null &&
    statusOk != null &&
    statusStale != null &&
    statusDown != null &&
    destructiveText != null
  ) {
    const badge = (name, fgName, fgHex, tintHex) =>
      pairs.push({
        fg: fgName,
        fgHex,
        bg: `${name}-badge-tint(computed)`,
        bgHex: srgbMix(tintHex, column, 0.16),
        role: "text",
      });
    badge("pace-on-track", PREFIX + "status-ok", statusOk, statusOk);
    badge("pace-ahead", PREFIX + "status-stale", statusStale, statusStale);
    badge(
      "pace-will-run-out",
      PREFIX + "destructive-text",
      destructiveText,
      statusDown,
    );
  }
  const text = need("text");
  for (const name of COLUMN_INK_NAMES) {
    const col = need(name);
    if (col == null || text == null) continue;
    for (const tier of BACKGROUND_NAMES) {
      const tierHex = tokens.get(tier);
      if (tierHex == null) continue;
      pairs.push({
        fg: `${name}-ink(computed)`,
        fgHex: srgbMix(col, text, DATA_INK_SHARE),
        bg: `${name}-tint-on-${tier.slice(2)}(computed)`,
        bgHex: srgbMix(col, tierHex, 0.16),
        role: "text",
      });
    }
  }
  for (const name of MARK_NAMES) {
    const mark = need(name);
    if (mark == null) continue;
    for (const tier of BACKGROUND_NAMES) {
      const tierHex = tokens.get(tier);
      if (tierHex == null) continue;
      pairs.push({
        fg: `${name}-mark(computed)`,
        fgHex: mark,
        bg: `${name}-tint-on-${tier.slice(2)}(computed)`,
        bgHex: srgbMix(mark, tierHex, 0.16),
        role: "nontext",
      });
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const VERDICT_RANK = { FAIL: 0, RESIDUAL: 1, PASS: 2 };

function checkPairs(tokensPath, extraBgs, violations, theme = "dark") {
  const tokens = loadTokensOrViolate(tokensPath, theme, violations);
  if (tokens.size < 20) {
    return { rows: [], pairCount: 0, failCount: 0, residualCount: 0 };
  }

  const { pairs } = buildPairSet(tokens, extraBgs);
  pairs.push(...buildDerivedTextPairs(tokens, violations));
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
          `residual regression (${theme}): ${p.fg} on ${p.bg} measured ${measured.toFixed(2)}, below its recorded ${residual.recordedRatio.toFixed(2)}`,
        );
        verdict = "FAIL";
        failCount++;
      } else if (measured >= floor) {
        violations.push(
          `stale residual (${theme}): ${p.fg} on ${p.bg} now measures ${measured.toFixed(2)}, meets the ${floor.toFixed(1)} floor; retire this RESIDUALS entry`,
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
        `FAIL (${theme}): ${p.fg} on ${p.bg} (${p.role}) measured ${measured.toFixed(2)}, below the ${floor.toFixed(1)} floor`,
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

function checkLadder(tokensPath, violations, theme = "dark") {
  const tokens = loadTokensOrViolate(tokensPath, theme, violations);
  if (tokens.size < 20) {
    return { rows: [] };
  }

  const rows = [];
  let prevLum = null;
  let prevName = null;
  for (const name of LADDER_ORDER[theme]) {
    const hex = tokens.get(name);
    if (!hex) {
      violations.push(
        `ladder (${theme}): missing tier ${name} in ${tokensPath}`,
      );
      continue;
    }
    const lum = relLum(hexToRgb(hex));
    rows.push({ tier: name, hex, luminance: lum.toFixed(5) });
    if (prevLum !== null && !(lum > prevLum)) {
      violations.push(
        `ladder (${theme}): ${name} (luminance ${lum.toFixed(5)}) is not strictly greater than ${prevName} (luminance ${prevLum.toFixed(5)})`,
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
async function runBreakPairs(realPath) {
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

    const restoreViolations = runAllThemes(realPath);
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
async function runBreakLadder(realPath) {
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

    const restoreViolations = runAllThemes(realPath);
    const restoreClean = restoreViolations.length === 0;
    console.log(
      `\n--break ladder RESTORE leg (real, unmodified tokens.css): ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
    );

    return { tripFired, restoreClean };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * --break light: rewrites --text-muted inside the light block of a copy of the token file.
 *
 * @remarks The light run of the copy must name the pair while its dark run stays clean. The copy
 * is comment-free, so a brace inside a comment cannot move the block boundary.
 */
async function runBreakLight(realPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "contrast-113-break-"));
  try {
    const original = readWithoutComments(realPath);
    const blockAt = original.indexOf(`${LIGHT_SELECTOR} {`);
    if (blockAt < 0) {
      throw new Error(`break light: no ${LIGHT_SELECTOR} block in ${realPath}`);
    }
    const blockEnd = original.indexOf("}", blockAt);
    const block = original.slice(blockAt, blockEnd);
    const mutatedBlock = block.replace(
      /--text-muted:\s*[^;]+;/,
      "--text-muted: #c9ccd1;",
    );
    if (mutatedBlock === block) {
      throw new Error(
        "break light: --text-muted declaration not found in the light block",
      );
    }
    const mutatedPath = path.join(tmpDir, "tokens-light.css");
    fs.writeFileSync(
      mutatedPath,
      original.slice(0, blockAt) + mutatedBlock + original.slice(blockEnd),
    );

    const lightViolations = [];
    checkPairs(mutatedPath, [], lightViolations, "light");
    const darkViolations = [];
    checkPairs(mutatedPath, [], darkViolations, "dark");
    const tripFired =
      lightViolations.some((v) =>
        v.includes("--text-muted on --surface-card ("),
      ) && darkViolations.length === 0;
    console.log(
      `\n--break light TRIP leg output (light):\n${lightViolations.join("\n") || "(no violations)"}\n--break light dark run of the same copy: ${darkViolations.length === 0 ? "PASS" : darkViolations.join("\n")}`,
    );

    const restoreViolations = runAllThemes(realPath);
    const restoreClean = restoreViolations.length === 0;
    console.log(
      `\n--break light RESTORE leg (real, unmodified tokens.css): ${restoreClean ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
    );

    return { tripFired, restoreClean };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runBreakAll(realPath) {
  const results = [
    await runBreakPairs(realPath),
    await runBreakLadder(realPath),
    await runBreakLight(realPath),
  ];
  return {
    tripFired: results.every((r) => r.tripFired),
    restoreClean: results.every((r) => r.restoreClean),
  };
}

/**
 * Runs every check on both themes and returns the violations.
 *
 * @remarks A break's restore leg uses it to prove the unmodified file on the terms of a real run.
 */
function runAllThemes(tokensPath) {
  const violations = [];
  for (const theme of THEMES) {
    checkPairs(tokensPath, [], violations, theme);
    checkLadder(tokensPath, violations, theme);
  }
  return [...new Set(violations)];
}

const CHECKS = {
  pairs: (violations, tokensPath, extraBgs, theme) =>
    checkPairs(tokensPath, extraBgs, violations, theme),
  ladder: (violations, tokensPath, extraBgs, theme) =>
    checkLadder(tokensPath, violations, theme),
};

const BREAKS = {
  pairs: runBreakPairs,
  ladder: runBreakLadder,
  light: runBreakLight,
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

  const themeName = readFlag(argv, "--theme");
  if (themeName != null && !THEMES.includes(themeName)) {
    console.error(`unknown theme "${themeName}", valid: ${THEMES.join(", ")}`);
    process.exit(1);
  }

  if (breakName != null) {
    const result = await BREAKS[breakName](tokensPath);
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

  const found = [];
  const legs = checkName != null ? [checkName] : Object.keys(CHECKS);
  const themes = themeName != null ? [themeName] : THEMES;

  for (const theme of themes) {
    for (const leg of legs) {
      const result = CHECKS[leg](found, tokensPath, extraBgs, theme);
      if (leg === "pairs") {
        console.log(`\n## Pair contrast (${theme})`);
        printPairsTable(result.rows);
        console.log(
          `\nSummary (${theme}): ${result.pairCount} pair(s) checked, ${result.failCount} failing, ${result.residualCount} residual.`,
        );
      } else {
        console.log(`\n## Elevation ladder (${theme})`);
        printLadderTable(result.rows);
      }
    }
  }
  const violations = [...new Set(found)];

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
