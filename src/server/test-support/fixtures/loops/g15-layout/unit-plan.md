# G15 Accounts and Connection Fixes Roadmap

## What we are building

The user adds, logs in and selects Claude accounts in the app with no terminal. Running sessions move to the new account at a safe point, and Dispatch detects a login change outside the app. An ordered chain of accounts moves the work to the next account with allowance at a usage limit and back to the primary at its reset. Calendar on macOS gets a permission flow that works under the LaunchAgent and a card that tells the true state. Slack reads through the Claude Slack connector by default, and the token mode stays as a second mode.

Slug: `g15-accounts-connections`. Decision register: `.roadmap/g15-accounts-connections/decisions.md` (R-01 to R-32). Repo worktree: `dispatch/`, branch `GROUP-15`, base `3912003` (origin/main). Parallel loop: GROUP-14 (G13 cutover).

## Tickets in scope

| Ticket | Title | Unit |
| - | - | - |
| LOCAL-80 | Accounts: running sessions follow an account switch and an external login change | 1 and 5 |
| LOCAL-94 | Accounts: priority chain with automatic failover and return to the primary account | 2 |
| LOCAL-81 | Calendar: reliable macOS permission flow and honest connection status | 3 |
| LOCAL-82 | Slack: read Slack through the Claude Slack connector (MCP) as the default mode | 4 |

## Verified findings

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| `PUT /accounts/active` writes one pointer and refreshes usage, touches no session | research 1 | Confirmed | `routes/accounts.route.ts:51-58` |
| Only a new session reads the pointer; launch sets `CLAUDE_CONFIG_DIR`; Default sets none | research 1 | Confirmed | `steps.ts:585`, `domain/claude-launch.ts:37` |
| Run Claude and Resume use the recorded account | research 1 | Confirmed | `resume-session.ts:116-117` |
| The architecture rule says a switch never moves a live conversation | research 1 | Confirmed | `docs/ARCHITECTURE.md:2026` (not `:2024`) |
| The registry is empty | research 1 | Confirmed | `~/.dispatch/claude-accounts/accounts.json` is `accounts: []` on 2026-10-05, file time 2026-10-01 20:42 |
| The in-app login url parser is the fault | hypothesis | Refuted | `extractLoginUrl` matches Claude CLI 2.1.289 output (probe 2026-10-05 in a scratch config folder) (R-05) |
| Every live session uses Default | data check | Confirmed | 16 of 16 cards with `claudeAccountId` hold `default` in `~/.dispatch/board.db` |
| An in-app add and login exists | LOCAL-94 | Confirmed | `claude-login.ts` spawns `claude auth login` with a pasted code; each failure branch of `settle()` deletes the new folder |
| Dispatch detects a home login change | research 1 | Refuted (absent) | no identity compare anywhere; `readClaudeIdentity()` exists in `adapters/claude-cli.ts:26` (R-09) |
| A limit shows as an options dialog | LOCAL-80 | Refined | CLI 2.1.289 main session shows `Usage limit reached · continuing automatically at 10:40am · esc to cancel` (tmux `dsp-GROUP-13`); no code detects any limit surface today (R-10) |
| A subagent survives an account change | LOCAL-94 point 5 | Partly answered | a subagent at the limit dies: `API error: You've hit your weekly limit · resets Oct 6 at 8:30am (Asia/Calcutta) (error type rate_limit, HTTP 429 ...)` (tmux `dsp-GROUP-14`) |
| Poll each 2 minutes above 80 percent | LOCAL-94 | Conflict | `docs/ARCHITECTURE.md:2031`: 15 minutes because tighter polling gets 429 (R-11) |
| A not used account can refresh its token | LOCAL-94 point 1 | Open | Dispatch never rotates refresh tokens (`docs/ARCHITECTURE.md:2033`) (R-12) |
| Idle and busy are knowable | LOCAL-80 | Confirmed | `hook-events.ts:271-298` (`UserPromptSubmit`, `Stop`), pane watcher `adapters/markers/watcher.ts` (R-07) |
| Usage endpoint can be faked | LOCAL-94 | Confirmed | `DISPATCH_USAGE_URL` override, `adapters/claude-usage.ts`; buckets `five_hour`, `seven_day` with `utilization`, `resets_at` |
| A fake `claude` exists | all | Confirmed | `test-support/fixtures.ts:14-68` (login codes good, deny, hang, noid; fake keychain); `test-support/stub-claude.ts` (ask) |
| Session rows and the detail header are modules | LOCAL-80 | Refuted | `features/sessions/SessionRow.tsx`, `features/detail/PanelHeader.tsx` are legacy; G13 Unit 3 (not started) migrates them (R-03) |
| The server runs as plain node under a LaunchAgent | research 3 | Confirmed | `~/Library/LaunchAgents/com.dispatch.app.plist`: `~/.nvm/versions/node/v24.19.0/bin/node`; macOS 26.6.2 |
| Script waits 25 s for the prompt, read limit 30 s | research 3 | Confirmed | `calendar-mac.ts:10`, `:28`; one osascript call holds both |
| Only full access passes; write-only reads as denied | research 3 | Confirmed | `calendar-mac.ts:34` `return status === 3`; the status integer is lost (R-19) |
| One UI message for denied and not asked | research 3 | Confirmed | `src/shared/connection-status.ts:173` (moved from `web/lib`) |
| Status shows no error while off | research 3 | Confirmed | `services/orchestration/calendar.ts:67` |
| An "Open System Settings" action exists | LOCAL-81 | Refuted (absent) | the copy names System Settings; no action exists |
| A signed helper is possible | LOCAL-81 design A | Refined | Swift 6.3.3 present; 0 code signing identities; ad hoc signature only (R-18) |
| Slack today is a token poll each 120 s with no write path | research 2 | Confirmed | `sources/registry.ts:26`; no `chat.postMessage` or `reactions.add` |
| The connector parser matches Granola only | LOCAL-82 | Confirmed | `granola-actions.ts:33` `/granola/i` (R-21) |
| The Granola round is the template | research 2 | Confirmed | `granola-round.ts:180-192`, guard `:35-37`, hourly `granola-actions.ts:18`, route `meetings.route.ts:181` |
| The Slack connector exists on this login | LOCAL-82 | Refuted | `claude mcp list` shows no `claude.ai Slack`; `plugin:design:slack` needs authentication (R-20) |
| An existing token setup exists on this Mac | LOCAL-82 | Refuted | `config.json` has no `sources.slack` (R-23) |

## Architecture decisions

1. Five units: one per ticket, plus Unit 5 that puts the LOCAL-80 session surfaces on the migrated session row and detail header after G13 Unit 3 (R-01, R-03).
2. Stacked local branches, a trailing specs branch, the orchestrator ships; the loop never pushes (R-01, R-02).
3. A move happens only at a safe point through one service that shares the launch builder (R-07, R-08).
4. Default identity watch is the main live path, because each live session is on Default (R-09).
5. The limit action handles each limit surface that the installed CLI shows, and never a credits option (R-10).
6. The 2 minute poll is limited to the account in use above 80 percent, with the existing 429 backoff (R-11).
7. Automatic moves are off by default until the user rules on the terms (R-13).
8. Calendar design A or B is decided from Phase 1 evidence; a reset always names one bundle id (R-17, R-18).
9. Slack calls allow an explicit read tool list and validate JSON with zod (R-22).

## Rejected alternatives

- Edit the legacy session row and detail header in Unit 1: rejected, the orchestrator forbids edits to `src/web/features/`, and G13 Unit 3 rewrites both files.
- Keep LOCAL-80 as one PR by waiting for G13 Unit 3 inside Unit 1: rejected, it blocks Units 2 to 4, which do not need it.
- Poll usage each 2 minutes for each account: rejected, the documented 429 limit (R-11).
- Measure the login change on the real home login: rejected, a logout ends each live session on this Mac (R-06).
- Run the Calendar check under `com.dispatch.app`: rejected, it is the live server on port 4700 (R-16).
- Allow the whole Slack server prefix as the tool list: rejected, the ticket needs a read only list that a test asserts (R-22).

## Open questions

1. Terms (R-13): answered by R-30, automatic moves built and off by default.
2. Second Claude account: answered by R-31, Unit 2 stops once for the login.
3. Slack connector: answered by R-32, a free test workspace with a setup guide at Unit 4 Phase 1.
4. Calendar prompt (R-16), owner Yash, needed by Unit 3 real check: accept or deny the one macOS prompt when the loop stops.

## Units

### Unit 1: In-app account flow, session moves and login change detection
- **Tickets:** LOCAL-80 (with the LOCAL-94 changes to LOCAL-80)
- **Repos:** dispatch (1 PR)
- **Depends on:** none
- **Delivers:** the reproduced and fixed in-app add, login and select flow; the session move service with a pending queue for busy sessions; `applyToRunning` on `PUT /accounts/active`; `POST /cards/:id/session/account`; the Default identity watch with the stale mark; the "Continue on the active account" limit action; the switch dialog with the apply choice and the session count; a running sessions list on the Accounts page with the shared account label, stale badge and restart action; the dated record in `docs/ARCHITECTURE.md`.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes. In a sandbox with two account folders and the fake `claude`: a switch with `idle` moves an idle session, which keeps its conversation id and runs with the new config folder; a busy session moves after its `Stop`, not before; after a move Run Claude and Resume use the new account; a Default identity change in the fake shows the stale badge within one refresh interval and the restart action clears it; a session at each limit surface continues after the action and the test asserts the keys sent and no credits option. The Accounts page, the switch dialog, the label and the stale badge render at 1440 px and 390 px in both themes.
- **Spec artifacts:** none (no prototype, image or quoted copy). The copy "Continue on the active account" is quoted in the ticket and binds.
- **Execution:** mode full-subagent, budget tier; no-budget for the move service and the limit action (first move of a live session, R-24)
- **PRD:** `dispatch/.planning/prds/g15-accounts-connections-unit-1.md` (9 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** the fault may not reproduce (R-05 sets the fallback). The limit surface text depends on the CLI version (R-10). `src/shared/types.ts` gains an activity event kind (shared file rule, R-02).
- **Scope corrections:** session row and detail header surfaces move to Unit 5 (R-03); limit surfaces refined (R-10); the real session measures the move path only (R-06).
- **Carried-from (for Units 2 to 5):** the one move service is `services/orchestration/session-account-move.ts#moveSessionAccount(cardId, accountId, sessionId?, cause)`; queue or move through `session-account-apply.ts#moveOrQueue`, the switch planner is `applyAccountChoice`. Turn state: `session-turn.ts#liveTurnState`. Limit surface parsing and key planning: `services/domain/limit-surface.ts` (never selects a credits row). A pending move clears on any settled move and on a later switch to another account (changed-decisions U1-05). The launch helper `steps.ts#typeLaunchLine` now waits up to 3 s for old pane text to clear. Shared web pieces: `src/web/components/SessionContinueButton.tsx`, `SessionRestartButton.tsx`, `badges/SessionAccountLabel.tsx`, `badges/StaleBadge.tsx`, move mutation in `src/web/queries/session-account-*.ts`. Sandbox tooling in `dispatch/.planning/g15-accounts-connections-unit-1/qa-tools/`; the fake REPL wedges after a card start. Moves on PUT /accounts/active run serially (about 4 s each on the fake).

### Unit 2: Account priority chain with failover and return
- **Tickets:** LOCAL-94
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1 (the move service and the limit surface detection)
- **Delivers:** `docs/research/claude-accounts-study.md` with evidence for the 6 points and the terms result; the chain model with per account state; the pure selection function; the triggers, the failover action, the return timers, the stability rule and the exhausted case; timers that survive a restart; activity events and notifications; the chain UI with drag order, countdown, marker, automatic switch, threshold, "Switch now" and move history; one exported failover function for LOCAL-89.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes. The selection function has tests for a chain of 3 accounts in each combination of states. In a sandbox with a fake usage endpoint and the fake `claude`: the primary reaches its limit and within one poll interval each idle session runs on secondary 1 and continues its conversation; at the primary reset each session returns at idle and a busy session after its turn; with each account limited no move happens, the page shows the earliest reset and each session continues at that time with no key press, and a test asserts no credits option; a usage value around the threshold causes at most one move inside the minimum time; a restart between a failover and a reset keeps the return timer. One real check with two real accounts: "Switch now" moves a real idle session and it continues the same conversation. Chain, countdown and history render at 1440 px and 390 px in both themes.
- **Spec artifacts:** none. The copy "Switch now" binds.
- **Execution:** mode full-subagent, budget tier; no-budget for the study, the selection function and the failover state machine with timers (R-24)
- **PRD:** `dispatch/.planning/prds/g15-accounts-connections-unit-2.md` (9 phases)
- **Status:** in progress
- **Risk notes:** the terms ruling can remove automatic moves (R-13). A stale token on a not used account can hide its allowance (R-12). The 2 minute poll can get 429 (R-11). The real check needs a second account login by the user (R-27).
- **Scope corrections:** poll cadence limited (R-11); automatic moves off by default (R-13, R-30); chain storage with the registry and settings in `config.json` (R-14); no supervisor code (R-15).

### Unit 3: Calendar permission flow on macOS
- **Tickets:** LOCAL-81
- **Repos:** dispatch (1 PR)
- **Depends on:** none in code (stacked after Unit 2 by R-01)
- **Delivers:** the Phase 1 diagnosis (macOS version, how the server runs, the EventKit status that the server process gets, the process that Privacy and Security names); the Phase 2 decision record (design A or B); the status codes for not asked, denied, restricted, write only, prompt timeout, read timeout, missing calendars and unknown; separate prompt and read time limits; status with the permission state while the connection is off; "Check access" and "Open System Settings" actions; the card with the permission state, the app name to enable, the last error, the last poll time, the event count and missing calendars by name; the iCal URL mode unchanged.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes (also on a machine with no Swift, R-18). Under the sandbox LaunchAgent after a scoped reset: the prompt appears and names the owner from the decision; the grant persists after a restart and after a node version change; "Load calendars" lists the real calendars; after Connect the event count is above zero and Today shows events from the next 48 hours; the deny path shows the denied state with the System Settings action and the not asked state shows a different message. Each card state renders at 1440 px and 390 px in both themes.
- **Spec artifacts:** none.
- **Execution:** mode full-subagent, budget tier; no-budget for the diagnosis and the decision (R-24)
- **PRD:** `dispatch/.planning/prds/g15-accounts-connections-unit-3.md` (9 phases)
- **Status:** not started
- **Risk notes:** ad hoc signature only (R-18). A helper started by node may still count node as the responsible process; Launch Services start is required (R-18). One stop for the macOS prompt (R-16). An unscoped TCC reset is forbidden (R-17).
- **Scope corrections:** the real check runs under a sandbox LaunchAgent, not `com.dispatch.app` (R-16); status codes come from the raw EventKit integer (R-19).

### Unit 4: Slack through the Claude Slack connector
- **Tickets:** LOCAL-82
- **Repos:** dispatch (1 PR)
- **Depends on:** none in code (stacked after Unit 3 by R-01); the user connects the Slack connector first (R-20)
- **Delivers:** the spike result (tool names, auth states, read coverage, time and cost of one round); `sources.slack.mode` with `mcp` and `token`; the connector parser with a name pattern; the Slack round service with an explicit read tool list, a zod schema, dedupe by conversation and time stamp, and a since and until cursor; the 30 minute cadence with "Run now" and a guard; the thread view through one call with the 10 minute cache; channel listing through the connector or a pasted link; the card with the mode select and the connector state.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes. With a fake `claude` that returns a recorded round output, a round creates the expected Slack items once and a second round creates none; a connector that needs auth makes no model call and the card shows the steps; an invalid output fails the schema, creates no item and shows an error on the card; a test asserts that the allowed tool list holds read tools only; one real round returns at least one real item, or the PR states why. Both card modes and the Slack page render at 1440 px and 390 px in both themes.
- **Spec artifacts:** none.
- **Execution:** mode full-subagent, budget tier; no-budget for the spike and the allowed tool list (R-24)
- **PRD:** `dispatch/.planning/prds/g15-accounts-connections-unit-4.md` (9 phases)
- **Status:** not started
- **Risk notes:** the spike cannot run without a connected connector (R-20). If the connector cannot read what the scope needs, the ticket requires a stop.
- **Scope corrections:** mode default from the Vault token (R-23); explicit read tool list (R-22).

### Unit 5: Session account label and stale badge on the migrated session surfaces
- **Tickets:** LOCAL-80 (the session row and detail header part)
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 1 (the shared components) and G13 Unit 3 (LOCAL-76) committed or on origin/main (R-03)
- **Delivers:** the shared account label, stale badge and restart action mounted on the session row and in the detail panel header of the migrated modules.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; the label, the stale badge and the restart action render on the session row and in the detail panel header at 1440 px and 390 px in both themes; the restart action clears the badge in the sandbox.
- **Spec artifacts:** none.
- **Execution:** mode qa-subagent, budget tier (a mount of finished components into finished modules)
- **PRD:** `dispatch/.planning/prds/g15-accounts-connections-unit-5.md` (5 phases)
- **Status:** not started
- **Risk notes:** it waits on another loop (R-03).
- **Scope corrections:** split out of LOCAL-80 because the target files belong to G13 (R-03).

## Progress log

| Date | Unit | Outcome | Deviation from plan |
| - | - | - | - |
| 2026-10-05 | all | roadmap written, awaiting approval | none |
| 2026-10-05 | all | roadmap approved by Yash (R-29); rulings R-30, R-31, R-32 | R-20 refined by R-32 (Slack test workspace) |
| 2026-10-05 | 1 | grilled (U1-01 to U1-19) and PRD written, 9 phases; coverage gate passes | `StopFailure` is not registered today, Phase 2 adds it only if the CLI emits it; the fake REPL extends `writeFakeRepl()` |
| 2026-10-05 | 2-5 | grilled (U2-01 to U2-18, U3-01 to U3-13, U4-01 to U4-11, U5-01 to U5-05) and PRDs written: 9, 9, 9 and 5 phases; coverage gate passes for all units | R-14 refined by U2-04 (state in `chain-state.json`); R-27 refined by U4-03 (two real Slack calls) |
| 2026-10-05 | 1 | execution started (roadmap-loop armed, 148 iterations, budget tier, full-subagent) | Pushover not configured, steps skipped |
| 2026-10-06 | 1 | built, awaiting /ship: 9 phases GREEN, sweep clean, readiness ship with named risks (no BUG), npm run check passes | changed decisions U1-05 (pending clear), U1-03 (resume argument, reverted to the original), U1-11 (continue hidden on the active account); Phase 8 fixed a hook session id flag injection (HIGH) and two P1s; Phase 9 fixed a stale pane text bug in the shared launch helper |
