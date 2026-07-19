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

**After:** _(pending — no boot optimization shipped yet)_

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

**After:** _(pending — no subprocess-load optimization shipped yet)_

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

**After:** _(pending — no SSE optimization shipped yet)_

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

**After:** _(pending — no board re-render optimization shipped yet)_

## Bundle weight

_Pending — PERF-03 (`ANALYZE=1` `rollup-plugin-visualizer` + `scripts/bundle-budget.mjs`) not yet
built._

## React Compiler decision

_Pending — PERF-04 spike (measured build-time dep cost + board re-render before/after with
`babel-plugin-react-compiler`) not yet run. Adopt/reject decision will be recorded here as a Key
Decision either way._
