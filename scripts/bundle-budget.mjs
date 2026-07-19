/**
 * On-demand bundle-weight audit (PERF-03) — dev tooling, NOT test code. Walks
 * dist/web (the vite build output) and reports each file's raw/gzip size
 * against a threshold table seeded from this phase's own first measured
 * build at commit b4a6423 (2026-07-19): every budgetGzipBytes value below is
 * that build's measured gzip size + 10% headroom, recorded as a trailing
 * comment beside the literal it was derived from — never a guessed number,
 * matching how check-invariants.mjs's FROZEN_COUNT was seeded from a real
 * generated baseline.
 *
 * This is an audit artifact, not a check gate: it ALWAYS exits 0, even when a
 * chunk exceeds its budget (prints WARN) and even when dist/web is missing
 * (prints a hint to build first, still exits 0). The unconditional exit(0) is
 * the mechanical enforcement of the locked "bundle-budget never blocks
 * npm run check" decision (Phase 53 user decision), not an oversight — do not
 * add a non-zero exit path.
 *
 * Run: node scripts/bundle-budget.mjs
 * Pairs with: npm run analyze (ANALYZE=1 vite build) for the visual treemap.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, sep } from "node:path";

const DIST_WEB = join("dist", "web");

/**
 * Threshold table keyed by a stable name pattern (prefix + extension), never
 * an exact content hash — the hashed chunk filename changes on every
 * rebuild, so matching on the hash would make every budget entry stale
 * immediately.
 */
const BUDGETS = [
  {
    label: "index.html",
    match: (f) => f === "index.html",
    budgetGzipBytes: 388,
  }, // seed: 352
  {
    label: "assets/index-*.js",
    match: (f) => f.startsWith(`assets${sep}index-`) && f.endsWith(".js"),
    budgetGzipBytes: 166989, // seed: 151808
  },
  {
    label: "assets/index-*.css",
    match: (f) => f.startsWith(`assets${sep}index-`) && f.endsWith(".css"),
    budgetGzipBytes: 898, // seed: 816
  },
  {
    label: "assets/favicon-*.svg",
    match: (f) => f.startsWith(`assets${sep}favicon-`) && f.endsWith(".svg"),
    budgetGzipBytes: 336, // seed: 305
  },
];

/**
 * Recursively list every file under a directory.
 * @param dir Directory to walk.
 * @returns Absolute-from-cwd file paths.
 */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Find the first budget entry whose matcher accepts the given dist/web
 * relative path.
 * @param relPath Path relative to dist/web.
 * @returns The matching budget entry, or undefined if unbudgeted.
 */
function findBudget(relPath) {
  return BUDGETS.find((b) => b.match(relPath));
}

/**
 * Format a byte count as decimal kB (bytes / 1000), matching vite's own
 * build-output convention.
 * @param bytes Byte count.
 * @returns A one-decimal kB string.
 */
function kb(bytes) {
  return (bytes / 1000).toFixed(1);
}

function run() {
  if (!existsSync(DIST_WEB)) {
    console.log(`${DIST_WEB} not found — run npm run build:web first.`);
    process.exit(0);
  }

  const files = walk(DIST_WEB)
    .map((f) => relative(DIST_WEB, f))
    .sort();

  let totalRaw = 0;
  let totalGzip = 0;
  let overBudget = 0;
  const rows = [];

  for (const relPath of files) {
    const buf = readFileSync(join(DIST_WEB, relPath));
    const raw = buf.length;
    const gzip = gzipSync(buf).length;
    totalRaw += raw;
    totalGzip += gzip;

    const budget = findBudget(relPath);
    let status = "UNBUDGETED";
    if (budget) {
      status = gzip > budget.budgetGzipBytes ? "WARN" : "PASS";
      if (status === "WARN") overBudget += 1;
    }

    rows.push({
      file: relPath,
      rawKb: kb(raw),
      gzipKb: kb(gzip),
      budgetKb: budget ? kb(budget.budgetGzipBytes) : "-",
      status,
    });
  }

  const widths = {
    file: Math.max(4, ...rows.map((r) => r.file.length)),
    rawKb: Math.max(7, ...rows.map((r) => r.rawKb.length)),
    gzipKb: Math.max(8, ...rows.map((r) => r.gzipKb.length)),
    budgetKb: Math.max(9, ...rows.map((r) => r.budgetKb.length)),
  };

  console.log(
    `${"file".padEnd(widths.file)}  ${"raw kB".padStart(widths.rawKb)}  ${"gzip kB".padStart(widths.gzipKb)}  ${"budget kB".padStart(widths.budgetKb)}  status`,
  );
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(widths.file)}  ${r.rawKb.padStart(widths.rawKb)}  ${r.gzipKb.padStart(widths.gzipKb)}  ${r.budgetKb.padStart(widths.budgetKb)}  ${r.status}`,
    );
  }

  console.log(
    `\nPERF-BUNDLE files=${files.length} total_raw_kb=${kb(totalRaw)} total_gzip_kb=${kb(totalGzip)} over_budget=${overBudget}`,
  );
  process.exit(0);
}

run();
