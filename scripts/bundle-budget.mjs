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
    budgetGzipBytes: 908, // seed: 825 (re-seeded 2026-09-29 with the pre-paint theme script, LOCAL-55)
  },
  {
    label: "assets/main-*.js",
    match: (f) => f.startsWith(`assets${sep}main-`) && f.endsWith(".js"),
    budgetGzipBytes: 80388, // seed: 73080 (the board plus shell; the inbox, orca and settings chunks below are lazy)
  },
  {
    label: "assets/inbox-*.js",
    match: (f) => f.startsWith(`assets${sep}inbox-`) && f.endsWith(".js"),
    budgetGzipBytes: 6961, // seed: 6329 (re-seeded 2026-09-24 with the merged items list, toolbar, row menu and keyboard rows)
  },
  {
    label: "assets/orca-*.js",
    match: (f) => f.startsWith(`assets${sep}orca-`) && f.endsWith(".js"),
    budgetGzipBytes: 3007, // seed: 2733
  },
  {
    label: "assets/settings-*.js",
    match: (f) => f.startsWith(`assets${sep}settings-`) && f.endsWith(".js"),
    budgetGzipBytes: 21245, // seed: 19313
  },
  {
    label: "assets/playbooks-*.js",
    match: (f) => f.startsWith(`assets${sep}playbooks-`) && f.endsWith(".js"),
    budgetGzipBytes: 3963, // seed: 3603 (the playbooks page plus its editor modal, lazy)
  },
  {
    label: "assets/vault-*.js",
    match: (f) => f.startsWith(`assets${sep}vault-`) && f.endsWith(".js"),
    budgetGzipBytes: 5310, // seed: 4828 (the vault page, lazy)
  },
  {
    label: "assets/sessions-*.js",
    match: (f) => f.startsWith(`assets${sep}sessions-`) && f.endsWith(".js"),
    budgetGzipBytes: 3943, // seed: 3584 (re-seeded 2026-09-25 with the sessions toolbar, bulk bar, confirm dialog and keyboard rows)
  },
  {
    label: "assets/pull-requests-*.js",
    match: (f) =>
      f.startsWith(`assets${sep}pull-requests-`) && f.endsWith(".js"),
    budgetGzipBytes: 4861, // seed: 4419 (re-seeded with the Pull Requests detail pane, LOCAL-45)
  },
  {
    label: "assets/errors-*.js",
    match: (f) => f.startsWith(`assets${sep}errors-`) && f.endsWith(".js"),
    budgetGzipBytes: 4266, // seed: 3878 (re-seeded 2026-09-28 with the Errors detail pane and its actions, lazy, LOCAL-46)
  },
  {
    label: "assets/today-*.js",
    match: (f) => f.startsWith(`assets${sep}today-`) && f.endsWith(".js"),
    budgetGzipBytes: 4023, // seed: 3657 (the Today page with chips, list and agenda, lazy, LOCAL-48)
  },
  {
    label: "assets/SlackPage-*.js",
    match: (f) => f.startsWith(`assets${sep}SlackPage-`) && f.endsWith(".js"),
    budgetGzipBytes: 2613, // seed: 2375 (the Slack page list and detail, lazy through the slack barrel's loadSlackPage, LOCAL-47)
  },
  {
    label: "assets/palette-*.js",
    match: (f) => f.startsWith(`assets${sep}palette-`) && f.endsWith(".js"),
    budgetGzipBytes: 2595, // seed: 2359 (the command palette and the cheat sheet, lazy)
  },
  {
    label: "assets/archive-*.js",
    match: (f) => f.startsWith(`assets${sep}archive-`) && f.endsWith(".js"),
    budgetGzipBytes: 2132, // seed: 1939 (the archive page, lazy; the accounts page rides main because the accounts barrel is eager)
  },
  {
    label: "assets/tickets-*.js",
    match: (f) => f.startsWith(`assets${sep}tickets-`) && f.endsWith(".js"),
    budgetGzipBytes: 3744, // seed: 3403 (the tickets page with its row model, lazy)
  },
  {
    label: "assets/meetings-*.js",
    match: (f) => f.startsWith(`assets${sep}meetings-`) && f.endsWith(".js"),
    budgetGzipBytes: 4769, // seed: 4335 (re-seeded 2026-09-28 with the meeting detail pane and its four actions)
  },
  {
    label: "assets/calendar-*.js",
    match: (f) => f.startsWith(`assets${sep}calendar-`) && f.endsWith(".js"),
    budgetGzipBytes: 2655, // seed: 2413 (the Calendar page agenda, lazy)
  },
  {
    label: "assets/ask-*.js",
    match: (f) => f.startsWith(`assets${sep}ask-`) && f.endsWith(".js"),
    budgetGzipBytes: 1955, // seed: 1777 (the ask page, lazy)
  },
  {
    label: "assets/flow-*.js",
    match: (f) => f.startsWith(`assets${sep}flow-`) && f.endsWith(".js"),
    budgetGzipBytes: 3391, // seed: 3082 (the flow page with its toolbar and tokens, lazy; FlowStage rides main through the detail panel)
  },
  {
    label: "assets/preload-helper-*.css",
    match: (f) =>
      f.startsWith(`assets${sep}preload-helper-`) && f.endsWith(".css"),
    budgetGzipBytes: 2215, // seed: 2014 (the token stylesheet with the light block; the build names this chunk preload-helper)
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
