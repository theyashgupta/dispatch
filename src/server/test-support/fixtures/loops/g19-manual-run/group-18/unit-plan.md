# G18 Orchestrator Runtime Roadmap

Slug: g18-orch-runtime. Decision register: `.roadmap/g18-orch-runtime/decisions.md`. Deviations: `.roadmap/g18-orch-runtime/changed-decisions.md`. Repo: `dispatch/` (worktree on branch GROUP-18, cut from base/g18 = origin/main `9d2938d`, after the G17 Unit 1 and Unit 2 squashes).

## What we are building

The server knows the progress of each roadmap loop and shows it in the snapshot. A server supervisor watches each session and does the deterministic work of the manual run: idle and stale detection, the confirmed send, the context handoff, the usage limit, the keep awake and the prompt declines. An orchestrator session controls one board through board-scoped routes and an MCP tool server, inside a per-board policy, and a user starts it from an orchestrator panel. A board with no orchestrator and the supervisor off behaves as today.

## Tickets in scope

| Ticket | Title | Unit |
| - | - | - |
| LOCAL-88 | Orchestration: structured loop progress for groups | 1 |
| LOCAL-89 | Orchestration: session supervisor in the server | 2 |
| LOCAL-90 | Orchestration: control surface for an orchestrator (API and MCP tools) | 3 |
| LOCAL-91 | Orchestration: orchestrator session, playbook and policies | 4 |

## Governing documents

`dispatch/docs/standards/orchestration-design.md` (D-1 to D-9 and the D-1 amendment of 2026-10-06). A decision record wins over ticket text (R-02). `dispatch/docs/research/orchestration-research.md` sections 2, 3.1 and 3.2 (R-03). `dispatch/docs/standards/orchestration-ui-spec.md` Screen 3 (orchestrator panel) and Screen 4 (dashboard and attention queue), and `dispatch/docs/research/sketches/orchestrator-panel.html`. Behaviour reference for Unit 2: `/Users/yash/dispatch-workspaces/watch-loops.zsh`, `resume-loop.zsh`, `resume-after-reset.zsh`, `handoff-request.md`, the `keepawake` tmux session, and `/Users/yash/dispatch-workspaces/LOCAL-22/2026-10-05-local-22-orchestration-session-handoff.md` (Gotchas).

## Verified findings

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| "Sample folders GROUP-12, GROUP-13, GROUP-14" | LOCAL-88 | Refuted | GROUP-12 and GROUP-13 do not exist on 2026-10-06. GROUP-11, 14, 15, 16 and 17 exist with loop files (R-04). |
| The progress ledger has one table layout | implied by LOCAL-88 | Refuted | Column order differs in GROUP-11, GROUP-14 and GROUP-15 `progress.md` (R-05). |
| Phase state files hold one pass line per phase | research section 2 | Confirmed | `GROUP-14/dispatch/.planning/g13-modules-b-unit-3/state.md`: `phase 1 <name> GREEN 2026-10-06T13:01:02Z gate=pass` (R-06). |
| The roadmap `Status:` line starts with a fixed value, free text can follow | D-5 | Confirmed | GROUP-16 `ROADMAP.md:71`: `built, awaiting /ship (branch ...)`; GROUP-17: `shipped (PR #189, ...)`. |
| The engine file has `active`, `iteration`, `session_id` | D-5 | Confirmed | `GROUP-14/.claude/ralph-loop.local.md` front matter; GROUP-11 has `ralph-loop.local.md.done`. |
| "Update the Roadmap Loop playbook" in `playbooks.ts` | LOCAL-88 | Refuted | `services/infra/playbooks.ts:22-53` seeds PRD + Ralph Loop, Superpowers, GSD, Write code directly. Roadmap Loop is the user file `~/.dispatch/playbooks/roadmap-loop.md` (R-08). |
| The roadmap-loop skill has no report call | LOCAL-88 | Confirmed | `~/.claude/skills/roadmap-loop/SKILL.md` (172 lines) has no `curl`, no `DISPATCH_HOOK` reference. |
| The board has a policy | D-6 | Confirmed | `src/shared/types.ts:1588-1611` `BoardPolicy` with all ten D-6 fields; `boards.policy` JSON column (`store/board-db.ts:629`). No `orchestrators` field yet (R-10). |
| `loopProgress`, `contextPercent`, `state`, `dependsOn`, `ownerOrchestrator` exist | D-5 | Refuted | No hit in `src/`. `boardKey` exists on `Card` and `BoardSnapshot`. |
| One projection mirrors the active session onto the card | D-5 | Confirmed | `store/board.store.ts:723-788` `setActiveSession()`. |
| The hook token check exists | D-5 | Confirmed | `routes/hooks.route.ts:43` reads `x-dispatch-token`; `services/orchestration/hook-tokens.ts:82` `resolveHookToken`. No `/api/loops` route. |
| The marker watcher reads the pane on a tick | D-3, D-5 | Confirmed | `adapters/markers/watcher.ts:338`, 2000 ms; per-session map at `watcher.ts:40`. |
| No status-line parser exists | D-5 | Confirmed | No percent field on a session; the manual parser is `watch-loops.zsh:39` (`[0-9]+%  [0-9]+k/1.0M`). |
| No transcript reader exists | D-3 | Confirmed | No `.claude/projects` path logic in `src/server` (R-13). |
| No fake tmux exists | LOCAL-89 | Confirmed | `src/server/test-support/` has `stub-claude.ts` and `claude-transcripts.ts` only (R-14). |
| The tmux adapter can send keys and paste text | D-3 | Confirmed | `adapters/tmux.ts:533` `pasteBuffer`, `:548` `sendKeys`, `:593` `paneAtPrompt`. |
| `crossSessionInbound` is in the hook settings | D-3 (A27) | Refuted | `bootstrap/hook-setup.ts:414-435` has no such key. Unit 2 adds it. |
| GROUP-15 adds a limit action and a session move service | direction | Confirmed, not on main | `limit-surface.ts` (`parseLimitSurface`, `planLimitKeys`, `limitChoice`, `CREDITS_OPTION`) in commit ea6d3fe; `session-account-move.ts` `moveSessionAccount`. No LOCAL-80 or LOCAL-94 commit on origin/main (R-12). |
| `GET /api/events` has a cursor | D-4 | Refuted, as D-4 says | `routes/events.route.ts:14-25`: `cardId`, `limit` only. |
| The launch can take extra claude args | D-4 | Confirmed | `services/domain/claude-launch.ts:4` `leadingArgs` (R-15). |
| An MCP SDK is installed | LOCAL-90 | Refuted | Not in `package.json`; zod is 4.6.5 (R-15). |
| LOCAL-77 and LOCAL-87 are on main | Unit 4 gate | Refuted on 2026-10-06 | `git log origin/main` has no subject with LOCAL-77 or LOCAL-87 (R-19). |

## Architecture decisions

Each decision has an ID in the decision register. The list here names the ones that shape the cut.

1. One unit per ticket, in ticket order, one stacked branch and one squash PR each, then a trailing specs branch (R-01, S-07).
2. The reader is the one source of progress. The report route only records a gate event and starts a read (D-5, R-09).
3. The parsers find table columns by header name and treat each file as optional (R-05, R-06).
4. The loop never writes the user playbook file or the global skill. It writes patch files and a todo item (R-08).
5. The supervisor reuses the GROUP-15 limit surface through a byte-identical vendored copy until G15 merges (R-12).
6. Unit 3 enforces the board scope; Unit 4 adds the owner scope to the same function (R-16).
7. Decision items are a Unit 3 server model; their UI is Unit 4 (R-17).
8. Unit 4 execution waits for LOCAL-77 and LOCAL-87 on origin/main (R-19).

## Rejected alternatives

- Split LOCAL-91 into a server unit and a UI unit, so the server part runs before the cutover: the session direction says one unit per ticket and gates all of Unit 4 on LOCAL-77 and LOCAL-87.
- The report route writes progress fields: it makes the model a second source of truth (D-5).
- Parse the progress table by column position: three real runs have three layouts (R-05).
- chokidar for file changes: `node:fs` `watch` plus the 60 s timer covers it with no new dependency (R-07).
- A hand-written MCP stdio protocol: the SDK handles the protocol and version negotiation; one pinned dependency is cheaper than a second protocol implementation (R-15).
- Edit `~/.claude/skills/roadmap-loop/SKILL.md` during the run: two other loops read it now, and the live servers on 4700 and 4710 have no report route, so a report call from them fails (R-08).
- Duplicate the GROUP-15 limit logic: the direction says reuse, and a second copy drifts (R-12).

## Open questions

None that block planning. Per-unit grills settle the phase-level questions. The user decides at roadmap approval.

## Units

### Unit 1: Structured loop progress

- **Tickets:** LOCAL-88
- **Repos:** dispatch (1 PR)
- **Depends on:** none (base/g18)
- **Delivers:** a tolerant server reader of the loop files, a token-checked report route and a status-line parser, so the snapshot of a group card carries its unit and phase progress and each session carries its context percent, model, cost and usage.
- **Acceptance boundary:** the GROUP-14-derived fixture (3 units, Unit 1 committed, Unit 2 at 4 of 9 phases passed) parses to the exact model; a fixture with a removed phase state file gives a partial model and a warning; a report with a valid hook token updates the stream inside 2 s and a wrong token is rejected; the snapshot of a group card carries units done, the total, the current unit, the current phase and the last gate result; a sandbox session record carries the context percent and the cost from a recorded pane within one refresh interval; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** D-5 field list and protocol; research section 2 loop file layout; fixture folders GROUP-11, GROUP-14, GROUP-15, GROUP-16, GROUP-17 (R-04); status line format `watch-loops.zsh:39`.
- **Execution:** `-qa-subagent`, budget (parsers on file formats that this roadmap verified)
- **PRD:** `dispatch/.planning/prds/g18-orch-runtime-unit-1.md` (8 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** `src/shared/types.ts` and `adapters/markers/watcher.ts` are shared files (S-12). The meter write on a 2 s tick must not write the store on each tick (R-11). The playbook and skill updates are patch files, not edits of live files (R-08).
- **Scope corrections:** fixture sources change (R-04); the report route records a gate event only (D-5); the playbook is a user file (R-08).
- **Carried from Unit 1 (for Units 2 to 4):**
  - `Session` stores `contextPercent`, `model`, `cost`, `usage` and `metersAt`; `metersAt` is the time of the last change, and meters stay on a lost session and after a status line of an unknown format (todo.md). The Unit 2 handoff rule must not read old meters as live.
  - `src/server/test-support/fake-claude-tui.ts` (`writeFakeClaudeTui`) is the fake interactive claude to extend; it redraws its scenario file every 0.5 s.
  - Sandbox hook tokens resolve only when the session tmux session is live on the private server of the sandbox (`-L dsp-<sha12 of DISPATCH_DIR>`); seed `tmuxSession` and `hookToken` on the session record and the flat card fields before boot.
  - `orchestration_events` (kind `loop_gate`) has no retention or rate limit yet; Unit 3 adds the `since` cursor (U3-05) and should add pruning (todo.md).
  - `npm run doc-drift` fails on the words roadmap, `.planning/` and `phase <n>` in any src file outside the loop-file allowlist (U1-19); new files must avoid them or join the allowlist with a changed-decisions entry.
  - Error codes on new routes are kebab strings (`invalid-unit`, `not-group-card`), per backend-design.md Validation rule 2.

### Unit 2: Session supervisor

- **Tickets:** LOCAL-89
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1 (stored context percent, engine file reader)
- **Delivers:** one supervisor watcher per live session that detects the 12 typed states of D-3 with a second-source check, records each change as an event, and runs the D-3 actions that the board policy allows: the confirmed send, restart, handoff, usage limit, API error, prompt declines, keep awake, loop close, PR and merge watch, dependency hold and budget stop.
- **Acceptance boundary:** each of the 12 states is detected from a recorded pane capture in a test; a fake session at 72 percent gets one handoff request, and after `handoff_ready` a new session runs and the engine file holds the new id; at the usage limit dialog the policy key is sent and a test asserts that the credits option is never selected; an unconfirmed send is retried once and then reported as an event; two starts leave one watcher; the power assertion exists with a session running and not with none; with `supervisor` off no key reaches a pane; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** D-3 duty table; D-4 send route rejections; D-6 policy fields; research failures F1 to F25; the replaced scripts and the LOCAL-22 gotchas.
- **Execution:** `-qa-subagent`, no-budget (state machine that sends keys to live sessions)
- **PRD:** `dispatch/.planning/prds/g18-orch-runtime-unit-2.md` (10 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** a wrong key at a usage limit dialog can buy credits; the credits guard is tested on every path. Tests use only the private tmux server and the stub claude (R-14, S-10). The `caffeinate` child goes through `adapters/exec.ts`, so it needs no exception of backend rule 7 (changed-decisions U2-18). The GROUP-15 limit surface is vendored until it merges (R-12).
- **Scope corrections:** 12 states, not 10 (D-3); restart duty, dependency hold, budget stop, loop close, PR watch and `crossSessionInbound: refuse` added (D-3); fixed idle and stale values, not policy fields (D-3).
- **Carried from Unit 2 (for Units 3 and 4):**
  - The session root is `session.workspacePath ?? card.workspacePath` (`supervisor-record.ts#rootOf`); `workspace.folder` is the parent folder of the source repositories and is never a root.
  - Every text the server types into a running Claude session goes through `supervisor-send.ts#sendConfirmed` (U3-08 `send_input` and `approve_roadmap` must call it). It refuses a pane with an open dialog or menu (`supervisor-state.ts#paneReady`), re-checks before each Enter, and strips control characters.
  - A supervisor-set `needs_input` carries a `stateReason`; the hold rules are in `supervisor-plan.ts#holdsNeedsInput` (budget and resume_failed hold longer). U3-08 refusals for `usage_stop` and `budget` read `session.stateReason`.
  - `startQueued` and `dependsOn` exist on the group card and the 60 s pass starts held groups, but nothing sets them yet; Unit 3 `create_group` and `start_group` set them (todo.md: start failure retry, launch direction and playbook, lost groups and the cap).
  - `PUT /api/boards/:key/policy` is a loopback user route like the others; a supervised loop could call it (todo.md, S-14 decision for Unit 3).
  - Reset timers, prompt budgets and the budget running total live in server memory (todo.md accepted risks); U3-05 (events cursor) is the natural place to persist them.
  - Full check in a session moved to another Claude account: `env -u NODE_ENV -u CLAUDE_CONFIG_DIR npm run check` (lessons-learned).
  - The Unit 4 playbook (U4-06) now also carries F13 and the subagent brief half of F18 (changed-decisions U4-06).

### Unit 3: Orchestrator control surface

- **Tickets:** LOCAL-90
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 2 (the confirmed send, the session states, the events)
- **Delivers:** board-scoped orchestrator routes under `/api/orchestrator/` with token auth, policy checks and an activity record per call, the `dispatch mcp` stdio tool server with one zod schema per tool, the events `since` cursor and the wait tool, decision items, and the D-8 ship flow.
- **Acceptance boundary:** a scripted client on a sandbox with a fake `claude` creates 3 tickets, creates and starts a group, approves its roadmap, answers one input, requests a handoff, resumes and starts the ship flow; a board A token on a board B card is rejected; a start above the cap is rejected with the reason; the wait tool returns inside 2 s of a matching event and returns a time limit result when none comes; the ship flow on a fake remote opens PRs in stack order and stops when an identity check fails; each tool call is in the activity log with its arguments and result; a test asserts that no tool exists for push, merge, credits, vault or policy change; the tool reference is in `orchestration-design.md`; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** D-4 tool list and route rules; D-8 ship steps and ship states; D-9 prohibitions; the Tool reference table of `orchestration-design.md`.
- **Execution:** `-full-subagent`, budget, with token, scope, policy check and ship identity phases at no-budget (S-01, R-20)
- **PRD:** `dispatch/.planning/prds/g18-orch-runtime-unit-3.md` (11 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** this unit adds the first push path that is not `/ship`; it must run only with `shipRights` above `none`, and its tests use a bare local remote and a fake `gh` (R-18). One new dependency, `@modelcontextprotocol/sdk` (R-15), touches the shared `package.json` and lock file (S-12).
- **Scope corrections:** owner scope moves to Unit 4 (R-16); `create_decision_item` and `stop_session` added (D-3, D-4); the PR title and body come from the orchestrator (D-8).
- **Carried from Unit 3 (for Unit 4):**
  - The MCP SDK client default request timeout is 60 s; a `wait_for_event` above 60 s needs the orchestrator session MCP tool timeout above 540 s (measured in Phase 11; todo.md).
  - A held group start that keeps failing is put back in the queue every pass; the Unit 4 playbook waits with a `kinds` filter or Unit 4 adds a failure count (todo.md, debate pass 3 P3-4).
  - `start_group` now waits for the session start and answers 409 `start-failed` on failure (changed-decisions U3-07).
  - `send_input` text is checked on the line `typedLine` types (mode characters, empty after control characters); `sendLiteral` passes the end of options separator (changed-decisions U3-08); `paneReady` refuses an open input mode row (U2-10).
  - Ship flow rules added in review: unit branch allowlist, commit pinning with the match head commit option, PR reuse only for a same-repository PR into main at the checked head, the repository option only for github.com, unwind refused while a flow runs, signature retry only when every violation clause names the signature rule (changed-decisions U3-14).
  - The approve item of `roadmapApproval: ask` is used once (U3-10); Unit 4 answer UI raises a new item per plan.
  - Scope is the stored board key; the owner check of R-16 goes into the same scope function.

### Unit 4: Orchestrator session, playbook and policies

- **Tickets:** LOCAL-91
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 3; LOCAL-77 and LOCAL-87 on origin/main before execution (R-19)
- **Delivers:** orchestrator records on a board (main and extras with scopes, one owner per group), start, stop and resume of an orchestrator session with the MCP server and its board token, the built-in Board Orchestrator playbook, the policy form, decision items in the attention queue, resume safety through a state file, intake of a goal or requirements text through an approved proposal, and the orchestrator panel UI.
- **Acceptance boundary:** on a sandbox board a started orchestrator with a replayed script creates tickets from pasted requirements only after the proposal is approved; with approval `ask` a roadmap approval creates a decision item and the answer in the UI reaches the orchestrator and the loop continues; a clear and a resume continue with the same groups and pending decisions; a second claim of one group is rejected; a board with no orchestrator shows only one entry point and its requests match today; browser checks at 1440 px, 1024 px and 390 px in both themes with screenshots; `env -u NODE_ENV npm run check` is green.
- **Spec artifacts:** `orchestration-ui-spec.md` Screen 3 (orchestrator panel: Terminal, Decisions, Policy, Orchestrators tabs; right panel at 1440 px and 1024 px, sheet at 390 px) and the attention queue parts of Screen 4; `docs/research/sketches/orchestrator-panel.html` and its screenshots; D-6 policy table; D-7 ownership rules; D-9 list for the playbook.
- **Execution:** `-qa-subagent`, budget, with the ownership claim and policy narrowing phase at no-budget (R-20)
- **PRD:** `dispatch/.planning/prds/g18-orch-runtime-unit-4.md` (10 phases)
- **Status:** not started
- **Risk notes:** gated on the cutover and the boards page (R-19). The UI must use only modules and shadcn primitives (S-13, S-15).
- **Scope corrections:** concurrency cap default 3, `supervisor` policy field, `usageLimit` `stop`, `handoffHardPercent` (D-6); an extra override only narrows (D-7); only the user answers a decision item (D-9).

## Progress log

| Date | Unit | Outcome | Deviation from plan |
| - | - | - | - |
| 2026-10-06 | all | roadmap written, awaiting approval | none |
| 2026-10-06 | all | roadmap approved by the user (S-01 to S-15, R-01 to R-20, S-16, S-17) | none |
| 2026-10-06 | 1 | grilled (U1-01 to U1-18) and PRD written (LOCAL-88) | none |
| 2026-10-06 | 2 | grilled (U2-01 to U2-25) and PRD written (LOCAL-89) | none |
| 2026-10-06 | 3 | grilled (U3-01 to U3-19) and PRD written (LOCAL-90) | none |
| 2026-10-06 | 4 | grilled (U4-01 to U4-16) and PRD written (LOCAL-91) | execution gated by R-19 |
| 2026-10-06 | 1 | execution started (engine armed, branch feat/LOCAL-88-unit-1-loop-progress) | none |
| 2026-10-06 | 1 | built, awaiting /ship: 8 phases gate=pass, sweep clean, readiness 0 BUG (6 High, 2 Medium accepted), full check green, 62 of 62 live E2E cases | changed decisions U1-01 cap, U1-02 (last gate fallback, closed engine), U1-07 (unreadable roadmap keeps last), U1-16 (prettier ignores fixtures), U1-19 (doc-drift allowlist); a slug hint bug and a regex freeze found and fixed in review; all phases ran budget |
| 2026-10-06 | 2 | execution started (branch feat/LOCAL-89-unit-2-supervisor stacked on Unit 1) | none |
| 2026-10-07 | 2 | built, awaiting /ship: 10 phases gate=pass, sweep clean, unit readiness 0 BUG (below-High rows closed or in todo.md), full check green, 90 of 90 live E2E cases, 0 credits-row Enters in 54 key logs | changed decisions U1-19 (allowlist), U2-05, U2-06, U2-09, U2-10, U2-12, U2-13, U2-14, U2-18, U2-22, U2-24, U2-25, U4-06; review found and fixed a P0 (wrong session root) and four P1s before commit; no-budget |
| 2026-10-07 | 3 | execution started (branch feat/LOCAL-90-unit-3-control-surface stacked on Unit 2 at 50e3c94) | none |
| 2026-10-07 | 3 | built, awaiting /ship: 11 phases gate=pass, sweep clean, unit readiness 0 BUG (below-High rows in todo.md), full check green, live E2E GREEN 30 of 30 and RED 37 of 37 (23 tools, 19 enforcement points, ship flow under open_prs and merge, 0 network remotes) | changed decisions U1-19 (allowlist), U2-10 (paneReady), U3-02, U3-05, U3-06, U3-07, U3-08, U3-09, U3-10, U3-11, U3-12, U3-14; review found and fixed 3 P1 (pass 1) and 1 P1 (pass 2, mode guard bypass) before commit; budget with security and ship fixes on the session model |
| 2026-10-07 | 1 | shipped: PR #204 squash-merged as 06764e0 | board-store.test.ts wire field expectation added on the branch |
| 2026-10-07 | 2 | shipped: PR #205 squash-merged as 092d4ad | merged the Unit 1 tip then origin/main with -s ours; board-store.test.ts expectation |
| 2026-10-07 | 3 | shipped: PR #206 squash-merged as d3c2ed7; specs PR #207 merged as dc62b94 | account specs and fake tmux updated for the send-keys separator; 23 CodeQL rate-limit warnings dismissed on approval; specs PR carried all 69 entries |
