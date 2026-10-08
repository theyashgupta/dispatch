# G17 Boards Foundation Roadmap

Slug: g17-boards. Decision register: `.roadmap/g17-boards/decisions.md`. Deviations: `.roadmap/g17-boards/changed-decisions.md`. Repo: `dispatch/` (worktree on branch GROUP-17, cut from origin/main at 118fb5d after PRs #187 and #188).

## What we are building

Dispatch stores more than one board. A board is one project with a key, a name, a sessions folder, repositories and a policy. The existing data moves to the default board `LOCAL` with no loss, and each id, tmux name, branch and worktree of today stays valid. The API and the event stream work on one board at a time, and a request with no board works as today. The user sees a boards page and a board switcher, and works on one board at a time. A user with one board sees the app of today.

## Tickets in scope

| Ticket | Title | Unit |
| - | - | - |
| LOCAL-85 | Boards: data model, migration and store scoping | 1 |
| LOCAL-86 | Boards: board-scoped API, stream, identifiers and workspaces | 2 |
| LOCAL-87 | Boards: boards page, board switcher and board-scoped routes | 3 |

## Governing documents

`dispatch/docs/standards/orchestration-design.md` (D-1 to D-9, with the D-1 amendment of 2026-10-06), `dispatch/docs/research/orchestration-research.md` section 2, `dispatch/docs/standards/orchestration-ui-spec.md` (Information architecture, Screen 1, Screen 2), `/Users/yash/dispatch-workspaces/research/orchestration-initiative-research.md` section 4. A decision record wins over ticket text (R-02).

## Verified findings

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| No table or type has a board id | research 4 | Confirmed | live schema: cards(id, data), meta(id=0, data), events, archive, items, push_subscriptions; no board column |
| Counters for LOCAL and GROUP live in the meta row | research 4 | Refined | one prefix map `identifierCounters` plus legacy fields; `nextIdentifier(prefix)` at `board.store.ts:966-970`; live value `{"LOCAL":94,"GROUP":17}` |
| Config holds `workspaceRoot` and `repoPaths` | research 4 | Refuted for `repoPaths` | the loader retires `repoPaths` and `baseBranches` (D-1 amendment); live `config.json` keys hold `workspaceRoot` and no `repoPaths` |
| Registered workspace folders live in the meta row | research 4 | Confirmed | meta keys: syncedAt, workspaceFolders (1 entry live), lastUsed, identifierCounters, localTicketCounter, groupTicketCounter, schemaVersion, sourceCursors |
| A schema version mechanism exists | our analysis | Confirmed | `meta.schemaVersion` (live value 2), `SESSION_SCHEMA_VERSION = 2` at `board.store.ts:268`, forward guard `assertSchemaOpenable` at `:310`, data-gated migration in `load()` at `:1029-1092`; `pragma user_version` is 0 and unused |
| A pre-migration copy pattern exists | our analysis | Confirmed | `snapshotPreV3()` at `board-db.ts:698` (never rotated, guarded by existsSync) and the rotating `.bak.1` to `.bak.5` chain (`backupTick`, `:667`); live folder has `.bak.1` to `.bak.5` |
| Each card persists as one JSON blob, keyed by a unique id | our analysis | Confirmed | `cards(id TEXT PRIMARY KEY, data TEXT)`; `persist` writes the full card set in one transaction (`board-db.ts:579-646`) |
| Live data volume | our analysis | Measured | snapshot of `~/.dispatch/board.db` on 2026-10-06 (read-only backup): 111 cards (90 LOCAL tickets in done/in_progress/todo, 17 GROUP cards), 788 events (0 with a null or orphan card_id), 0 archive rows, 0 items |
| The store is a module singleton with one write queue | research 4 | Confirmed | `export const store = new BoardStore()` at `board.store.ts:4313`; `enqueue` at `:904`; 4313 lines |
| Routes reach the store only through `boardRepository` | our analysis | Confirmed for routes and services | dependency-cruiser rule `board-store-through-repository` (`.dependency-cruiser.cjs:45-51`); adapters `poller.ts:6` and `markers/watcher.ts:2` import the store directly |
| One-board assumptions in the store | ticket LOCAL-85 | Confirmed | `listCards` (`:2828`), `cardsWithSession` (`:2818`), `sessionsWithTmux` (`:2868`), `sessionsDueForCleanup` (`:2937`), `trackedIssueIds` (`:1369`), `mirrorMemberColumn` (`:869`) |
| The session saga reads one workspace root | research 4 | Confirmed | `workspacePath = path.join(config.workspaceRoot ?? "", sessionName)` at `start-session.ts:174`; `dsp-` + sessionName at `:173` |
| Five id validators accept `^[A-Za-z0-9]+-\d+$` | D-2 | Confirmed | `steps.ts:56`, `cards.route.ts:253`, `:310`, `:344`, `linear-sync.ts:26`; `<KEY>-<n>` passes all five |
| The hook route resolves a card from its token only | LOCAL-86 | Confirmed | `resolveHookToken` at `hooks.route.ts:46`, registry at `hook-tokens.ts:82`; no board input needed |
| Linear cards enter through the store, not a route | D-1 | Confirmed | `reconcile()` in `store/mapping.ts:150`, called inside the store queue at `board.store.ts:4253`; card id is the Linear identifier |
| SSE already sends per-client frames | LOCAL-86 | Confirmed | client map with per-client `doneLimit`, snapshots memoized per `doneLimit` (`sse.route.ts:20`, `:80`, `:106-114`); activity events go to all clients (`:119`) |
| A fake `claude` binary exists for tests | brief item 8 | Confirmed | `src/server/test-support/fixtures.ts:14-141`, put on PATH by `isolateEnv()` |
| A sandbox instance uses a private tmux server | our analysis | Confirmed | `adapters/tmux.ts:17-25` when the data folder is not `~/.dispatch`; `DISPATCH_DIR` in `store/data-dir.ts` |
| A golden or recorded response harness exists | LOCAL-86 AC | Refuted | none found; Unit 2 builds one |
| The terminal invariant script is an npm script | LOCAL-87 | Refuted | `scripts/panel-mount-92.mjs` runs with `node` directly |
| The board URL form | LOCAL-87 | Settled by the UI spec | search parameter `board`; no parameter shows `LOCAL`; `/boards` is not board-scoped (`orchestration-ui-spec.md` Routes) |
| The LOCAL-77 cutover is on main | Unit 3 precondition | Not yet | no commit subject names LOCAL-77 in `git log origin/main` on 2026-10-06; legacy routes `board`, `inbox`, `today`, `activity`, `flow`, `sessions`, `ask` still render `src/web/features` |
| Do Not Change contract text | our analysis | Drift noted | item 4 still names `board.json`; the store is SQLite `board.db` and imports `board.json` once. Out of scope; Unit 1 edits only items 1 and 3 text that D-1 and D-4 require |

## Architecture decisions

The full register is `.roadmap/g17-boards/decisions.md` (S-01 to S-13 standing rules, R-01 to R-20). The decisions that shape the units:

1. Board key is the board id. `board_key` goes on cards, events and archive. Items and push subscriptions stay global (R-03).
2. Counters stay in the global prefix map. The meta row stays global and keeps `workspaceFolders` and `lastUsed` for `LOCAL`. A new board keeps its values on its `boards` row (R-04, R-05).
3. The migration is schema version 2 to 3 on the existing gate, data-gated, one transaction, with a never-rotated pre-migration copy (R-06).
4. One store, one database file, one write queue. Collection reads and creates take a required branded `BoardKey`. Per-card operations stay keyed by the unique card id (R-08, R-09).
5. Unit 1 passes `LOCAL` at each call site. Unit 2 resolves the `board` query parameter (R-10, R-12).
6. G17 attention count is the count of `needs_input` cards (R-14).
7. Unit 3 waits for LOCAL-77 on origin/main (R-18).

## Rejected alternatives

- One store instance or one database file per board: it breaks the single writer (contract item 9) and needs a cross-file transaction for a unique card id.
- A counter row per board: D-2 rejects it; the prefix map is unique per key.
- A board key on items: D-1 rejects it.
- A path prefix `/api/boards/:key/...` on each route: D-4 rejects it; it duplicates routes and breaks contract item 3.
- Unit 1 and Unit 2 in one unit: the store change alone is the risk to user data. It needs its own no-budget gate and its own PR. Unit 2 is mechanical route volume on top.
- Start Unit 3 on the legacy trees: the direction forbids it, and the cutover deletes those trees.
- An optional `boardKey` parameter that defaults inside the store: it cannot prove "no store read with no board id" (LOCAL-85 AC).

## Open questions

- Q-1 (settled by U3-01): LOCAL-87 asks to "remember the last board per browser", and the UI spec says that a URL with no `board` shows `LOCAL`. The recommended answer is to keep the URL rule and use the remembered board only where no URL decides the board. The Unit 3 grill settles where that is (for example the app entry `/` and the command palette default).
- Q-2 (settled by U2-04): the name and shape of the per-board count route (attention, running, open groups) that the switcher and the boards page share.

## Units

### Unit 1: Boards data model, migration and store scoping
- **Tickets:** LOCAL-85
- **Repos:** dispatch (1 PR)
- **Depends on:** none
- **Delivers:** A `boards` table, a `board_key` on cards, events and archive, a schema 2 to 3 migration that puts each existing row on `LOCAL`, and a store whose collection reads and creates require a `BoardKey`.
- **Acceptance boundary:** On a sandbox copy of the live data folder, the Unit 1 build migrates, the counts before and after are equal (cards 111, events 788, plus seeded archive rows and items), a second boot changes nothing, a forced failure leaves the original file intact, a two-board store test keeps cards and counters apart, a fake `claude` session started before the migration keeps its status updates, `env -u NODE_ENV npm run check` is green, and the HTTP behaviour of the server is unchanged.
- **Spec artifacts:** none (no UI). Text artifacts: D-1 board row fields, D-2 key rule, D-6 policy defaults table.
- **Execution:** `-qa-subagent`, no-budget (migration and store scoping touch the data of each user)
- **PRD:** `dispatch/.planning/prds/g17-boards-unit-1.md` (6 phases)
- **Status:** shipped (PR #189, specs in PR #194)
- **Risk notes:** `board.store.ts` is 4313 lines with about 100 repository methods, so the scoping diff is wide. GROUP-14 and GROUP-15 edit `board-db.ts`, `board-repository.ts` and `shared/types.ts` (S-12). The live folder has 0 archive rows and 0 items, so the proof must seed them. The forward guard means a 4.2 build refuses a migrated board; the pre-migration copy is the rollback path, and the PRD must state that in the ARCHITECTURE downgrade section.
- **Scope corrections:** Items get no board key. Counters stay global. The meta row stays (R-03 to R-05, changed-decisions.md). No `orchestrators` field (R-11). The contract item 1 text gains `boardKey` in the same PR (D-1).

### Unit 2: Board-scoped API, stream, identifiers and workspaces
- **Tickets:** LOCAL-86
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1
- **Delivers:** Board routes (list, create, read, update, archive, restore), the optional `board` query parameter on each collection route, a board-scoped SSE stream, a per-board count route, filtered list routes for cards and sessions, and a session start that uses the sessions folder and repositories of the board.
- **Acceptance boundary:** With two boards in a sandbox, a client on board A gets no card of board B in the snapshot or the stream; at least 20 recorded requests with no board return the same body as the Unit 1 build (R-17); a group started on board B with a fake `claude` creates its worktrees under the sessions folder of B and reaches running; a hook call for a card on B updates that card; an invalid board body returns the typed error shape; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** none (no UI). Text artifacts: D-4 route rules, the UI spec Screen 1 key error copy (the server error strings that the form shows), contract item 3 text.
- **Execution:** `-qa-subagent`, budget (routes on the settled zod and typed-error pattern; the loop may narrow the SSE and saga phases to no-budget)
- **PRD:** `dispatch/.planning/prds/g17-boards-unit-2.md` (7 phases)
- **Status:** shipped (PR #191, specs in PR #194)
- **Risk notes:** The SSE memo key changes from `doneLimit` to board plus `doneLimit`; activity events must be filtered per client. The Linear team list read for key validation must not block a create when Linear is off. `docs/ARCHITECTURE.md` is a shared file (S-12).
- **Scope corrections:** Restore route added (R-13). Attention count is the `needs_input` card count (R-14). The poller placement by `linearTeamKeys` lands here (R-15).
- **Carried from Unit 1:** Read `.roadmap/g17-boards/changed-decisions.md` (U1-06, U1-07 copy refresh and blob stamp, U1-08 rename and rollback text, U1-10) and the Unit 2 carry items in `todo.md` before Phase 1. The store throws `BoardUnavailableError` (map it to a typed 4xx). `boardWorkspace` in `services/domain/board-workspace.ts` is ready for the saga; remove its `knip.json` production entry once `start-session.ts` and `steps.ts` call it. The board catalog methods return live objects and do not validate paths or `checkCommand`, so the route zod schemas are the trust boundary. Each Unit 2 gate fence now ends with a `with-server.sh` probe on `.sandbox/g17-u2/dispatch-dir` port 48712 (changed-decisions S-02). Sandbox gotchas: strip `cleanupDueAt` before any boot; the fake `claude` must answer `-version` with 2.1.207 or higher; print a pane marker before the first hook call.

- **Carried from Unit 2:** Read `.roadmap/g17-boards/changed-decisions.md` (U2 entries: the LOCAL repository rule, the Linear read cache, `team-key-taken`, the last repository refusal, the starting-card archive refusal, the folders route copy, the 409 group member refusal) and the Unit 3 items in `todo.md` before Phase 1. Board error bodies are `{ error: <UI copy>, code }`; schema failures stay `{ error }`. `GET /api/boards/LOCAL` returns the resolved `workspaceRoot`, so the edit form can echo it back. A non-LOCAL repository with no `.git` reads "This folder does not exist." on create and PATCH (no UI spec copy yet, todo.md). `GET /api/boards` returns `{ boards, knownLinearTeamKeys }` (U2-19). The board router is case sensitive. Unit 2 gate fences use the `with-server.sh` probe on `.sandbox/g17-u2/dispatch-dir` port 48712; that folder now holds boards ACME and QA7 from the QA runs.

### Unit 3: Boards page, board switcher and board-scoped routes
- **Tickets:** LOCAL-87
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 2, and the LOCAL-77 cutover commit on origin/main (R-18)
- **Delivers:** `modules/boards/` with the boards page and the create, edit, archive and restore flows, a board switcher in the sidebar header with the `b` shortcut and palette entries, the `board` search parameter on each board-scoped route and query key, and a remembered last board per browser.
- **Acceptance boundary:** In a real browser at 1440 px, 1024 px and 390 px in both themes on a sandbox server: the boards page, create board and the switcher match the spec copy and states; a ticket created and started on a second board with a fake `claude` shows on that board only; a board change keeps the open terminal frame and its scrollback; with one board each page sends the same requests and shows the same content as before; each deep link of today opens the right view; `node scripts/panel-mount-92.mjs` passes; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** `orchestration-ui-spec.md` sections Information architecture (Routes, Where each screen lives, Navigation rules), Screen 1 Boards page (Data, Layout, Parts, States), Screen 2 Board switcher, and the cross-screen keyboard rules. Sketches: `docs/research/sketches/boards.html`, `switcher.html`. Screenshots: `boards-1440-light.png`, `boards-1440-dark.png`, `boards-390-light.png`, `boards-390-dark.png`, `switcher-1440-light.png`, `switcher-1440-dark.png`, `switcher-390-light.png`, `switcher-390-dark.png`. Verbatim copy blocks of Screen 1 Parts and States (for example "Archive board <name>?", "The board leaves the switcher. Its cards and sessions stay. You can restore it from Archived boards.", "Board <name> archived.", the four key errors) and of Screen 2 ("Manage boards", "<n> items need attention", "Counts from <time>"), and the toast "Board <KEY> is not available.".
- **Execution:** `-qa-subagent`, budget (module and shadcn patterns exist)
- **PRD:** `dispatch/.planning/prds/g17-boards-unit-3.md` (6 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** Blocked on LOCAL-77. GROUP-14 deletes the legacy trees and rewrites `__root.tsx` and the route tree (S-12). The terminal frame must not remount on a board change. The "Add orchestrator" button of Screen 5 and the `/dashboard` route belong to LOCAL-91 and LOCAL-92, not here.
- **Scope corrections:** The Inbox page shows the global items plus the Inbox-column cards of the selected board (D-1). The form has the `linearTeamKeys` field and the key clash warning (D-1, D-2). Q-1 settles the remembered board.
- **Carried from Unit 3 (to /ship):** Unit 3 is the last unit. Before the Unit 3 PR, merge origin/main and fix the S-12 conflicts in todo.md (origin/main 1bcdc448 tests call `boardSnapshotKeys.detail(n)` and add `src/web/lib/app-store.test.ts`). The 13 new Unit 3 spec files ride `test/g17-boards-unit-3-specs`; the 38 edited existing test files and `tests/visual/routes.spec.ts` (route count 21) stay on the unit branch. Read the Unit 3 rows of changed-decisions.md and todo.md (13 Medium readiness rows accepted, ranked follow-ups) before review.

## Progress log

| Date | Unit | Outcome | Deviation from plan |
| - | - | - | - |
| 2026-10-06 | all | roadmap written, awaiting approval | none |
| 2026-10-06 | all | roadmap approved by the user | none |
| 2026-10-06 | 1 | grilled (U1-01 to U1-23), PRD written | none |
| 2026-10-06 | 2 | grilled (U2-01 to U2-19), PRD written | U2-19 added during the Unit 3 grill (known Linear team keys in the board list) |
| 2026-10-06 | 3 | grilled (U3-01 to U3-19), PRD written before the LOCAL-77 cutover | execution gated by R-18; U3-17 lets the loop adopt post-cutover paths |
| 2026-10-06 | 1 | execution started (roadmap-loop armed) | none |
| 2026-10-07 | 3 | execution started on feat/GROUP-17-unit-3-boards-ui from origin/main a275b908 (LOCAL-77 landed as #202), roadmap loop re-armed | branch from origin/main, not from Unit 2 (Units 1 and 2 shipped) |
| 2026-10-06 | 1 | built, awaiting /ship: 6 phases gate=pass, sweep clean, readiness audit with no BUG row, `npm run check` green, migration, forced failure, two boards and session continuity proven on a live copy | 11 execution deviations in changed-decisions.md (copy refresh and pre-v3 alignment, blob stamp, schema version rename, rollback text, harness probes); Unit 2 carry items in todo.md |
| 2026-10-06 | 2 | execution started on feat/GROUP-17-unit-2-board-api (stacked on Unit 1) | none |
| 2026-10-06 | 2 | built, awaiting /ship: 7 phases gate=pass, sweep clean, unit-gate readiness with no BUG row (7 Medium rows accepted in todo.md), `npm run check` green, recorded comparison 36 no-board requests equal to the Unit 1 build, board isolation, ACME group start and ACME hook proven on a sandbox | 8 execution deviations in changed-decisions.md (LOCAL repository rule, Linear read cache, duplicate team key, last repository, folders route copy, starting-card archive, test file names, 409 member refusal) |
| 2026-10-06 | 1 | shipped: PR #189, squash d542977 | specs split to test/g17-boards-specs. Supply-chain scan red on #189 (same failure as main, not caused by the unit) |
| 2026-10-06 | 2 | shipped: PR #191, squash e38f5a2, all checks green after main gained the supply-chain fix (#190) | none |
| 2026-10-06 | 1, 2 | specs shipped: PR #194, squash 9d2938d (17 new spec files) | known poller.test.ts flake in the local check, passed alone |
| 2026-10-07 | 3 | built, awaiting /ship: 6 phases gate=pass, unit sweep clean, unit-gate readiness audit with no open BUG (BUG-1 CI visual route count fixed; 13 Medium rows accepted in todo.md), `npm run check` and `npm run test:visual` green, terminal kept across a switch, ACME ticket start on a fake `claude`, one-board parity proven on a sandbox | Unit 3 decision changes in changed-decisions.md (U3 entries incl. U3-UI-COPY and the J02 cold-load toast); specs held for test/g17-boards-unit-3-specs |
