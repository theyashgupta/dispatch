Roadmap: /Users/yash/dispatch-workspaces/GROUP-11/ROADMAP.md | slug: g14-backend | repo: dispatch/ | session root: /Users/yash/dispatch-workspaces/GROUP-11

## Units
| Unit | Status | Branch | PRD | Feature dir | Reopen rounds |
| - | - | - | - | - | - |
| 1 | committed 5b19bb0 | feat/LOCAL-78-unit-1-route-boundaries (from GROUP-11) | dispatch/.planning/prds/g14-backend-unit-1.md | dispatch/.planning/g14-backend-unit-1 | 0 |
| 2 | committed b1d910a | feat/LOCAL-79-unit-2-backend-boundaries (from Unit 1 branch) | dispatch/.planning/prds/g14-backend-unit-2.md | dispatch/.planning/g14-backend-unit-2 | 1 |

## Current position
Roadmap complete. Units 1 and 2 committed; trailing branch test/g14-backend-specs (2567fb2, 268dc98) holds all 42 carryover test files; npm run check exit 0 on it. Nothing pushed; /ship per branch is the user's.

## Carryover specs (held uncommitted for test/g14-backend-specs)
- src/server/routes/accounts-errors-route.test.ts
- src/server/routes/accounts-schemas.test.ts
- src/server/routes/archive-errors-route.test.ts
- src/server/routes/ask-errors-route.test.ts
- src/server/routes/board-errors-route.test.ts
- src/server/routes/board-schemas.test.ts
- src/server/routes/calendar-errors-route.test.ts
- src/server/routes/cards-errors-route.test.ts
- src/server/routes/cards-run-claude-errors-route.test.ts
- src/server/routes/cards-schemas.test.ts
- src/server/routes/connection-errors-route.test.ts
- src/server/routes/events-errors-route.test.ts
- src/server/routes/github-errors-route.test.ts
- src/server/routes/github-schemas.test.ts
- src/server/routes/hooks-errors-route.test.ts
- src/server/routes/hooks-route.test.ts
- src/server/routes/images-errors-route.test.ts
- src/server/routes/items-errors-route.test.ts
- src/server/routes/items-schemas.test.ts
- src/server/routes/linear-errors-route.test.ts
- src/server/routes/meetings-errors-route.test.ts
- src/server/routes/meetings-schemas.test.ts
- src/server/routes/or-fail.test.ts
- src/server/routes/playbooks-schemas.test.ts
- src/server/routes/profile-errors-route.test.ts
- src/server/routes/push-errors-route.test.ts
- src/server/routes/push-schemas.test.ts
- src/server/routes/remote-errors-route.test.ts
- src/server/routes/route-error-mount.test.ts
- src/server/routes/schema-primitives.test.ts
- src/server/routes/sentry-errors-route.test.ts
- src/server/routes/setup-errors-route.test.ts
- src/server/routes/slack-errors-route.test.ts
- src/server/routes/terminal-proxy-errors-route.test.ts
- src/server/routes/update-errors-route.test.ts
- src/server/routes/vault-errors-route.test.ts
- src/server/routes/vault-schemas.test.ts
- src/server/routes/viewer-errors-route.test.ts
- src/server/routes/viewer-page-errors-route.test.ts
- src/server/routes/workspaces-errors-route.test.ts
- src/server/store/board-repository.test.ts
- src/server/test-support/fake-board-repository.test.ts

## Boundary commits
- Unit 1: 28 commits de9ca04..5b19bb0 on feat/LOCAL-78-unit-1-route-boundaries (all signed, author Yash Gupta <yashguptaab66@gmail.com>)
- Unit 2: 5 commits 224e558..b1d910a on feat/LOCAL-79-unit-2-backend-boundaries (all signed, author Yash Gupta <yashguptaab66@gmail.com>); committed tree alone passes typecheck, lint, depcruise, doc-drift and the server suite (1028 pass, 0 fail)
## Log
- 2026-09-30: loop armed; Unit 1 branch created from GROUP-11 at 6b6dea7.
- 2026-09-30: Unit 1 Phase 1 gate=pass. Context checkpoint at 85%: handoff written, resume.md refreshed.
- 2026-09-30: Unit 1 Phase 2 gate=pass (QA 16/16 green, 46/46 red). Router-level httpErrorHandler mount and gate generator fix logged in changed-decisions.md.
- 2026-09-30: Unit 1 Phase 3 gate=pass (QA 19/19 green, 62/62 red; oracle re-proven on a git archive of GROUP-11).
- 2026-09-30: Unit 1 Phase 4 gate=pass (QA 24/24 green, 95/95 red; oracle re-proven on base).
- 2026-09-30: Unit 1 Phase 5 gate=pass (QA 29/29 green, 45/45 red; differential 264/264 identical).
- 2026-09-30: Unit 1 Phase 6 gate=pass (QA 15/15 green, 29/29 red; differential 384/384 identical; 409 table rows repaired).
- 2026-09-30: Unit 1 Phase 7 gate=pass (QA 13/13 green, 12/12 red; count target 1 = fenced viewer-page 404; playbooks router mount added).
- 2026-09-30: Unit 1 Phase 8 gate=pass (6 reviews, 12 fixes A to L, 13 dismissals recorded; readiness audit: no BUG, gaps R1 to R6 written into Phase 9).
- 2026-09-30: Unit 1 Phase 9 gate=pass; sweep PASS; unit readiness: ship with named risks, 0 BUG; roadmap set to built, awaiting /ship; boundary commits made. Unit 2 started.
- 2026-09-30: Unit 2 Phase 1 started. SSE base snapshot captured on the Unit 1 production build (base/sse-snapshot.json). Implementation runs in a session-model subagent (no-budget kept) because the main context passed its checkpoint; QA stays in phase-qa-runner.
- 2026-09-30: Unit 2 Phase 1 gate=pass (QA 12/12 green, 6/6 red; 102-member interface, no runtime cycle).
- 2026-09-30: Unit 2 Phase 2 gate=pass (QA 14/14 green, 8/8 red; R-13 grep scoped to non-test files, logged).
- 2026-09-30: Unit 2 Phase 3 gate=pass after 1 RED attempt (doc prose fix; QA 19/19 green, 15/15 red after fix).
- 2026-09-30: Unit 2 Phase 4 gate=pass after 1 RED attempt (3 tmux tests marked cross-layer). Phase 5 waits: GROUP-10 feat/LOCAL-65-unit-4-lint-enforcement has no Unit 4 commits; polling every 15 min.
- 2026-09-30: Unit 2 Phase 5 gate=pass (merge cf8c69d signed; service rules at error; implements clause removed to break a type cycle; gate base g14-unit2-base; SIGPIPE-safe gates). Phase 6 waits on GROUP-10 Unit 5 (LOCAL-66).
- 2026-09-30 11:00: while Phase 6 waits on GROUP-10 LOCAL-66, the Phase 7 review agents run early (read-only) on the Phases 1-5 diff vs g14-unit2-base; Phase 7 proper applies their fixes and runs a delta review over the Phase 6 change. No gate order changes.
- 2026-09-30 11:30: early review fix pass applied (6 fixes; server suite 1485 pass 0 fail). Phase 6 still waits on GROUP-10 Unit 5.
- 2026-09-30 12:55: orchestrator context refresh; handoff written (resume.md refreshed); session released with session_id handoff-pending.
- 2026-09-30 13:28: GROUP-10 Unit 5 built, awaiting /ship. Merged feat/LOCAL-66-unit-5-agent-hooks at 53fc991 (signed) via tagged stash g14-u2-premerge-66 (applied with -index, dropped); counts unchanged (65 M, 31 staged R, 44 untracked). U2-13 POST deviation logged. Phase 6 started.
- 2026-09-30 13:41: Unit 2 Phase 6 gate=pass (QA 13/13 green, 7/7 red; scaffold proof in scaffold-proof.md; slice deleted; CLAUDE.md rules 3, 10, 11). Phase 7 started.
- 2026-09-30 14:29: Unit 2 Phase 7 gate=pass after 2 RED attempts (rule 9 sources claim; unbound-method lint on a new test line). Second-pass reviews: debate P0/P1 0, quality CLEAN, security 0 high, standards P1s fixed and re-verified, ponytail 3 agreed. Readiness BUG (U2-12 heading) fixed by restoring the line. Two depcruise guards added (changed-decisions.md). npm run check exit 0.
- 2026-09-30 15:05: user instruction recorded (changed-decisions.md): phases after Unit 2 Phase 8 run with -budget (Opus plans and judges QA, Sonnet subagent writes code and tests; schema, security or migration phases skip it). Phase 8 in flight continues unchanged. Unit 2 summary must list phases that ran cheap (none so far).
- 2026-09-30 15:30: Unit 2 Phase 8 evidence captured (SSE identical, flows identical, 6 UI screenshots); QA and UI evidence audit dispatched. Sequential rerun note: a concurrent two-build run collided on the shared fixture repo; rerun one at a time. rm-guard declines logged in memory (no rm on variable-led paths).
- 2026-09-30 15:33: Unit 2 Phase 8 gate=pass after 1 RED attempt (tracking lines only). Sweep PASS. Final unit readiness audit dispatched. Budget tier: no Unit 2 phase ran cheap (Phase 8 wrote no code; the tier applies to later phases, none remain).
- 2026-09-30 15:50: Unit 2 unit gate reopen round 1 (readiness rows 7 and 12 untracked; 0 BUG). Closed: depcruise refusal probe saved (qa/unit-gate-depcruise-refusal.txt), row 12 accepted in todo.md, getter-case drop logged. Open-failure set before: {7, 12}.
- 2026-09-30 16:00: Unit 2 unit gate PASS (0 BUG; rows 7 and 12 closed on reopen round 1). Roadmap row set to built, awaiting /ship with Progress log row and Carried-from block. Boundary commits 224e558..b1d910a. Budget tier: no Unit 2 phase ran cheap.
- 2026-09-30 16:10: test/g14-backend-specs created on b1d910a with 2 signed commits (40 Unit 1 route specs, 2 Unit 2 seam tests); working tree clean; npm run check exit 0 (server 1535 pass, web 504 pass). Roadmap complete.
