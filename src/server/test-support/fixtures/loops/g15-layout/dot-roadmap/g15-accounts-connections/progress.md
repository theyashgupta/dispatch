Roadmap: /Users/yash/dispatch-workspaces/GROUP-15/ROADMAP.md, slug g15-accounts-connections

## Run
- Armed: 2026-10-05, engine prompt per roadmap-loop, promise `ROADMAP COMPLETE g15-accounts-connections`, max iterations 148 (41 phases, 5 units).
- Base: `GROUP-15` at `3912003` (origin/main). Session root: `/Users/yash/dispatch-workspaces/GROUP-15`. Repo: `dispatch/`.
- Pushover: not configured on this machine (no PUSHOVER name in either vault schema, sibling precedent G13). Each Pushover step is recorded as skipped; the loop reports through DISPATCH_STATUS lines.
- Install note: `npm ci` must run as `env -u NODE_ENV npm ci`, else dev dependencies are skipped.

## Units
| Unit | Ticket | Branch | Status | Current phase | Reopen rounds |
| - | - | - | - | - | - |
| 1 | LOCAL-80 | feat/LOCAL-80-unit-1-account-switch | committed 15e2eba | done | 0 |
| 2 | LOCAL-94 | feat/LOCAL-94-unit-2-account-chain | in progress | phases 2 to 8 gate=pass; next: test the live account override, then Phase 1 part 2, then Phase 9 | 0 |
| 3 | LOCAL-81 | feat/LOCAL-81-unit-3-calendar-macos | pending | - | 0 |
| 4 | LOCAL-82 | feat/LOCAL-82-unit-4-slack-connector | pending | - | 0 |
| 5 | LOCAL-80 | feat/LOCAL-80-unit-5-session-account-ui | pending | - | 0 |

## Carryover specs (uncommitted until test/g15-accounts-connections-specs)
- src/server/adapters/tmux-session-env.test.ts
- src/server/bootstrap/hook-setup-stopfailure.test.ts
- src/server/routes/accounts-switch-route.test.ts
- src/server/routes/cards-session-account-route.test.ts
- src/server/services/domain/limit-surface.test.ts
- src/server/services/orchestration/claude-login-branches.test.ts
- src/server/services/orchestration/claude-usage-callback.test.ts
- src/server/services/orchestration/default-identity-registry.test.ts
- src/server/services/orchestration/default-identity-watch.test.ts
- src/server/services/orchestration/session-account-apply.test.ts
- src/server/services/orchestration/session-account-limit.test.ts
- src/server/services/orchestration/session-account-move.test.ts
- src/server/services/orchestration/session-account-plan.test.ts
- src/server/services/orchestration/session-account-restart.test.ts
- src/server/services/orchestration/session-continue-action.test.ts
- src/server/services/orchestration/session-turn.test.ts
- src/server/test-support/fake-tmux.ts
- src/web/lib/event-copy-accounts.test.ts
- src/web/modules/accounts/domain/running-sessions.test.ts
- src/web/modules/accounts/domain/switch-counts.test.ts
- src/web/queries/session-account-queries.test.ts

## Boundary commits
- Unit 1 on feat/LOCAL-80-unit-1-account-switch: ea6d3fe feat(accounts) server, ded2881 feat(accounts) web, 15e2eba docs(architecture); all signed; base 3912003

## Log
- 2026-10-05: setup done; coverage gate passed for Units 1 to 5; pre-flight green except Pushover (not configured).
- 2026-10-05: engine armed and verified at the session root; Unit 1 started on feat/LOCAL-80-unit-1-account-switch from 3912003.
- 2026-10-05: baseline npm run check on 3912003 exit 0. Unit 1 Phase 1 implementer dispatched (no-budget).
- 2026-10-05 23:3x: Unit 1 Phase 1 implemented (root cause: 180 s login timer, raised to 10 minutes; changed-decisions U1-10 and R-05 logged); comment hygiene clean; QA runner dispatched.
- 2026-10-05: context-health HANDOFF at Unit 1 Phase 1; handoff doc and resume.md refreshed; loop continues.
- 2026-10-05: Unit 1 Phase 1 GREEN: QA 18/18 green, 11/11 red; gate=pass 2026-10-05T18:23:59Z (after adding the live curl re-probe line, changed-decisions PRD gates).
- 2026-10-05: orchestrator context handoff at the safe point after the Phase 1 gate. Current: Unit 1, next phase 2 (Turn state, move service and tmux environment). resume.md refreshed.
- 2026-10-05: session resumed after handoff (engine re-armed to the new session id, ARMED verified). Unit 1 Phase 2 implementer dispatched (no-budget, Opus).
- 2026-10-06: Unit 1 Phase 2 GREEN: QA 14/14 green, 13/13 red; one gate RED attempt (lint in a test after the control byte ordering fix); gate=pass 2026-10-05T19:04:31Z. Phase 3 next (budget, Sonnet implementer).
- 2026-10-06: Unit 1 Phase 3 GREEN: QA 9/9 green, 21/21 red, server suite 1782 pass 0 fail; gate=pass 2026-10-05T19:35:39Z. Changed decisions U1-07 busy outcome, U1-06 limit session and unknown turn logged. Phase 4 next (budget, Sonnet).
- 2026-10-06: Unit 1 Phase 4 GREEN: QA 13/13 green, 9/9 red; one RED attempt (QA G9, empty orgId read counted as a change, fixed in compareIdentity); gate=pass 2026-10-05T20:02:45Z. Phase 5 next (no-budget, Opus).
- 2026-10-06: Unit 1 Phase 5 GREEN: QA 12/12 green, 8/8 red, no credits row ever selected; U1-06 live proof (limit session moves under idle) done; gate=pass 2026-10-05T20:33:25Z. Phase 6 next (budget, Sonnet; UI driven from the main thread).
- 2026-10-06: Unit 1 Phase 6 GREEN: UI audit round 3 11/11 (rounds 1 and 2 RED on evidence harness: splash timing, viewport fold; product fixes: list bullets and gap, same account pending copy); gate attempt 2 after a pipefail fix in the re-probe line; gate=pass 2026-10-05T20:58:28Z. Browser closed. Phase 7 next.
- 2026-10-06: context handoff at 81 percent after the Unit 1 Phase 6 gate. Current: Unit 1, next phase 7 (Architecture record). Handoff doc and resume.md refreshed; engine session_id set to handoff-pending.
- 2026-10-06: session resumed after handoff (engine re-armed, ARMED verified). Unit 1 Phase 7 GREEN: docs record and Session Account Move section; QA RED twice on doc fact errors (limit keys, step order), fixed, extra round 1 under R-28(3); gate=pass. Phase 8 reviews dispatched in parallel.
- 2026-10-06: Unit 1 Phase 8 reviews done: code review, debate (2 P1 fixed), quality audit, security (1 HIGH fixed: hook session id leading dash), standards (named exceptions entry, 2 dismissed by R-04/U1-16), ponytail (8 cuts applied). Three Sonnet fix rounds plus comment hygiene; second pass code review and debate zero P0/P1. Changed decisions U1-05, U1-03 (continue fallback added then reverted), U1-11. Readiness audit: no BUG rows; gaps written into Phase 9. Phase 8 gate running.
- 2026-10-06: Unit 1 Phase 8 GREEN: gate attempt 2 (attempt 1 harness gap: no UI evidence line, R-26(2) WARN); gate=pass 2026-10-05T22:23:11Z. Phase 9 next.
- 2026-10-06: Unit 1 Phase 9 GREEN (BE 43/43 + 15/15 live, UI 11/11 graded, B51 stale pane text bug fixed and re-proved, gate=pass 2026-10-05T23:30:43Z). Unit sweep: attempt 1 reopened phases 2 and 3 on gate re-probe test-data drift (LOCAL-1 restarted onto Default by Phase 9 U12), restored LOCAL-1 to 645afefe, gates re-passed, SWEEP PASS. Readiness: ship with named risks, no BUG. Roadmap Unit 1 built, awaiting /ship. Boundary commits ea6d3fe, ded2881, 15e2eba (signed). Unit 2 next.
- 2026-10-06: Unit 2 started on feat/LOCAL-94-unit-2-account-chain from the Unit 1 branch (15e2eba).
- 2026-10-06: Unit 2 Phase 1: real sandbox started on 48790 (DISPATCH_DIR /private/tmp/claude-501/g15-u2/dispatch-dir, real claude 2.1.290, real usage; tool qa-tools/real-sandbox.sh). STOP R-31: waiting for Yash to log in the second Claude account at http://localhost:48790/#/accounts. Pushover skipped (not configured). Engine session_id set to handoff-pending so the turn can end; on resume write the session id back.
- 2026-10-06: orchestrator ruling: while R-31 waits, run Unit 2 phases that need no second account (changed-decisions U2-02 order); Unit 3 planning only. Unit 3 PRD re-verified: 13/13 U3 decisions covered, 9 phases, no changed decision affects it; grill and PRD were done 2026-10-05, nothing to redo. Unit 2 Phase 2 implementer (Sonnet) and Phase 1 study (no-account points, Opus) dispatched.
- 2026-10-06: real sandbox 48790 restarted from a frozen copy of the Unit 1 build (.planning/g15-accounts-connections-unit-2/real-app/dist) so Unit 2 rebuilds of dispatch/dist cannot change what Yash logs in on; same URL. Unit 2 Phase 2 implemented (Sonnet): registry v2 with positions, chain-state.json, claudeAccounts settings; 39/39 phase tests, Unit 1 suites 118/118.
- 2026-10-06: Unit 2 Phase 1 part 1 (no-account study points) written: docs/research/claude-accounts-study.md, evidence in .planning/g15-accounts-connections-unit-2/qa/phase-1/evidence/. Left for after R-31: expiresAt of each account, usage of both, resume under the second folder, subagent during a switch. Finding for Phase 4: the usage-billing credits option "Switch to usage" is not matched by CREDITS_OPTION (limit-surface.ts:9); add it as defense in depth.
- 2026-10-06: Unit 2 Phase 2 GREEN (QA 4/4 + 4/4 after the R4 settings fix; gate attempt 2 after a fake-sandbox port harness fix). Phase 3 GREEN (QA 6/6 + 2/2, 144 tests incl. 125 combinations; gate pass). Changed decisions U2-02 (order), U2-05 (login-expired scope). Phase 4 next (no-budget, Opus).
- 2026-10-06: Unit 2 Phase 4 implemented (Opus): account-chain.ts controller, requestFailover, timers, pane scan; 1063/1063 + 200/200 tests; changed decisions U2-07 (30 s pane scan), U2-12 (single exhausted check). Orchestrator context handoff at 50 percent. Current: Unit 2 Phase 4, next comment hygiene (14 JSDoc summaries), QA, gate. Real sandbox 48790 (pid 25077) stays up; two account real check waits for Yash. resume.md and the 2026-10-06 handoff doc refreshed; engine session_id set to handoff-pending.
- 2026-10-06: session resumed after handoff (engine re-armed to 2b7418d8, ARMED verified). Unit 2 Phase 4 comment hygiene: 14 multi-line JSDoc summaries fixed, check TOTAL 0; dist rebuilt; targeted tests 86/86. Phase 4 QA runner dispatched; Phase 5 implementer (Sonnet, brief .planning/g15-accounts-connections-unit-2/briefs/phase-5.md) dispatched in parallel (no dist rebuild).
- 2026-10-06: Unit 2 Phase 4 QA attempt 1 RED (R8 return timer cancelled by a read after the reset; G5 stale surface after reset re-limited and blocked the exhausted continue; edge: continue after a late limit surface). Fixed in the main thread (no-budget): ingest keeps the return timer, isStaleSurface, move reports leftLimit; changed-decisions U2-07 (stale surface). Tests 30/30 in 4 time zones. QA rerun dispatched.
- 2026-10-06: Unit 2 Phase 5 implemented (Sonnet) and GREEN (QA 17/17 + 6/6; follow-up fixes: strict order body, Switch now label); gate=pass. Pushover skipped. Phase 6 implemented (Sonnet), checks green; UI checks next from the main thread.
- 2026-10-06: Unit 2 Phase 4 GREEN (QA rerun 4/4 + 1/1 live at production cadences; gate attempt 1 RED on a grep -q SIGPIPE in the re-probe line, harness fix); gate=pass. Phase 6 GREEN (UI audit 7/7 + 4/4, 3 WARNs to todo); gate=pass. Phase 7 doc section written (main thread), fact check QA running. Browser closed.
- 2026-10-06: Unit 2 Phase 7 GREEN (doc fact check RED attempt 1 on the exhausted re-check sentence, fixed; recheck 9/9 + 1/1); gate=pass. Phase 8 reviews done: code review (1 P1, 6 P2), debate (5 P1, 8 P2), quality ACCEPTABLE (2 High DRY), security (0 High, 1 Medium), standards (3 Medium), ponytail (9 agreed cuts), spec fidelity 3/3 MATCHED. Rulings logged (changed-decisions U2-11 fresh read and boot return, U2-07 pane signal, U2-15 pin and pending moves, U2-10 continue safety). Fix batch 1 (Opus, 10 items, 506/506 tests) applied; boot return narrowed in the main thread; fix batch 2 (Sonnet cleanup) running. Deferred findings in todo.
- 2026-10-06: Unit 2 Phase 8 second pass: code review 0 P0/P1 (N-1 boot return after Switch now and N-2 pin during a running move fixed in the main thread with 2 tests, mutation checked; 6 P3 to todo); doc recheck RED on one study fact (fixed, attempt logged); check:static green after @internal tags on two test hooks. Debate second pass and live recheck running.
- 2026-10-06: Unit 2 Phase 8 debate second pass 0 P0/P1, all 11 must-not items hold; P2-1 (manual re-pick undone at boot) fixed via noteManualSwitch; P3-5, P3-6 fixed; other P3 to todo; server tests 538/538. Live recheck of all fixes GREEN 4/4 + 5/5 (qa/phase-8/live). Readiness audit running.
- 2026-10-06: Unit 2 Phase 8 readiness audit found 3 BUG rows (reset failover feed text, U2-14 reason fields, a second failover in one busy turn stranded a queued session); fixed by an Opus pass with 12 mutation-checked guard tests (changed-decisions U2-10 chain and pending moves, U2-14 record reason); server 550/550, web 255/255; readiness addendum: zero open BUG rows, gaps written into the Phase 9 block. Phase 8 gate=pass. Phases 2 to 8 all gate=pass. Real sandbox 48790 (pid 25077) still has only Default: R-31 login pending. STOP NEEDS_INPUT. Pushover skipped (not configured).
- 2026-10-06: orchestrator asked to copy the live second account (1fd8d89b, live ~/.dispatch) into the sandbox. Not done: the folder holds no token (keychain item keyed by a hash of the config dir path), so a copy reads logged out; cloning the keychain item would share one refresh token with the live login and can log it out. Asked Yash to log in inside the sandbox at 48790 or to approve the keychain clone explicitly. STOP NEEDS_INPUT.
- 2026-10-06: orchestrator ruling: use the live second account by path (DISPATCH_ACCOUNT_DIRS override, read only; changed-decisions R-31 harness only). Override coded in claude-accounts.ts, claude-login.ts, claude-account-ops.ts, steps.ts, session-account-move.ts (typecheck clean, untested, not built). Orchestrator context handoff at 50 percent. Current: Unit 2, next = override tests, branch-build real sandbox, Phase 1 part 2, Phase 9. Handoff doc 2026-10-06-...-session-handoff-2.md, resume.md refreshed.
- 2026-10-06: resume message arrived in the same session (no clear); continued here, engine ARMED to 2b7418d8. Opus agent dispatched: override unit tests, branch-build real sandbox p9 with the live account by path, Phase 1 study part 2.
- 2026-10-06 17:5x: session 655b4c04 resumed after /clear (engine ARMED verified). The Opus agent dispatched before the clear (override tests, p9 real sandbox, Phase 1 part 2) is still running; not duplicated. Phase 9 test plan writer dispatched; Phase 9 committed tests brief written (.planning/g15-accounts-connections-unit-2/briefs/phase-9-tests.md), Sonnet dispatch waits for the Opus dist rebuild.
- 2026-10-06 19:20: Unit 2 Phase 1 GREEN (gate=pass after the Opus agent finished override tests, the p9 real sandbox on 48796 and study part 2; changed-decisions PRD gates token grep). Phase 9 in progress: committed readiness tests added (12, mutation checked); real-session defects fixed in the main thread (trust dialog focus, background work exit menu; changed-decisions U1-03, U1-05) and B16 (empty settings patch) fixed; build refrozen at qa/phase-9/app/dist. REAL lane R01 to R07 GREEN on attempt 2 (attempt 1 harness collision: the BE tools wiped the real workspace folder; BE tools now use workspaces-p9be): real Switch now Default to second account kept conversation 3cd42fd4 and answered AGAIN (qa/phase-9/real-switch.txt). BE batch 1 19/20 (B16 fixed, rerun in batch 2). UI lane U01 to U30 driven; independent UI audit running. BE batch 2 (B16 rerun, B21 to B37) running; batch 3 (B38 to B49) next. Real sandbox 48796 (pid 90194) stays up until the unit sweep (Phase 1 live curl line).
