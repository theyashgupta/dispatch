# G14 Backend Standards Rollout Roadmap

## What we are building

Every Dispatch route parses its input with zod and answers errors through one error middleware with typed errors, with each response body byte-identical to today. Then the service layers get lint-enforced boundaries, the board store sits behind a `BoardRepository` interface with a test fake, and the per-layer test conventions are written down. Users see no change.

Slug: `g14-backend`. Decision register: `.roadmap/g14-backend/decisions.md` (R-01 to R-20). Repo worktree: `dispatch/`, branch `GROUP-11`, base `455b5b4` plus the merge of GROUP-10 `feat/LOCAL-63-unit-2-backend-standard` (`6b6dea7`).

## Tickets in scope

| Ticket | Title | Unit |
| - | - | - |
| LOCAL-78 | Backend: zod at every route boundary and the error middleware | 1 |
| LOCAL-79 | Backend: module boundaries, board repository and per-layer tests | 2 |

## Verified findings

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| GROUP-10 Unit 2 branch holds `errors.ts`, the error middleware, zod and the playbooks proof | orchestrator note | Confirmed | merged at `6b6dea7`; `errors.ts` has `HttpError` plus 5 classes; `httpErrorHandler` mounted last at `bootstrap/index.ts:408` |
| 137 `400`, 38 `404`, 47 `409`, 36 `500`, 14 `502` | LOCAL-78 | Refined | after the merge: 130, 37, 46, 32, 13; the difference is playbooks, already converted (R-17) |
| The envelope adds an `error.code` field | LOCAL-78 | Refuted | GROUP-10 R-06 keeps `error` as the code string; `api.ts` reads `body.error` as a string at lines 139, 187, 201, 231, 325, 351, 431, 453 (R-02) |
| Only the five statuses need conversion | LOCAL-78 | Refined | routes also send 401 x5, 403 x3, 413, 422, 429 x3, 503, 504 (R-03, R-17) |
| 101 hand `typeof` checks | LOCAL-78 | Refined | 74 `typeof` in route files, 4 in `remote-auth-gate.ts`; `typeof req` has 1 hit (R-17) |
| 82 route catch blocks | LOCAL-78 | Refined | 73 `catch` keywords in route non-test files |
| A catch can become `next(err)` safely | LOCAL-78 | Refuted | a non-`HttpError` falls through to the Express default handler, which sends HTML 500; today the catches send JSON (R-05) |
| Express catches async throws | implicit | Confirmed | `express` 5.2.1 in `package.json` |
| `viewer-page` 404 converts like the others | LOCAL-78 | Refuted | `viewer-page.route.ts:34` sends text/plain `Not found`; the middleware sends JSON (R-04) |
| 409 bodies are mostly `{ error: string }` | LOCAL-78 | Confirmed | 46 sites; 6 multi-line bodies with extra fields at `cards.route.ts:281, 498, 505, 730, 797` and `github.route.ts:76` |
| Dynamic status sites exist | own check | Confirmed | `status(result.status)` and similar at `archive:22`, `accounts:90`, `connection:61,64`, `cards:170,179,195,825,842`, `linear:17`, `slack:54`, `vault:153`, `images:28` |
| `from "../store/board.store` finds service imports | LOCAL-79 | Refuted | services sit one folder deeper and import `../../store/board.store.js`; the grep matches nothing today (R-13) |
| 60 service files: 29 / 24 / 7 | LOCAL-79 | Refined | 29 / 25 / 7; `domain/errors.ts` is new from GROUP-10 |
| 144 existing tests | LOCAL-79 | Refined | 142 server test files, 228 in `src/` (R-17) |
| Services import the store singleton | own check | Confirmed | 19 service files import `store` from `board.store.ts`; 150 `store.` call sites in services; `store = new BoardStore()` at `board.store.ts:4313` |
| `BoardStore` public surface | LOCAL-79 | Measured | about 104 public methods and 39 private members on the class; about 110 distinct `store.<name>` uses outside `store/` |
| A service already mocks `items.ts`, `mapping.ts` or `claude-sessions.ts` | LOCAL-79 | Refuted | no `mock.module`; only `poller-cursors.test.ts` and `linear-push.test.ts` patch `store` methods |
| The boundaries rule for the services split exists | LOCAL-79 | Refuted | it arrives with GROUP-10 Unit 4 (LOCAL-65), status `not started`; no `feat/LOCAL-65*` or `feat/LOCAL-66*` branch exists (R-14) |
| `dependency-cruiser` is in the check chain | LOCAL-79 | Refuted | not in `package.json`; GROUP-10 Unit 4 adds it (R-14) |
| The config holder pattern exists for injection | own check | Confirmed | `services/infra/config-holder.ts` `setOrchestrationConfig`, called at `bootstrap/index.ts:316` (model for R-09) |
| Production data gate | skill step 4 | Not applicable | Dispatch is a local app; the consumer contract is the web client, checked by grep of `src/web` and by curl and browser checks (R-08, R-18) |

## Architecture decisions

1. Two units, one per ticket, stacked local branches, one squash PR each, specs branch last (R-01).
2. Error body stays `{ error: code, ...details }` with today's string as the code; the 409 contract diff is empty (R-02, R-08).
3. Extend `errors.ts` and the middleware; other statuses use `HttpError` directly (R-03).
4. Convert every JSON error site, fence only non-JSON or streaming sites, name each in the PR (R-04).
5. Catches rethrow typed errors with today's code, never a bare `next(err)` that would send HTML (R-05).
6. Characterization test per route file before its conversion; one commit per route file (R-06, R-07).
7. `BoardRepository` interface plus a forwarding holder defaulting to the real store; bootstrap sets it; a throwing fake for tests (R-09, R-10).
8. Domain files that break the import direction move by `git mv` to orchestration or infra (R-11); routes switch to the repository, adapters and bootstrap stay direct (R-12).
9. Unit 2 needs GROUP-10 Units 4 and 5; merge, never rebase; poll every 15 minutes if absent (R-14, R-15).

## Rejected alternatives

- Nested envelope `{ error: { code, message } }`: breaks 8 web mappers that read `body.error` as a string (GROUP-10 R-06).
- Adding a `code` field beside `error`: the web does not read it, and the ticket AC allows only additive change; it adds bytes to 200+ bodies for no reader. R-02 keeps the bodies byte-identical instead.
- Bare `next(err)` in every catch: sends HTML 500 in place of today's JSON code (R-05).
- Constructor or parameter injection into every service: rewrites about 150 call sites and every service signature. The holder keeps the diff to import lines and matches `config-holder.ts` (R-09).
- A holder with no default: breaks every orchestration test that uses the real store, and rewriting tests is out of scope (R-09).
- `type BoardRepository = Pick<BoardStore, keyof BoardStore>`: `BoardStore` cannot `implements` a type derived from itself, and the ticket asks for a declared interface (R-09).
- Splitting LOCAL-78 into two units (small routes, then cards and board): the orchestrator fixed one unit per ticket; the per-file commits give the same review granularity.

## Open questions

- The Unit 2 scaffold proof slice: `GET /api/health` or an existing unrouted service. Owner: Unit 2 grill (R-16), recommended answer taken.
- Unit 2 start date depends on GROUP-10 Units 4 and 5. Owner: GROUP-10 loop. Unit 2 does its independent phases first (R-14).

## Units

### Unit 1: zod at every route boundary with the error middleware
- **Tickets:** LOCAL-78
- **Repos:** dispatch (1 PR)
- **Depends on:** GROUP-10 `feat/LOCAL-63-unit-2-backend-standard`, merged at `6b6dea7`.
- **Delivers:** every route file parses `params`, `query` and `body` with zod and throws typed errors to `httpErrorHandler`, with every response body identical to the base build.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; `git grep -cE "status\((400|404|409|500|502)\)" src/server/routes` totals 0 or lists only the fenced sites named in the PR; `git grep -c "typeof req" src/server/routes` is 0; each route file has a characterization test and the existing route tests pass unchanged; the web tests pass; the 409 contract table shows empty before and after diffs; a browser check on a sandbox server shows identical UI copy for start a card twice (409), move a card into a guarded column (409), connect a source with a bad token (400 or 502), open a missing card (404).
- **Spec artifacts:** the 409 web parsers `moveCard`, `startCard`, `startGroup`, `syncCardToLinear`, `resumeCard`, `unwindGroup`, `restoreArchived`, `deleteArchived`, `refreshAccountUsage`, `getSourceConnection`, plus every `status === 409` hit in `src/web` (`LinearSection.tsx:135`, `move-error-copy.ts:11`, `api.ts:194, 229, 321, 347, 1420, 1456, 1514, 1566, 1587, 1713, 2197`); the 8 string readers of `body.error` in `api.ts` (R-02).
- **Execution:** `-full-subagent`, budget (mechanical conversion against the playbooks proof); the cards and board phases, the 409 contract phase and the gap analysis run no-budget (live web contracts).
- **PRD:** `dispatch/.planning/prds/g14-backend-unit-1.md`
- **Status:** built, awaiting /ship
- **Risk notes:** a changed error string silently changes UI copy, because many web mappers render `body.error` directly. zod field order sets the first error code; it must equal the order of today's hand checks. zod `.max()` on a string counts code points; use `.refine((s) => s.length <= max)` (GROUP-10 Unit 2 P0). `sendFile` callbacks (`cards:1123`, `viewer:102`, `viewer-page:33`) run after the handler returns; they call `next(err)` with a typed error.
- **Scope corrections:** counts per R-17; no `code` field is added (R-02); statuses beyond the five also convert (R-03); catch blocks rethrow typed errors (R-05).

#### Carried from Unit 1
- Each converted router ends with `<name>Router.use(httpErrorHandler)`; new routes in Unit 2 (the scaffold proof) follow backend-design.md Errors rules 8 and 9.
- Schema files are `<resource>-schemas.ts`; shared zod pieces live in `routes/schema-primitives.ts`; `orFail` lives in `routes/error-handler.ts`.
- The shell has NODE_ENV=production: prefix every npm, npx and node command with `env -u NODE_ENV`; install with `env -u NODE_ENV npm ci -include=dev`.
- `run-claude.test.ts` uses real tmux and flakes under CPU load; do not run `npm run check` while other test processes run.
- The sandbox (port 48110, `.planning/g14-backend-unit-1/sandbox/`) and its seven base probes stay valid for Unit 2, because Unit 2 changes no response.
- Ten route files import the store; Unit 2 Phase 2 switches them to the repository (R-12). `cards.route.ts` also uses `store` inside `actionableCard`.
- GROUP-10 holds `error-handler.test.ts`, `parse-input.test.ts` and `playbooks-route.test.ts` uncommitted (accepted risk R6 in todo.md).

### Unit 2: module boundaries, board repository and per-layer tests
- **Tickets:** LOCAL-79
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1; GROUP-10 Unit 4 (LOCAL-65) for the boundaries rule and `dependency-cruiser`; GROUP-10 Unit 5 (LOCAL-66) for `scaffold-backend-slice` and the tracked `CLAUDE.md` (R-14).
- **Delivers:** the services split boundaries rule at `error` with the domain exceptions moved, zero `src/server/` cycles in `dependency-cruiser`, a `BoardRepository` interface that services and routes use through a composition-root holder, a throwing test fake, the per-layer test conventions with a classification table of the 142 server tests, and a scaffold proof.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes with the services split rule at `error` and zero backend warnings; `npm run depcruise` reports zero cycles under `src/server/`; `git grep -nE "store/board\.store" src/server/services` is empty (R-13); at least one orchestration test uses `fake-board-repository.ts` and passes; the SQLite store tests pass; the scaffold proof output (file list, lint, tests) is in the PR and the slice is deleted; start, move, cleanup and archive of a card on a sandbox server behave as on the base build, with SSE snapshots unchanged.
- **Spec artifacts:** the 27 file and target pairs in `backend-design.md` "Import direction inside services"; `docs/standards/architecture.md` "Repository pattern rejected" section, which gets a dated reversal record scoped to the board store.
- **Execution:** `-qa-subagent`, no-budget (first repository seam, lint flip to `error`)
- **PRD:** `dispatch/.planning/prds/g14-backend-unit-2.md`
- **Status:** built, awaiting /ship
- **Risk notes:** the forwarding holder must bind `this` to the real store, because `BoardStore` methods use private members. The single-writer queue stays inside `BoardStore`; the interface adds no second writer. File moves change `docs/ARCHITECTURE.md` citations (32 lines); `doc-drift` fails if one is missed. GROUP-10 Units 4 and 5 are `not started` on 2026-09-30.
- **Scope corrections:** the acceptance grep is corrected (R-13); routes also switch to the repository (R-12); no existing test mocks `items.ts`, `mapping.ts` or `claude-sessions.ts`, so those stay direct.

#### Carried from Unit 2
- Services and routes call the board store through `boardRepository` (`store/board-repository.ts`); `bootstrap/index.ts` is the only source caller of `setBoardRepository`. dependency-cruiser refuses a non-test route or service import of `store/board.store.ts` and any non-test import of `src/server/test-support/`.
- The service direction rules are at error; `services/domain/` imports `src/shared/` only. CLAUDE.md "Backend agent rules" and backend-design.md "Agent rules block (backend)" are identical, 10 rules; change both together.
- `test/g14-backend-specs` holds 42 test files (40 Unit 1 route specs plus the two repository seam tests) and must merge with or before the Unit 2 branch; backend-design.md lists those files.
- A two-build comparison on the sandbox runs one build at a time: every data copy shares the one fixture repo (`.planning/g14-backend-unit-2/sandbox/fixtures.md`).

## Progress log

| Date | Unit | Outcome | Deviation from plan |
| - | - | - | - |
| 2026-09-30 | all | GROUP-10 `feat/LOCAL-63-unit-2-backend-standard` merged into `GROUP-11` (fast-forward to `6b6dea7`) | none |
| 2026-09-30 | all | roadmap written, awaiting approval | grill answers taken per the grill policy, R-01 to R-20 |
| 2026-09-30 | all | roadmap approved by Yash as written (R-02, R-05, R-06, R-09 named) | none |
| 2026-09-30 | 1, 2 | grilled (U1-01 to U1-16, U2-01 to U2-16) and PRDs written; coverage gate passes | Unit 1 has 9 phases, Unit 2 has 8; GET /api/cards/:id returns 400 for a missing card today (kept) |
| 2026-09-30 | 1 | execution started (roadmap-loop armed, branch feat/LOCAL-78-unit-1-route-boundaries) | none |
| 2026-09-30 | 1 | built, awaiting /ship (9 phases gate=pass, sweep PASS, readiness: ship with named risks, 0 BUG) | U1-15 flows changed (start-twice has no 409; Sync Linear is the browser 409); router-level handler mounts (R-06 addendum); terminal-proxy bodyless handler and remote-auth-gate fenced (R-04); Phase 8 applied 12 review fixes |
| 2026-09-30 | 2 | execution started (branch feat/LOCAL-79-unit-2-backend-boundaries from the Unit 1 branch at 5b19bb0) | none |
| 2026-09-30 | 2 | built, awaiting /ship (8 phases gate=pass, sweep PASS, readiness: 0 BUG, below-High rows accepted in todo.md) | U2-13 scaffold slice is POST (skill has one template); SSE proof compares the Unit 1 and Unit 2 builds on copies of one data dir; two depcruise guards added in Phase 7; CLAUDE.md rule 8 folded into the direction rule; moved and edited tests commit with the code, new tests ride test/g14-backend-specs; no phase ran on the budget tier |
