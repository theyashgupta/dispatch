# Performance baselines

Measurement-first discipline for Phase 58 (PERF-01..04): no optimization ships without a
before/after number recorded here. The four harnesses below (`scripts/perf-boot.mjs`,
`scripts/perf-subproc.mjs`, `scripts/perf-sse.mjs`, `scripts/perf-rerender.mjs`) each print a
machine-parsable `PERF-<NAME> ...` summary line; every entry in this file quotes that exact line.
If a hot path's numbers show it is already fine, shipping ZERO optimizations for it is a
sanctioned outcome — the harness + numbers are the deliverable either way.

`scripts/perf-rerender.mjs` is reused UNMODIFIED for the PERF-04 React Compiler spike; the spike
MUST run it in the same serve mode recorded below (`prod`) so the with/without comparison is
like-for-like.

Every optimization commit that touches a measured hot path must add an `**After:**` line under
the relevant section, citing the harness command and its output, so a reviewer can diff the
before/after without re-running anything themselves.

## Boot

- **Date:** 2026-07-19
- **Git SHA measured:** `9a419b7`
- **Machine:** Apple Silicon, local (Node v24.18.0, repo floor >=22.22)
- **Command:** `npm run build && node scripts/perf-boot.mjs --runs=10`
- **Method:** 1 discarded warmup boot (pays one-time seeding: playbook seed, hook-artifact
  install, fresh `board.db` creation) + 10 measured cold starts of the production build
  (`NODE_ENV=production node dist/server/bootstrap/index.js`) against an isolated sandbox `HOME`
  (no `linearApiKey` — poller stays off, deterministic). Timed from spawn to the first `200` on
  `GET /api/board`.

```
warmup  243.4ms (discarded)
run 01  223.1ms
run 02  217.2ms
run 03  221.5ms
run 04  221.3ms
run 05  220.3ms
run 06  220.5ms
run 07  223.0ms
run 08  221.4ms
run 09  220.4ms
run 10  220.0ms

PERF-BOOT n=10 mean=220.9 p50=221.3 p95=223.1
```

**After:** N/A — ship-zero verdict recorded below; no boot optimization was needed, so there is
no before/after pair to record for this path.

**Verdict:** ship-zero — p50=221.3ms/p95=223.1ms at baseline is already fine because it is
well under the ~1s threshold at which a serial-await boot chain would need parallelizing for a
local single-user tool; the interfaces guardrail's own criterion ("if p50 boot is already well
under ~1s, ship zero") is met with room to spare. The candidate `Promise.all` regroupings named
in this plan's interfaces block (`installHookArtifacts`/`checkHooksCapability` alongside
`seedPlaybooks`/`store.load`; `reconcileSessions` alongside `resolveEditors`) were read against
`src/server/bootstrap/index.ts`'s actual callees and are real, data-independent candidates — but
shaving a few tens of ms off a 221ms local boot buys no perceptible benefit for a tool whose
"instant startup" bar is already cleared, and the ordering constraints (setHookTokenReleaser
before store.load; capable+port both needed for setHooksRuntime; startPoller/startMarkerWatcher/
startUpdateCheckLoop after listen) narrow any regrouping to a marginal, high-review-cost change
for an unmeasurable win. `src/server/bootstrap/index.ts` is left untouched.

## Subprocess load

- **Date:** 2026-07-19
- **Git SHA measured:** `9a419b7`
- **Machine:** Apple Silicon, local
- **Commands:**
  - `node scripts/perf-subproc.mjs --window=0` (boot-only profile)
  - `node scripts/perf-subproc.mjs --window=30` (30s steady-state drive window)
- **Method:** production build boots with `DISPATCH_PERF_EXEC=1` (env-gated counter/timer wrapped
  around the sole `run()` exec chokepoint in `src/server/adapters/exec.ts` — NEW-11, execa was
  never installed). `--window=0` SIGTERMs immediately after readiness, capturing only boot-phase
  `run()` calls (preflight binary probes, hook-capability check, editor resolution). `--window=30`
  additionally holds the process open so the 2s marker-watcher tick runs 15x with zero live
  sessions before SIGTERM.

```
boot-only (window=0):
  cmd                  count    total_ms
  claude                   1        53.7
  tmux                     1         6.7
  which                    7        38.1
PERF-SUBPROC window_s=0 calls=9 total_ms=98.4 calls_per_min=0.0

30s steady-state (window=30):
  cmd                  count    total_ms
  claude                   1        48.7
  tmux                     1         4.4
  which                    7        41.5
PERF-SUBPROC window_s=30 calls=9 total_ms=94.6 calls_per_min=18.0
```

**Finding:** the watcher makes ZERO additional `run()` calls across the 30s steady-state window
beyond the 9 calls already made during boot (identical call count in both runs) — with zero live
sessions and `statusChannel: "auto"`, `cardsWithSession()` is empty so the tick's per-session scan
loop never executes. This matches the research's predicted "near-zero steady-state" finding; the
subprocess-load hot path is a legitimate ship-zero-optimizations candidate under this
zero-session-load profile. A future re-measurement with live sessions attached (session-load
`capture-pane` cost) is a separate, not-yet-run scenario.

**After:** N/A — ship-zero verdict recorded below; no subprocess-load optimization was needed, so
there is no before/after pair to record for this path.

**Verdict:** ship-zero — `calls_per_min=18.0` at 30s steady-state is identical to the boot-only
`calls_per_min=0.0` window's call COUNT (9 calls both windows; the `calls_per_min` field is a
rate artifact of the shorter 0s window, not a real steady-state load), confirming the watcher's
per-session scan loop makes ZERO additional `run()` calls beyond boot when there are no live
sessions, exactly as the research's near-zero-steady-state prediction (statusChannel driving
`cardsWithSession()` empty) anticipated. There is no per-session scan-loop cost to parallelize at
this profile — parallelizing an empty loop optimizes nothing. `src/server/adapters/markers/
watcher.ts` is left untouched; the 2s tick constant (`setTimeout(() => void tick(), 2000)`,
watcher.ts:284) is confirmed unchanged. The live-session variant flagged in 58-01 as a distinct
not-yet-run scenario remains future work, not in scope for this ship/no-ship decision against the
recorded baseline.

## SSE fan-out

- **Date:** 2026-07-19
- **Git SHA measured:** `9a419b7`
- **Machine:** Apple Silicon, local
- **Command:** `node scripts/perf-sse.mjs`
- **Method:** production build boots in a sandbox seeded with ONE real (read-only) Linear sync
  card (only `apiKey`/`filters` lifted from the real `~/.dispatch/config.json`; `board.db` never
  copied). For N in {1, 4, 16}: open N concurrent raw-HTTP readers on `GET /api/stream`, consume
  each client's initial resync frame, fire one local-only `POST /api/cards/:id/move` (`todo` ->
  `done`, never a session-starting move), and time each client's next board `data:` frame arrival
  (named `ping`/`activity` frames excluded). Card restored to `todo` between runs and demoted back
  to `inbox` at teardown.

```
seeded card YAS-44, column=inbox
PERF-SSE n=1 median_ms=3.3 max_ms=3.3
PERF-SSE n=4 median_ms=2.8 max_ms=2.9
PERF-SSE n=16 median_ms=2.8 max_ms=3.0
```

**Finding:** fan-out latency does not scale with client count in this range (1 -> 16 clients:
~2.8-3.3ms flat) — `sse.route.ts` already serializes each snapshot ONCE per broadcast
(`const payload = frame(snapshot)` outside the client `for` loop) before looping `safeWrite` over
the `Set<Response>`, so N-client fan-out is not the bottleneck the naive per-client-serialize
mistake would have created. This hot path is a legitimate ship-zero-optimizations candidate at
this client count.

**After:** N/A — ship-zero verdict recorded below; no SSE fan-out optimization was needed, so
there is no before/after pair to record for this path.

**Verdict:** ship-zero — `n=16 max_ms=3.0` (flat against `n=1 max_ms=3.3`) is sub-perceptible
fan-out latency that does not scale with client count in this range, confirming
`sse.route.ts` already serializes the broadcast payload once per snapshot outside the client
loop rather than per-client — the exact naive mistake this path would need fixing if present.
There is no bottleneck here to optimize.

## Board re-renders

- **Date:** 2026-07-19
- **Git SHA measured:** `e6adc16`
- **Machine:** Apple Silicon, local (Chrome headless via `--headless=new`)
- **Serve mode:** `prod` — the production build (`NODE_ENV=production node dist/server/
bootstrap/index.js`) registered with the DevTools-hook shim on the FIRST attempt (commits > 0
  after the first interaction), so no `--dev` fallback was needed. **PERF-04's spike must reuse
  this exact `prod` mode** for its with/without comparison to stay like-for-like.
- **Command:** `npm run build && node scripts/perf-rerender.mjs` (run 3 times)
- **Method:** headless Chrome (`--headless=new --remote-debugging-port=9358`, isolated
  `--user-data-dir`) driven via raw CDP over Node's built-in global `WebSocket`/`fetch` (zero new
  npm dependency — the technique proven in 55-02/57-04). A `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
  shim is injected via `Page.addScriptToEvaluateOnNewDocument` BEFORE `Page.navigate`, so it is in
  place before react-dom's module-load-time hook registration; every commit anywhere in the tree
  increments a page-global counter via `onCommitFiberRoot`. A fixed interaction script runs
  against one real (read-only) Linear-synced card in an isolated-HOME sandbox (`apiKey`/`filters`
  lifted from `~/.dispatch/config.json`; `board.db` never copied): (a) view toggle
  Board→Orca→Board, (b) inbox open/close, (c) card select + re-select in Orca/docked mode
  (avoiding the DetailPanel overlay-backdrop trap — 55-02 lesson), (d) one SSE-driven board
  mutation via REST (`todo`→`done`→`todo`) while idle on the board. Interactions are dispatched via
  a real DOM `.click()` (React treats a native `click` Event identically regardless of dispatch
  origin), not synthesized CDP pointer events — sufficient for triggering state transitions/commits,
  unlike 57-04's a11y proof which specifically needed real keyboard events to prove input fidelity.

```
run 1   PERF-RERENDER mode=prod total=20 toggle=6 inbox=4 select=4 sse=6
run 2   PERF-RERENDER mode=prod total=20 toggle=6 inbox=4 select=4 sse=6
run 3   PERF-RERENDER mode=prod total=20 toggle=6 inbox=4 select=4 sse=6

median: PERF-RERENDER mode=prod total=20 toggle=6 inbox=4 select=4 sse=6
```

**Spread note:** three pre-commit dry runs (same harness, uncommitted) showed occasional
`toggle=7`/`total=21` instead of `toggle=6`/`total=20` — traced to `SyncStrip`'s own 1s
`setInterval` tick (unrelated to the interaction script) occasionally landing inside the
350ms toggle settle-window and contributing one extra whole-tree commit, since
`onCommitFiberRoot` fires once per commit for the single React root regardless of which
component scheduled it. The 3 official runs above (recorded at the committed SHA) were
click-for-click identical; this variance is expected and orthogonal to any future
optimization's before/after delta, since both sides of a comparison are subject to the same
clock-tick noise.

**Finding:** 20 commits across the whole fixed interaction script is not obviously excessive for
4 distinct interaction categories touching view-mode swaps, a full-panel mount, and a
`Board`-column re-render on every card move — but there is no prior baseline to compare against,
so no "this number is bad" claim is made here. This is the number any later frontend
optimization task (58-05) and the PERF-04 Compiler spike must cite.

**After:** N/A — ship-zero verdict recorded below; no board re-render optimization was needed, so
there is no before/after pair to record for this path.

**Verdict:** ship-zero — the React Compiler decision above is REJECT (zero measured commit
reduction on this exact fixed interaction script, at a real build-time and bundle-weight cost),
so the compiler is not this path's optimization; per the REJECT branch, manual memoization is
the only remaining lever, gated on a specific interaction showing excessive commits. None does:
`toggle=6` (2 full view-mode swaps), `inbox=4` (2 open/close cycles), `select=4` (select +
re-select in Orca), and `sse=6` (2 card moves, each requiring a `Board`-column re-render by
design) are each proportionate to the distinct state transitions they exercise — no single
interaction stands out as disproportionate against the others, and the baseline's own finding
already noted no "this number is bad" claim could be made without a comparison point. Baseline
counts are already proportionate; no targeted memoization is applied. No files touched, so no
DetailPanel-tree change occurred and the PANEL-03 lsof re-proof is not required for this plan
(compiler was not adopted).

## Bundle weight

- **Date:** 2026-07-19
- **Git SHA measured:** `b4a6423`
- **Command:** `npm run build:web && node scripts/bundle-budget.mjs`
- **Method:** production `vite build` output under `dist/web`, every file's raw byte count and
  gzip byte count (`node:zlib` `gzipSync`, default level) measured directly by
  `scripts/bundle-budget.mjs`. This is the first measured build for the phase — the script's
  `budgetGzipBytes` thresholds are each this build's measured gzip size **+10% headroom**,
  hardcoded as literals with the measured seed value recorded in a trailing comment beside each
  one (`scripts/bundle-budget.mjs`, `BUDGETS` table). `npm run analyze` (`ANALYZE=1 vite build`)
  produces the visual treemap at `dist/bundle-stats.html` for interactive drill-down; this table
  is the numeric record.

| File                          |  Raw (kB) | Gzip (kB) | Budget gzip (kB, +10%) |
| ----------------------------- | --------: | --------: | ---------------------: |
| `assets/favicon-CVKTVxiB.svg` |       0.5 |       0.3 |                    0.3 |
| `assets/index-DJLXrqcp.js`    |     530.1 |     151.8 |                  167.0 |
| `assets/index-DJYO3imh.css`   |       1.7 |       0.8 |                    0.9 |
| `index.html`                  |       0.6 |       0.4 |                    0.4 |
| **Total**                     | **532.9** | **153.3** |                      — |

```
PERF-BUNDLE files=4 total_raw_kb=532.9 total_gzip_kb=153.3 over_budget=0
```

**Note:** hashed chunk filenames (`index-DJLXrqcp.js`, etc.) change on every rebuild;
`scripts/bundle-budget.mjs` matches by stable prefix+extension pattern (`assets/index-*.js`), not
by exact filename, so this table's filenames are illustrative of the SHA above, not a literal
match requirement for future runs.

**After:** N/A — bundle weight is an on-demand audit artifact, not a ship/ship-zero blocking gate
(ROADMAP.md Phase 56 risk note: `scripts/bundle-budget.mjs` deferred to Phase 58 as audit-only,
never a blocking gate), and `over_budget=0` above shows no budget breach requiring action; no
optimization commit was needed against this measured build.

## React Compiler decision

- **Date:** 2026-07-19
- **Git SHA measured:** `ff0664f` (main, unchanged before/after — spike isolated on a throwaway
  `spike/react-compiler` branch, deleted after this decision was recorded)
- **Verdict: REJECT**

### Spike method

Throwaway branch `spike/react-compiler` installed `babel-plugin-react-compiler@1.0.0` (GA,
registry-verified, slopcheck-clean per 58-RESEARCH.md) and wired it into `vite.config.ts`.

**Wiring-shape correction (worth recording):** the plan's assumed wiring —
`react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } })` — does not exist on
`@vitejs/plugin-react@6.0.3`. That version dropped Babel-by-default in favor of Rolldown's native
Oxc transformer and has no `babel` option in its `Options` type at all. The correct current wiring
(confirmed against the plugin's live npm-registry README) is the plugin's own exported
`reactCompilerPreset()` helper, applied through the separate `@rolldown/plugin-babel` package:

```ts
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
});
```

This required two additional devDeps on the spike branch beyond the plan's anticipated single
package: `@rolldown/plugin-babel@0.2.3` (rolldown org, maintained by the Rolldown/Vite team) and
`@babel/core@8.0.1` (peer dep required by the babel bridge), plus `@types/babel__core` for TS.
Both were registry-verified (rolldown/plugins GitHub org; maintainer includes Evan You) before
installing — not slopsquat risk, but a stale-wiring-assumption pitfall for any future spike against
a Rolldown-era `@vitejs/plugin-react`.

**Transform verified applied:** an unminified build (`npx vite build --minify false`, throwaway,
not part of the measured numbers below) shows 1896 occurrences of the compiler's `$[N]` memoization
cache-array pattern across the bundle, plus the `react-compiler-runtime.production.js` module
bundled in — e.g. `StartModal`'s compiled output opens with `$[17] = t6; $[18] = t7;`-shaped cache
writes. The minified production build (used for all measurements below) does not preserve these
literal strings, which is expected of single-chunk ESM minification — the unminified check exists
solely to prove the transform ran, not to be reused as a measurement build.

### Three measured deltas (main SHA `ff0664f`, compiler off vs. spike branch, compiler on)

**Build-time** — median of 3 `npm run build:web` runs (`Date.now()` wrapper), same machine:

|            |   Without |       With |               Delta |
| ---------- | --------: | ---------: | ------------------: |
| run 1      |     372ms |     1710ms |                     |
| run 2      |     366ms |     1684ms |                     |
| run 3      |     368ms |     1683ms |                     |
| **median** | **368ms** | **1684ms** | **+1316ms (+358%)** |

**Bundle** — `node scripts/bundle-budget.mjs` totals, fresh build each side:

|         | Without |  With |            Delta |
| ------- | ------: | ----: | ---------------: |
| raw kB  |   532.9 | 563.5 | +30.6 kB (+5.7%) |
| gzip kB |   153.3 | 165.9 | +12.6 kB (+8.2%) |

**Board re-renders** — `node scripts/perf-rerender.mjs`, `mode=prod` (same pinned serve mode as
the Board re-renders baseline above), same fixed interaction script, 3 runs each side:

|       |                                    Without |                                       With |
| ----- | -----------------------------------------: | -----------------------------------------: |
| run 1 | total=20 (toggle=6 inbox=4 select=4 sse=6) | total=20 (toggle=6 inbox=4 select=4 sse=6) |
| run 2 |                                   total=20 |                                   total=20 |
| run 3 |                                   total=20 |                                   total=20 |

**Delta: 0 commits (0%).** The compiler produced zero measurable re-render reduction on this
fixed interaction script, stable across 3 runs on both sides.

### Compiler-rules audit (`eslint-plugin-react-hooks@7.1.1`)

Open Q1 from 58-RESEARCH.md resolved: `eslint-plugin-react-hooks@7.1.1` (already installed)
covers React-Compiler-derived linting via its `flat.recommended` config, already wired into this
repo's `eslint.config.ts` (`reactHooks.configs.flat.recommended`, line ~441) — no
`eslint-plugin-react-compiler` install was needed.

Ran `npx eslint src/web` against the real tree (no config changes required, on both main and the
spike branch — identical result on both since the rules were already active):

| Rule                                      | Violations |
| ----------------------------------------- | ---------: |
| `react-hooks/refs`                        |          0 |
| `react-hooks/purity`                      |          0 |
| `react-hooks/set-state-in-render`         |          0 |
| `react-hooks/immutability`                |          0 |
| `react-hooks/preserve-manual-memoization` |          0 |

`onInteractionRef` (`StartModal.tsx`) and all 10 `.current`-using files (`UpdateBanner`, `Board`,
`Column`, `CleanupModal`, `FirstRunSetup`, `FolderBrowserModal`, `StartModal`, `MultiSelect`,
`SettingsModal`, `DetailPanel`) were inspected directly: every `.current` read/write happens inside
an event handler, effect, or effect-scheduled callback — none read a ref during render. All 10
classify as **(b) event-handler/effect usage (fine)**; the compiler's `refs` rule (0 violations,
confirmed by the lint run) agrees. No bail-out risk found.

### Rationale

Two of the three deltas are net-negative (build-time +358%, bundle gzip +8.2%) and the third —
the entire reason to adopt — is exactly zero (0 of 20 commits eliminated across a fixed,
representative interaction script covering view-toggle, inbox open/close, card select, and an
SSE-driven mutation). The rules audit found zero bail-out risk, so a REJECT here is not "the
compiler can't run on this tree" — it demonstrably can (1896 memoization sites injected) — but
running it buys nothing measurable while costing real build-time and bundle weight. Per
CONTEXT.md's ORCHESTRATOR ROUTING, evidence favoring REJECT records without a pause: no user
sign-off needed since no build-dep change lands on main.

**Standing concern discharged:** PERF-04 is settled. 58-05 may proceed with targeted manual
memoization where a harness number justifies it — hand-tuned memoization and the compiler are
non-additive strategies (58-RESEARCH.md Pitfall 10), and this REJECT means manual memoization
remains the only lever now that the compiler question is settled, not a stopgap awaiting future
compiler adoption.

**After (main):** N/A — REJECT path, main's `package.json`/`package-lock.json`/`vite.config.ts`
are unchanged from before this plan; no adoption, no post-adoption numbers to record.

## Cleanup

- **Date:** 2026-07-22
- **Git SHA measured:** `ba0386c`
- **Machine:** Apple Silicon, local (Node v22.23.1, repo floor >=22.22)
- **Command:** `npm run build && node scripts/perf-cleanup.mjs --repos=3 --runs=5`
- **Method:** 3 repos, 5 measured runs, each against a FULLY FRESH sandbox: `scripts/perf-cleanup.mjs`
  creates 3 real independent git repos (one commit each), cuts one real worktree per repo under a
  single ticket workspace folder at the exact layout `worktreePath()` builds, seeds one Done card
  directly into a sandbox `board.db`, boots the production build with `DISPATCH_PERF_CLEANUP=1`, and
  drives the REAL `POST /api/cards/:id/cleanup` route (`{"force": false}`, so the preflight
  `worktreeStatus` loop is measured too — the seeded repos are clean, so preflight falls through to
  teardown). Timed via five `performance.now()` brackets inside `cleanupWorkspace` itself (preflight,
  kill, worktree-remove, fs.rm, prune, plus a total), dumped as one `DISPATCH_PERF_CLEANUP_STEPS`
  stderr line per run. This run measures the STILL-SEQUENTIAL pre-fan-out code (three separate
  sequential `for` loops) — the BEFORE number for PERF-01.

```
  run   preflight     kill  wt_remove    fs_rm    prune     total
     1       32.9      0.0       31.3      0.3     27.3      93.4
     2       33.8      0.0       30.7      0.4     25.0      91.8
     3       32.2      0.0       29.5      0.3     24.0      87.5
     4       34.1      0.0       29.9      0.4     26.8      93.1
     5       30.4      0.0       29.0      0.3     24.4      85.7

PERF-CLEANUP repos=3 runs=5 mean=90.3 p50=91.8 p95=93.4
PERF-CLEANUP-STEPS preflight=32.7 kill=0.0 worktree_remove=30.1 fs_rm=0.3 prune=25.5
```

**Before:** the block above — `PERF-CLEANUP repos=3 runs=5 mean=90.3 p50=91.8 p95=93.4` /
`PERF-CLEANUP-STEPS preflight=32.7 kill=0.0 worktree_remove=30.1 fs_rm=0.3 prune=25.5`, measured
against the still-sequential three-loop code at SHA `ba0386c`.

**After:** measured against the working tree landing in this same commit (the `Promise.allSettled`
fan-out of the three per-repo git loops, `fs.rm` left as a single call per the verdict below), same
command, same 3-repos/5-runs shape:

```
  run   preflight     kill  wt_remove    fs_rm    prune     total
     1       16.5      0.0       12.6      0.3      9.8      40.9
     2       13.0      0.0       12.2      0.3      9.7      37.0
     3       12.5      0.0       11.9      0.3      9.4      35.6
     4       14.8      0.0       11.7      0.3      9.8      38.3
     5       13.4      0.0       11.8      0.3      9.8      37.0

PERF-CLEANUP repos=3 runs=5 mean=37.8 p50=37.0 p95=40.9
PERF-CLEANUP-STEPS preflight=14.0 kill=0.0 worktree_remove=12.0 fs_rm=0.3 prune=9.7
```

**Verdict:** ship — mean teardown latency for a 3-repo card drops from 90.3ms to 37.8ms
(**-58%, ~2.4x faster**; p50 91.8ms → 37.0ms, p95 93.4ms → 40.9ms), fanning the three per-repo git
loops out across repos with `Promise.allSettled` instead of running them sequentially. Every
per-step mean drops roughly proportionally (preflight 32.7→14.0ms, worktree_remove 30.1→12.0ms,
prune 25.5→9.7ms) rather than one step alone improving, consistent with all three loops now
genuinely running concurrently across the 3 seeded repos instead of summing their per-repo cost.
`fs_rm_ms` is unchanged (0.3ms both sides, as expected — it was never touched). This is a small
absolute number in wall-clock terms at this project's real worktree sizes, but the relative win is
real and the measurement is honest either way: PERF-01 required a measured before/after pair, not a
minimum delta, and a 2.4x speedup on the dominant cost (the git loops) is a legitimate, non-trivial
result to ship.

**fs.rm vs. git-loop dominance (resolves 71-RESEARCH.md's Open Question 1):** the combined per-repo
git-loop time (`preflight_ms + worktree_remove_ms + prune_ms` = 32.7 + 30.1 + 25.5 = 88.3ms mean)
dwarfs `fs_rm_ms` (0.3ms mean) by roughly 294x at this project's actual worktree sizes (near-empty
seeded repos, consistent with the `PERF-SUBPROC` baseline's single-digit-to-tens-of-ms
per-subprocess-call cost above) — **the git loops dominate, not fs.rm.** Resulting decision for the
next task: the fan-out is scoped to the three per-repo git loops (preflight `worktreeStatus`,
teardown `worktreeRemove`, `worktreePrune`) and `fs.rm` stays a single call spanning the whole
workspace folder, unchanged.
