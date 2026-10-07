# G16 Orchestration Research and Design Roadmap

## What we are building

Two documents and a set of sketches that govern the orchestration initiative (G17 to G19, LOCAL-85 to LOCAL-93). Unit 1 writes the research record and the 9 decision records. Unit 2 writes the UI spec and the throwaway HTML sketches. After both units ship, each later ticket has no open design question, and each UI ticket has a contract and a sketch to build from. No production code changes.

Slug: `g16-orch-design`. Decision register: `.roadmap/g16-orch-design/decisions.md` (R-01 to R-28). Repo worktree: `dispatch/`, branch `GROUP-16`, base `3912003` (`base/g16` = origin/main on 2026-10-05). The tickets are local Dispatch tickets from the card. Do not use the Linear MCP.

## Tickets in scope

| Ticket   | Title                                                                         | Unit |
| - | - | - |
| LOCAL-83 | Orchestration: research, product model and decision records                   | 1    |
| LOCAL-84 | Orchestration: UX design for boards, the orchestrator panel and the dashboard | 2    |

## Verified findings

Checked on 2026-10-05 against `dispatch/` at `3912003` and the files in `/Users/yash/dispatch-workspaces/`. The research record cites commit `46d060b`; line numbers moved.

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| No table or type has a board id | research 4 | Confirmed | `grep board_id\|boardId\|projectId` in `src/server`, `src/shared`: 0 hits |
| SQLite tables cards, meta, events, archive, push_subscriptions, items | research 4 | Confirmed | `store/board-db.ts:475-506` |
| LOCAL and GROUP counters live in the one meta row | research 4 | Refined | the meta row holds a generic map `identifierCounters: Record<string, number>` keyed by prefix (`board-db.ts:78`); `nextIdentifier(prefix)` mints `<prefix>-<n>` (`board.store.ts:966-970`); legacy `localTicketCounter` and `groupTicketCounter` mirror it (`:983-984`). A new prefix needs no schema change (R-11) |
| A group is known by its id prefix | implicit | Refuted | group checks read `card.source === "group"` (`services/infra/kickoff.ts:257`, `features/board/CardView.tsx:110`) |
| The tmux name derives from the card id | research 4 | Confirmed, refined | sessions are `dsp-<identifier>` (`adapters/tmux.ts:514`, `adapters/ttyd.ts:29`); a `DISPATCH_DIR` instance uses a private tmux server `-L dsp-<12 hex>` (`tmux.ts:17-25`) |
| No route sends text to a session pane | research 4 | Refined | the tmux adapter has `sendKeys`, `sendLiteral`, `loadBuffer`, `pasteBuffer`, `paneAtPrompt` (`tmux.ts:518-593`); the only caller is the start saga (`services/orchestration/steps.ts`); no route exposes them |
| Idle detection must come from the pane, not board markers | research 5 | Refined | a server watcher already reads the pane for markers (`adapters/markers/watcher.ts:150`); it has no idle, stale or usage limit state |
| No keep awake in the server | research 5 | Confirmed | no `caffeinate`, `pmset` or power assertion in `src/` |
| No MCP server for an orchestrator | research 4 | Confirmed | `mcp` hits in `src/server` are trust config and headless `claude -p` calls only |
| The word "orchestration" is free | implicit | Refuted | `services/orchestration/` and the ARCHITECTURE section "Orchestration Saga" name the session start saga today (R-27) |
| The doc drift check covers new docs | ticket AC | Refined | `scripts/check-doc-drift.mjs` checks only `docs/ARCHITECTURE.md` pointers and planning words in `src/`. `prettier -check .` checks every `.md` and `.html` under `docs/` (R-04) |
| Mac slept after 1 minute idle | research 5 | Confirmed | `LOCAL-22/2026-10-05-local-22-orchestration-session-handoff.md:27,54` (pmset 1 minute, fix `caffeinate -is` in tmux session `keepawake`) |
| A loop handed off at 38 percent on a wrong estimate | research 5 | Confirmed | `GROUP-13/.roadmap/g12-modules-a/progress.md:7`, `GROUP-14/.roadmap/g13-modules-b/progress.md:6` (116 percent estimate) |
| A queued message was typed but not submitted | research 5 | Confirmed | `LOCAL-22/2026-09-29-local-22-releases-and-ui-revamp-session-handoff.md:65` |
| Stopped loop unseen 30 minutes; 8 hours at the limit dialog; two watchers; 2 hour wait | research 5, research 1 | Not yet located | Unit 1 finds the line or records "reported by the orchestrator, no file record" (R-06) |
| Handoff request at 72 percent | research 5 | Refined | 72 percent in the 2026-09-30 handoff; lowered to 50 percent on 2026-10-03 (GROUP-14 R-29) |

Production data check (skill step 4): not applicable. The units change no code and no server state.

## Architecture decisions

1. Two units, one per ticket, strict order, stacked local branches, no specs branch (no test files), orchestrator ships (R-01).
2. The 9 decision records start from the recommended directions R-10 to R-18. Unit 1 research may change a direction only with evidence, recorded in `changed-decisions.md` (R-10 to R-18).
3. Unit 1 proves the reviewer criterion with a fresh subagent that reads only the two documents (R-08).
4. Sketches are static HTML with the real token values and real run data; they are not product code (R-19).

## Rejected alternatives

- One unit for both tickets: LOCAL-84 must read the finished design document, and the ticket says LOCAL-83 governs it.
- Sketches as React pages in `src/web`: the tickets forbid production code and the sketches are throwaway.
- Screenshots outside the repo: the PR must show them and a squash PR has no other durable home. 20 PNGs are small (R-20).
- Ask Yash each of the 9 design questions: the grill policy takes the recommended answer. This roadmap shows the directions so the approval covers them.

## Open questions

None block the loop.

## Units

### Unit 1: Research record and decision records

- **Tickets:** LOCAL-83
- **Repos:** dispatch (1 PR)
- **Depends on:** none
- **Delivers:** `docs/research/orchestration-research.md` (survey of at least 11 tools, analysis of the manual run, comparison table, patterns to copy), `docs/standards/orchestration-design.md` (glossary, decision records D-1 to D-9, scope changes per ticket LOCAL-85 to LOCAL-93), and one pointer section in `docs/ARCHITECTURE.md`.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; the survey has at least 8 tools, each with links and an explicit "not found" where data is absent; each manual action and failure has a source file; D-1 to D-9 each name a decision, one reason and rejected options; a fresh subagent that reads only the two documents answers the 5 reviewer questions with no guess; each of LOCAL-85 to LOCAL-93 is "confirmed" or has a scope change.
- **Spec artifacts:** none (no prototype, image or quoted copy). The research record sections 4 to 6 are the input.
- **Execution:** `-qa-subagent`, no-budget (the decisions govern three later groups)
- **PRD:** `dispatch/.planning/prds/g16-orch-design-unit-1.md` (9 phases)
- **Status:** built, awaiting /ship (branch `docs/LOCAL-83-unit-1-orchestration-design`, commits 3bd3548, d590879, cf7e7e9, febe8c1)
- **Risk notes:** four claimed failures have no file record yet (R-06). Product pages change; each link is checked on the day. The design document must not contradict `docs/ARCHITECTURE.md` "Do Not Change Contracts".
- **Scope corrections:** the term clash with the start saga (R-27); counters are already a map per prefix (R-11); a pane watcher exists to extend (R-12).

### Unit 2: UI spec and sketches

- **Tickets:** LOCAL-84
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1 (`orchestration-design.md` on the Unit 1 branch)
- **Delivers:** `docs/standards/orchestration-ui-spec.md` (information architecture, 5 screens, each state, copy, the shadcn primitive per part, layout at 1440 px, 1024 px and 390 px) and static sketches in `docs/research/sketches/` with 20 screenshots.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; the spec covers the 5 screens with empty, loading, error and stale states and names a primitive in `src/web/components/ui/` for each part; sketches exist for each screen at 1440 px and 390 px in both themes; the dashboard sketch shows a group with 3 units, unit 1 done, unit 2 in phase 4 of 9, and a session that waits for input; group progress reads with no colour; `gsd-ui-checker` reports no BLOCK; the no-orchestrator board matches the board of today.
- **Spec artifacts:** `docs/standards/design-contract.md` (tokens, density, contrast, focus), research record section 6 (dashboard order), the LOCAL-84 screen list.
- **Execution:** `-qa-subagent`, budget for the sketch HTML phases; the spec phase runs no-budget (screen contract)
- **PRD:** `dispatch/.planning/prds/g16-orch-design-unit-2.md` (10 phases)
- **Status:** built, awaiting /ship (branch `docs/LOCAL-84-unit-2-orchestration-ui-spec` on the Unit 1 tip febe8c1, commits 2cfa69b, 5e745a9, f2d0117, 00b903e)
- **Risk notes:** 8 GB RAM with two other loops: one browser at a time, close it after each check. A primitive named in the spec must exist in `src/web/components/ui/` or be marked "added by the UI ticket".
- **Scope corrections:** the D-1 amendment (2026-10-06) moves the default board source to `workspaceRoot` plus the store `workspaceFolders`, with dated lines under the LOCAL-85 and LOCAL-87 scope entries. Open spec FLAGs and P2 review items for LOCAL-86, LOCAL-87, LOCAL-88, LOCAL-91 and LOCAL-92 are in `.roadmap/g16-orch-design/todo.md`.
- **Carried from Unit 1:** the design records define 12 session states (D-3: `working`, `idle`, `needs_input`, `permission_prompt`, `handoff_ready`, `roadmap_complete`, `usage_limit_dialog`, `usage_limit_wait`, `api_error`, `stale`, `lost`, `shell_prompt`) with a `stateReason`, 10 policy fields (D-6), the ship states (D-8), decision items with options and a recommended option (D-3, D-7), and an orchestrator that needs `supervisor` on (D-3). The attention queue lists `permission_prompt` and a failed resume of `lost` or `shell_prompt` (LOCAL-92 entry). Only the user resumes a usage-stop or budget stop. The default board reads `Config`, and its edit form writes `Config`.

## Progress log

| Date       | Unit | Outcome                            | Deviation from plan |
| - | - | - | - |
| 2026-10-05 | all  | roadmap written, awaiting approval | none                |
| 2026-10-05 | all | roadmap approved by the orchestrator, R-01 to R-28 as written | R-15 cap default 3, not 2 (changed-decisions.md) |
| 2026-10-05 | 1 | grilled (U1-01 to U1-16), PRD written (9 phases), coverage passes; execution started (ralph-loop, `-qa-subagent`, no-budget) | Unit 2 is grilled after Unit 1, because LOCAL-84 reads the finished design document |
| 2026-10-06 | 1 | built, awaiting /ship: 9 phases gate=pass, sweep clean, 4 commits, reviewer test PASS, readiness audit in qa/phase-8 | changed-decisions rows for R-10, R-12, R-13, R-15, R-18; Phase 8 review fixed 1 P0 and 14 P1 over four passes |
| 2026-10-06 | 2 | grilled (U2-01 to U2-16), PRD written (10 phases), coverage passes | none |
| 2026-10-06 | 2 | built, awaiting /ship: 10 phases gate=pass, sweep clean, 4 signed commits, UI checker run 7 BLOCK 0 FLAG 23, screenshot audit PASS, unit readiness PASS (qa/unit-readiness.md) | D-1 amended (R-10 changed-decisions row); Phase 8 used 3 RED attempts (R-24 (3) extra round 1); Phase 9 fixed 2 P1 and 2 standards violations and applied 6 of 10 validated ponytail cuts; commits grouped by file (amendment, spec, sketches, screenshots) instead of the per-phase lines; phases 5 to 7 ran on the budget tier, the rest no-budget |
