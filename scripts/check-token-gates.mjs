import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST_PATH = "scripts/check-token-gates.allowlist";
const TOKENS_PATH = "src/web/styles/tokens.css";
const SCAN_EXT_RE = /\.(css|ts|tsx|html)$/;
const TEST_RE = /\.test\.tsx?$/;
const MS_RE = /\b\d+(\.\d+)?ms\b/g;
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const COLOUR_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g;
const DECLARATION_RE = /[{;]\s*([-\w]+)\s*:\s*([^;{}]+)/g;
const RAW_SIZE_RE = /\d*\.?\d+(?:px|rem|em|pt)\b/;
const USAGE = "usage: node scripts/check-token-gates.mjs [--root <dir>]";
const VALUE_BRACKET_RES = [
  /^(?:-?[a-z][a-z0-9-]*-\[.+\]|\[[a-z-]+:.+\])(?:\/\S+)?$/,
  /^-?[a-z][a-z0-9-]*\/\[.+\]$/,
];

/**
 * List the repo-relative files the gate scans under `<root>/src/web`.
 *
 * @remarks
 * Only regular files count, so a symlink or a dangling link is skipped.
 */
function listFiles(root) {
  const base = join(root, "src/web");
  if (!existsSync(base)) return [];
  return readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
    .filter(
      (path) =>
        !path.startsWith("src/web/dist/") &&
        SCAN_EXT_RE.test(path) &&
        !TEST_RE.test(path) &&
        path !== TOKENS_PATH,
    )
    .sort();
}

/**
 * List the millisecond durations and the `cubic-bezier(` call found in a value.
 */
function motionHits(text) {
  const hits = [...text.matchAll(MS_RE)].map((m) => m[0]);
  if (text.includes("cubic-bezier(")) hits.push("cubic-bezier(");
  return hits;
}

/**
 * Classify one whitespace-separated class token, or return null when it is clean.
 *
 * @remarks
 * Only the last variant-free segment is judged, and a `:` inside brackets or parentheses does not split, so `[--x:0px]` stays one utility.
 */
function classifyClass(token) {
  const stripped = token.replace(/^!/, "").replace(/!$/, "");
  const segments = [];
  let depth = 0;
  let current = "";
  for (const ch of stripped) {
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ":" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current);
  const utility = segments[segments.length - 1];
  if (/^text-\[\d/.test(utility))
    return { kind: "raw-font-size", match: utility };
  if (/^(duration|delay)-\d+$/.test(utility))
    return { kind: "raw-motion", match: utility };
  if (VALUE_BRACKET_RES.some((re) => re.test(utility)))
    return { kind: "value-bracket", match: utility };
  return null;
}

function scanString(text, path, startLine, out) {
  for (const m of text.matchAll(/\S+/g)) {
    const token = m[0];
    const line = startLine + (text.slice(0, m.index).match(/\n/g) ?? []).length;
    const hit = classifyClass(token);
    if (hit) out.push({ path, line, ...hit });
    else
      for (const match of motionHits(token))
        out.push({ path, line, kind: "raw-motion", match });
  }
}

function scanScript(path, text) {
  const out = [];
  const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      scanString(node.text, path, line + 1, out);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/**
 * Blank every character of `text` except newlines, so offsets and line numbers hold.
 */
function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

function scanCss(path, text) {
  const out = [];
  const css = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  for (const decl of css.matchAll(DECLARATION_RE)) {
    const name = decl[1];
    const value = decl[2].trim();
    const nameStart = decl.index + decl[0].indexOf(name);
    const line = css.slice(0, nameStart).split("\n").length;
    const bare = value
      .replace(/"[^"]*"|'[^']*'/g, " ")
      .replace(/url\([^)]*\)/g, " ");
    for (const m of bare.matchAll(HEX_RE))
      out.push({ path, line, kind: "colour-literal", match: m[0] });
    for (const m of bare.matchAll(COLOUR_FN_RE))
      out.push({ path, line, kind: "colour-literal", match: m[0] });
    const sizeName =
      name === "font-size" ||
      name === "font" ||
      name.startsWith("--font-") ||
      name.startsWith("--text-");
    if (sizeName && RAW_SIZE_RE.test(bare))
      out.push({
        path,
        line,
        kind: "raw-font-size",
        match: `${name}: ${value}`,
      });
    for (const match of motionHits(bare))
      out.push({ path, line, kind: "raw-motion", match });
  }
  return out;
}

/**
 * Collect the violations in the `<style>` blocks of an HTML file.
 *
 * @remarks
 * Everything outside a style block is blanked rather than cut, so the CSS scan reports file-relative line numbers.
 */
function scanHtml(path, text) {
  let masked = blank(text);
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const start = m.index + m[0].indexOf(">") + 1;
    masked = masked.slice(0, start) + m[1] + masked.slice(start + m[1].length);
  }
  return scanCss(path, masked);
}

/**
 * Scan one file and return its violations as `{ path, line, kind, match }`.
 */
export function scanFile(relPath, text) {
  if (relPath === TOKENS_PATH) return [];
  if (relPath.endsWith(".css")) return scanCss(relPath, text);
  if (relPath.endsWith(".html")) return scanHtml(relPath, text);
  if (/\.tsx?$/.test(relPath)) return scanScript(relPath, text);
  return [];
}

/**
 * Match violations against the allowlist text and return the unlisted violations, the stale entries and the format errors.
 *
 * @remarks
 * An entry is keyed by exact path and match, so one line covers every occurrence in that file and an edit to the value makes the entry stale.
 */
export function reconcile(violations, allowlistText) {
  const errors = [];
  const entries = new Map();
  allowlistText.split("\n").forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim() || raw.startsWith("#")) return;
    const fields = raw.replace(/\r$/, "").split("\t");
    if (fields.length !== 3) {
      errors.push({
        line,
        message: "expected path<TAB>match<TAB>reason",
      });
      return;
    }
    const [path, match, reason] = fields;
    if (!reason.trim()) errors.push({ line, message: "empty reason" });
    const key = `${path}\t${match}`;
    if (entries.has(key)) {
      errors.push({ line, message: `duplicate entry: ${path} ${match}` });
      return;
    }
    entries.set(key, { line, path, match, used: false });
  });
  const remaining = [];
  for (const v of violations) {
    const entry = entries.get(`${v.path}\t${v.match}`);
    if (entry) entry.used = true;
    else remaining.push(v);
  }
  const stale = [...entries.values()]
    .filter((e) => !e.used)
    .map(({ line, path, match }) => ({ line, path, match }));
  return { remaining, stale, errors };
}

/**
 * Run the gate over a repo root and return the process exit code.
 *
 * @remarks
 * Exits 1 on an unlisted violation or a stale allowlist entry, so the allowlist can only shrink.
 */
function main(argv) {
  const flag = argv.indexOf("--root");
  const root = flag === -1 ? defaultRoot : argv[flag + 1];
  if (!root || !statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(USAGE);
    return 2;
  }
  const files = listFiles(root);
  const violations = files.flatMap((rel) =>
    scanFile(rel, readFileSync(join(root, rel), "utf8")),
  );
  const allowPath = join(root, ALLOWLIST_PATH);
  const allowText = existsSync(allowPath)
    ? readFileSync(allowPath, "utf8")
    : "";
  const { remaining, stale, errors } = reconcile(violations, allowText);
  for (const v of remaining)
    console.log(`${v.path}:${v.line}: ${v.kind}: ${v.match}`);
  for (const s of stale)
    console.log(`${ALLOWLIST_PATH}:${s.line}: stale: ${s.path} ${s.match}`);
  for (const e of errors)
    console.log(`${ALLOWLIST_PATH}:${e.line}: error: ${e.message}`);
  if (remaining.length + stale.length + errors.length === 0) {
    const entries = allowText
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#")).length;
    console.log(
      `PASS: token-gates clean (${files.length} files, ${entries} allowlisted)`,
    );
    return 0;
  }
  console.log(
    `FAIL: token-gates (${remaining.length} violations, ${stale.length} stale entries, ${errors.length} allowlist errors)`,
  );
  return 1;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exit(main(process.argv.slice(2)));
}
