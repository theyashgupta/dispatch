# G13 Module Migrations B and Cutover Roadmap

## What we are building

The last legacy surfaces move from `src/web/features/` into `src/web/modules/<feature>/` on shadcn primitives: the daily pages and the card action dialogs, then the board, then the detail panel, Sessions and Workspace. Then the cutover deletes the legacy tree, lifts the lint scope to all of `src/web/`, retires the invariants that lint now covers and adds a Playwright screenshot suite. After all units ship, the web app has zero inline styles, the ttyd iframe never remounts, and every request, notice and screen is the same as before.

Slug: `g13-modules-b`. Decision register: `.roadmap/g13-modules-b/decisions.md` (R-01 to R-24). Repo worktree: `dispatch/`, branch `GROUP-14`, base `8f2c59d` (`base/g13`, the G11 stack tip). origin/main is `46d060b`.

## Tickets in scope

| Ticket | Title | Unit |
| - | - | - |
| LOCAL-74 | UI: Inbox, Today, Ask, Activity, Flow and card action dialogs modules | 1 |
| LOCAL-75 | UI: Board module on dnd-kit with shadcn Card and Badge | 2 |
| LOCAL-76 | UI: Detail panel, Sessions and Workspace modules with the terminal invariant | 3 |
| LOCAL-77 | UI: cutover, legacy deletion, global lint scope and screenshot suite | 4 |

## Verified findings

| Claim | Source | Verdict | Evidence |
| - | - | - | - |
| Base is origin/main with every G10 and G14 PR plus the G11 stack | orchestrator | Refined | `8f2c59d` lacks G14 (#174 to #176) and the G10 specs (#173); all of G11 is now on main as #177 to #180; `git merge-base -is-ancestor origin/main HEAD` is 1 (R-02) |
| inbox 7 files 16 sites, modals 9 files 100 sites | LOCAL-74 | Confirmed, refined | `style={{` 16 and 100; `style=` 28 and 106. today 9, ask 4, flow 7 files confirmed (R-13) |
| Each LOCAL-74 folder stands alone | implicit | Refuted | inbox imports `../board` (`PRIORITY_DOT`, `isInboxWaiting`), `../slack` (`SlackThread`), `../modals` (`MultiSelect`); modals import `../workspaces` (`WorkspaceAdd`) and `../board` (`MemberRow`) (R-03, R-05) |
| Card mutations move to `src/web/queries/cards.ts` | LOCAL-74 | Refined | they exist in `modules/board/queries/board-api.ts:40-560`; standard naming gives `cards-api.ts` and `cards-queries.ts` (R-07) |
| `useItems`, `useAsk` retire into queries | LOCAL-74 | Confirmed | `setItemState`, `snoozeItem`, `promoteItem` in `modules/inbox/queries/inbox-api.ts`; `askQuestion` in `modules/ask/queries/ask-api.ts`; importers `App.tsx` and `AskPage.tsx` |
| `useActivityFeed`, `useUnseenActivity` retire into SSE queries | LOCAL-74 | Refuted | `useActivityFeed.ts` is gone (G11); `useUnseenActivity.ts` is a `localStorage` map with 8 importers in App, board, detail, inbox and orca (R-08) |
| `ActivityItem`, `FlowStage`, `Kbd` lose all importers in LOCAL-74 | LOCAL-74 AC | Refined | `ActivityItem`: also `detail/CardTimeline.tsx`; `FlowStage`: also `detail/SessionFlowRow.tsx`; only `Kbd` hits zero (R-14) |
| `InboxMenu` is a hand-rolled `role="menu"` overlay | LOCAL-74 | Confirmed | `features/inbox/InboxMenu.tsx:145`, `role="menuitem"` at `:70` |
| Shortcuts open the inbox menu | LOCAL-74 AC | Refined | keys j, k, Enter, e, s, o, u, a (`lib/shortcuts.ts:51`); `s` opens the snooze menu; the row menu opens from its button (R-16) |
| Every named shadcn primitive exists | all | Confirmed | `components/ui/` has dropdown-menu, pagination, command, popover, textarea, field, toggle-group, kbd, item, empty, alert-dialog, dialog, select, input, card, badge, resizable, sheet, collapsible, alert. No `form` (the standard says use Field) |
| `MultiSelect` serves the modals | LOCAL-74 | Refuted | no modal imports it; importers `App.tsx:1011` (activity header), `inbox/InboxToolbar.tsx`, `settings/ConnectionsTab.tsx` (G12 deletes it) (R-05) |
| Shortcuts stay off behind dialogs | implicit | Partly | `hooks/useShortcuts.ts:40` gates on `modalDepth()` of the legacy Modal only; Radix focus scope covers most keys (R-09) |
| board 25 files, 84 inline sites | LOCAL-75 | Confirmed | `style={{` 84, `style=` 85 |
| The board domain files belong to the board | LOCAL-75 | Refuted | `PRIORITY_DOT` read by inbox and tickets; `COLUMN_ACCENT` and the attention predicate by orca; `MemberRow` by modals and detail; `cardPrs` by detail; `SINGLE_LINE_COPY` by orca (R-05) |
| `column-meta.ts` holds `COLUMN_ACCENT` and `PRIORITY_DOT` | LOCAL-75 | Refuted | `PRIORITY_DOT` is in `features/board/CardView.tsx`; NEW-24 reads it as `CARD_VIEW_PATH` (R-05) |
| The 10 board domain files have tests | LOCAL-75 | Refuted | tests exist for `board-keys`, `column-meta`, `inbox-count` only; 7 need a new test |
| Optimistic move through the ticket 7 mutation, 409 shows `move-error-copy` | LOCAL-75 AC | Refuted | legacy board moves in local state and rolls back silently (`Board.tsx:332-346`); `useMoveCardMutation` has no caller; `move-error-copy.ts` importer is `detail/LinearSection.tsx` only (R-10) |
| Mouse and touch sensors | LOCAL-75 | Confirmed | `Board.tsx:251-254`: mouse distance 5, touch delay 200 tolerance 8 |
| detail 17 files 80 sites, orca 7 files 19 sites, sessions 8 files | LOCAL-76 | Confirmed | `style=` 90, 28 and 18 |
| Panel is a Sheet under `NARROW_QUERY` | LOCAL-76 | Refuted | takeover keys on `CAROUSEL_QUERY` 1023 px (`DetailPanel.tsx:91-93`); a Sheet portal would remount the iframe (R-11) |
| `docked` mode at `App.tsx:1274` | LOCAL-76 | Refined | `App.tsx:1163` |
| `Modal.tsx` last importers leave in LOCAL-76 | LOCAL-76 | Refined | 18 feature importers (10 in G12 folders) plus `hooks/useShortcuts.ts` (R-18) |
| LOCAL-77 deletes `lib/route.ts`, `nav-state.ts`, `useRoute`, `useNavState`, `useBoardStream`, `AppShell.tsx` | LOCAL-77 | Refined | all six are already gone (G11); `App.tsx` 1227 lines, 29 `useState` (R-23) |
| 356 cited paths in `ARCHITECTURE.md` | LOCAL-77 | Refined | 281 unique source paths, 34 under `features/` or `primitives/` (R-22) |
| Hex only in the listed files | LOCAL-77 AC | Refined | also `favicon.svg` (2) and `detail/PanelHeader.tsx` (1) (R-23) |
| `FROZEN_COUNT` is 149 | LOCAL-77 | Confirmed | `scripts/check-invariants.mjs:76`; `invariant-baseline.txt` 149 lines |
| `@playwright/test` is new | LOCAL-77 | Confirmed | not installed; CI runs `npm run check` only; colima is installed, daemon off (R-24) |

Production data check (skill step 4): not applicable. These units change no server state. Parity is proven live against the previous stack tip (R-21).

## Architecture decisions

1. One unit per ticket, fixed order, stacked branches, trailing specs branch, orchestrator ships (R-01).
2. Start from `8f2c59d` and merge origin/main in Unit 1 Phase 1, keeping the lineage the G12 branches share (R-02).
3. Merge committed G12 branches before a phase needs their shared pieces; take the G12 version of a file both create (R-03, R-06).
4. G12 must be on main before the cutover; the final merges take the side of main (R-04).
5. Placement by reader count moves the cross-module board domain to shared tiers, with invariant subject paths updated in the same commit (R-05).
6. Board move, panel layout and dialog behaviour stay as legacy does them, not as the ticket text says (R-10, R-11, R-15).
7. Legacy files go when their importers hit zero after the newest G12 merge (R-18).

## Rejected alternatives

- Cut Unit 1 from origin/main: it drops the `8f2c59d` lineage, so a merge of a G12 branch has no recent common ancestor and conflicts on every G11 file.
- Copy `WorkspaceAdd` into the card actions module: a duplicate of the G12 shared component, a sure add and add conflict, and two folder browsers until ticket 16.
- A render prop slot for `WorkspaceAdd` from `App.tsx`: works, but adds a callback contract that ticket 16 removes again; the G12 merge gives the real component.
- Board domain files in `modules/board/domain/` (ticket text): inbox, workspace, detail and G12 tickets read them, and modules cannot import a sibling.
- Radix Sheet for the narrow panel (ticket text): the portal moves the iframe to a new parent at 1023 px and remounts it (PANEL-03).
- A new error copy on a failed board move: legacy shows none; the no-break rule forbids it.
- Delete `ActivityItem` and `FlowStage` in Unit 1 (ticket AC): detail still imports both.
- Split Unit 1 into two units: the orchestrator fixed one unit per ticket.

## Open questions

None block the loop. Watch items:

- G12 Unit 1 commit time sets the start of the Unit 1 card actions phase. Owner: the loop, polling every 15 minutes (R-03).
- G12 Unit 3 may move `PRIORITY_DOT` for tickets in a different way. Owner: the merge phase of the next unit; take the G12 path and update NEW-24 (R-03, R-05). The orchestrator can tell GROUP-13 that Unit 1 uses `src/web/components/badges/priority-dot.ts`.
- The Linux baseline fallback if colima cannot run the Playwright image on this 8 GB machine. Owner: the Unit 4 grill (R-24).
- The G12 ship time sets the start of Unit 4. Owner: the orchestrator (R-04).

## Units

### Unit 1: Inbox, Today, Ask, Activity, Flow and card action modules
- **Tickets:** LOCAL-74
- **Repos:** dispatch (1 PR)
- **Depends on:** origin/main merged in Phase 1 (R-02); the G12 Unit 1 branch merged before the card actions phase (R-03)
- **Delivers:** `modules/inbox`, `today`, `ask`, `activity`, `flow` and `card-actions` on shadcn primitives; shared `MultiSelect`, `MemberRow`, `FlowStage`, activity row, Markdown and `priority-dot.ts`; shared card mutations in `src/web/queries/cards-*`; the deletion of the six feature folders, `useItems`, `useAsk`, `usePastedImages`, `Kbd.tsx` and the legacy `MultiSelect`.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; the six modules have zero `style=` and zero hex; NEW-24 passes on `priority-dot.ts`; the five pages and each dialog opened from a board card render at 1440 px, 1024 px and 390 px in both themes; triage an inbox item through the menu (state, snooze, promote), page through Today, ask with a `#/ask/<prefill>` URL, expand an activity group, toggle flow narrow mode, start a card with a playbook, start a group with a generated title, clean up with force, reset, sync to Linear, create a local ticket with a pasted image: each sends the same request and shows the same 409 copy as the parity build; inbox keys j, k, Enter, e, s, o, u, a do the same actions; no board, inbox or global key fires while a dialog is open.
- **Spec artifacts:** none (no prototype, image or quoted copy). `design-contract.md` density, contrast and focus rules bind; the dataviz skill binds the flow diagram colours.
- **Execution:** `-full-subagent`, budget (six loosely coupled modules against the settled G12 module pattern)
- **PRD:** `dispatch/.planning/prds/g13-modules-b-unit-1.md` (12 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** the card actions phase waits on G12 Unit 1. Group start generation and ticket drafts spawn `claude -p`, so QA stubs them in the browser. The NEW-24 path change lands in this unit. Markdown may exist twice until the G12 merge.
- **Scope corrections:** placement by reader count (R-05); `cards-api.ts` and `cards-queries.ts` (R-07); unseen activity is local state (R-08); only `Kbd` is deleted (R-14); inbox menu keys (R-16); `MultiSelect` is a shared component, not a dialog part.

### Unit 2: Board module on dnd-kit
- **Tickets:** LOCAL-75
- **Repos:** dispatch (1 PR)
- **Carried from Unit 1:** the shared tier now holds `components/GroupCollapsible.tsx`, `ActivityRow.tsx`, `FlowStage.tsx`, `MemberRow.tsx`, `MultiSelect.tsx`, `components/ui/hooks/use-shortcuts.ts` and `src/web/queries/cards-*`; the Button cva base carries `cursor-pointer`; the legacy `hooks/useShortcuts.ts` treats any open Radix dialog as a modal and skips plain keys inside `[role=combobox]`, `[role=listbox]` and `[contenteditable=true]`; the dialog and alert-dialog `frame=modal` variant and project keyframes exist; the parity build at `/private/tmp/claude-501/g13-u1-base` was partly wiped by a tmp cleanup, so rebuild a parity tree per unit; R-25 to R-28 and the 2026-10-06 focus rows in changed-decisions.md (menus, popovers and Radix Selects return focus to the trigger; layered dismissal inside dialogs) apply to the board menus; a gate line that snapshots the tree fails the unit sweep (todo.md); G12 is on main at 3912003, so later merges take origin/main.
- **Depends on:** Unit 1 (shared card mutations, `MemberRow`, `priority-dot.ts`, the group start view)
- **Delivers:** `modules/board` with the drag context in a container, dnd mechanics in `components/dnd/`, Card identity as Card `cva` variants, shared `card-attention.ts`, `column-accent.ts`, `card-prs.ts` and `SINGLE_LINE_COPY`, the column widths on Resizable, the group start state in `App.tsx`, and the deletion of `features/board/` and its board-only hooks.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; NEW-19 checks `modules/board/`, NEW-22 and NEW-24 pass on the new paths, `FROZEN_COUNT` is 149; every board domain file has a test; at 1440 px in both themes the board shows all columns with a pinned, an attention and a selected card; at 1024 px and 390 px the `CAROUSEL_QUERY` behaviour matches the parity build (recorded first), touch drag moves a card and the selection bar sits above the safe area; a drop shows the card in the new column before the response, and a forced 409 snaps it back with no copy, as legacy; a drop on an agent-only column shows the refusal state; every `board-keys.ts` binding works; multi-select drag matches `drag-selection.ts`; the flip animation plays and respects reduced motion.
- **Spec artifacts:** none in the ticket; the card identity rules in `design-contract.md` bind.
- **Execution:** `-qa-subagent`, budget (Opus plans the drag container; debate panel review)
- **PRD:** `dispatch/.planning/prds/g13-modules-b-unit-2.md` (7 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** highest traffic surface. The optimistic path changes mechanism (cache, not local state) while the visible behaviour stays. The focus outline must stay distinct from the selection and attention rings. `useShortcuts` still needs `modalDepth` here.
- **Scope corrections:** shared placement of five domain pieces (R-05); 409 behaviour for single moves (R-10), group moves keep the legacy "Couldn't move N tickets" alert, compensation and one retry (U2-03); the move mutation drops its snapshot refetch (U2-02); per-column width handles stay, no Resizable (U2-10); `useTransitionNotifications` stays in `App.tsx` until Unit 4 (U2-19); `PRIORITY_DOT` already moved in Unit 1; seven new domain tests; group start state lifted (R-19).

### Unit 3: Detail panel, Sessions and Workspace modules
- **Tickets:** LOCAL-76
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 2; the newest committed G12 branch merged in Phase 1 (R-03)
- **Carried from Unit 2:** the board lives in `modules/board` and `features/board` is gone (`MemberRow` moved to `features/detail/MemberRow.tsx`); board moves write the shared TanStack cache optimistically and synchronously in `onMutate` (an awaited `cancelQueries` paints the card in its old column), and state shared between `onMutate` and `mutationFn` must not live in an options factory closure (useMutation swaps options per render); the group move is planned once in `BoardContainer` and an unmount abort still restores and compensates; Radix Popover and dialog focus rows dated 2026-10-06 cover search overlays; Playwright's fake clock replaces rAF, so timing gates use the real-frame probe (`qa-p4-extras.mjs`); PRD em dash gates use perl (BSD grep has no `-P`); the Unit 2 parity worktree `/private/tmp/claude-501/g13-u2-base` is at 9f5d67c; NEW-19 now scans `modules/board` and NEW-22 scans `src/shared` too.
- **Delivers:** `modules/detail` rendered once from the root layout with the terminal frame, `modules/sessions` and `modules/workspace`, detail-only queries in `modules/detail/queries/`, and the deletion of the three feature folders, `ActivityItem`, `FlowStage`, `FloatBar`, `useUnseenActivity`, `useCardComments`, `usePanelWidth`, `useResumeFeedback`, the legacy `MemberRow`, and each other primitive whose importers hit zero (R-18).
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes; `node scripts/panel-mount-92.mjs` passes; NEW-20 passes; at 1440 px in both themes open a card with a live session and go Board, Inbox, Sessions, Workspace and back: the iframe `src` and element never change and the shell keeps its scrollback; at 1024 px and 390 px in both themes the panel takes over the full width on the same element, the terminal accepts touch scroll and pinch zoom, and close returns focus as the parity build does; switch session, start another session, unwind a group, resume a lost session, post a comment and open a PR preview each send the same request with the same outcome; Sessions filter, select all and bulk confirm; Workspace expand and collapse groups, select a subgroup and open a card docked.
- **Spec artifacts:** none
- **Execution:** `-qa-subagent`, budget; the terminal frame phase runs no-budget (iframe sandbox and PANEL-03)
- **PRD:** `dispatch/.planning/prds/g13-modules-b-unit-3.md` (8 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** PANEL-03 is the top risk: no key, no portal, no new parent. The OrcaView auto-select can reopen the panel on a page change (G11 R-12 caveat). `panel-mount-92.mjs` has fixed ports (R-12). A live session for QA must not be a real `claude` session.
- **Scope corrections:** `CAROUSEL_QUERY` and no Sheet (R-11); `panel-mount-92.mjs` reads a `data-docked` attribute in place of the inline transform (U3-12); `SessionSwitcher` stays a ToggleGroup, not Select (U3-13); Workspace groups never collapse and its controls are three Selects (U3-19); `Spinner.tsx` stays for `App.tsx` (U3-21); the VS Code hex becomes a token (U3-15); docked mode line (R-11); Modal deletion is conditional (R-18); `PanelHeader.tsx` hex removed (R-23).

### Unit 4: Cutover, legacy deletion, global lint scope and screenshot suite
- **Tickets:** LOCAL-77
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 3; every G12 PR merged to main and origin/main merged into the branch (R-04)
- **Carried from Unit 3:** `modules/detail`, `modules/sessions` and `modules/workspace` exist and `features/detail`, `features/sessions`, `features/orca`, `FloatBar`, `ListRow` and `Modal.tsx` are gone; the detail panel is one `aside` rendered once from the root layout, and `checkPanelContract()` in `scripts/check-invariants.mjs` plus the `panelIdentityBan` lint selectors guard the iframe sandbox, `src`, `data-docked`, the storage keys, the shortcut checkbox rule and the dialog slots (keep them when the global lint scope lands); `panel-mount-92.mjs` still has no npm alias and is not in CI; the scoped data-slot base reset in `globals.css` now covers `a[data-slot]` (button-styled links read as buttons, CD:128), so the main app still runs without global preflight (U4-19); `useDialogClose` and `use-resume-feedback` live in `components/ui/hooks`; Radix roving focus moves menu focus in a setTimeout, so recorders settle 200 ms after an arrow key; harness `CLAUDE_CONFIG_DIR` breaks two account tests, so gates run with it unset (todo.md); the Unit 3 parity worktree `/private/tmp/claude-501/g13-u3-base` is at e4abea6; legacy-carried items for the cutover review are in todo.md 2026-10-07 (no Reconnect after a failed start, L2 unsafe link URLs, forward Tab trapped in the terminal iframe, hidden pinned load errors, Tickets link underline check).
- **Delivers:** deletion of `src/web/primitives/`, the rest of `src/web/features/` (`splash/` moves to `components/splash/`), `lib/api.ts`, the `AppState` context and the `App.tsx` state; zero `style={{`; lint rules on all of `src/web/**`; retired NEW-15, NEW-16, NEW-17 and NEW-19 with dated records; a Playwright screenshot suite in CI; docs that describe the module tree only.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes with the global lint scope; `npm run depcruise` reports zero orphans; `knip -production` is clean; `git grep -c "style={{" src/web` is 0; hex appears only in `tokens.css`, the `viewer.css` hl lines, `terminal.html`, `terminal-main.ts`, `manifest.json` and `favicon.svg`; `ls src/web/primitives src/web/features` fails and `ARCHITECTURE.md` cites no path under them; the Playwright suite passes locally and in CI, and a one pixel padding change on Board fails it (proven, then reverted); every route opens at 1440 px and 390 px in both themes with no console error; `panel-mount-92.mjs` passes; the gsd-ui-review report has no open blocker.
- **Spec artifacts:** none
- **Execution:** `-qa-subagent`, budget; the app store phase (first-of-its-kind pattern, U4-08) and the invariant retirement and `FROZEN_COUNT` phase (gate migration) run no-budget; debate panel review
- **PRD:** `dispatch/.planning/prds/g13-modules-b-unit-4.md` (9 phases)
- **Status:** built, awaiting /ship
- **Risk notes:** starts only after G12 ships. Linux screenshot baselines need a container (R-24). Deleting `AppState` touches every route file. NEW-20, NEW-22, NEW-24 and PANEL-03 stay.
- **Scope corrections:** six files already gone (R-23); `AppState` is replaced by one app store through the router context (U4-06); a retired invariant ID leaves `docs/ARCHITECTURE.md` and `FROZEN_COUNT` goes 149 to 145; Linux baselines from a dedicated colima profile at 2 CPU and 3 GiB; the main app stays without global preflight (U4-19); citation counts (R-22); `favicon.svg` in the hex allow list (R-23).

## Progress log

| Date | Unit | Outcome | Deviation from plan |
| - | - | - | - |
| 2026-10-01 | all | roadmap written, awaiting approval | none |
| 2026-10-01 | all | roadmap approved by Yash, R-01 to R-24 and architecture decisions 1 to 7 as written | none |
| 2026-10-01 | 1-4 | grilled (U1-01 to U1-28, U2-01 to U2-24, U3-01 to U3-26, U4-01 to U4-32) and PRDs written: 12, 7, 8 and 9 phases; coverage gate passes | Unit 4 has a second no-budget phase (app store, U4-08); R-10 refined for group moves (U2-03); R-09 refined by the new-tree shortcut hook (U1-28) |
| 2026-10-01 | 1 | execution started (roadmap-loop armed, budget tier, `-full-subagent`) | none |
| 2026-10-06 | 1 | built, awaiting /ship: 12 phases gate=pass, unit sweep clean after the Phase 2 snapshot-line re-gate, Phase 12 111/111 with network diff EMPTY, readiness ship with named risks (0 BUG; below-High rows accepted in todo.md) | Phase 12 fixed the Start discover-error parity (R4-03); 9 changed-decisions rows dated 2026-10-06 (focus return, layered dismissal, Radix Select and menu keyboard model, role=alert, B8, Phase 2 gate); R-25 to R-29 added mid-run by the orchestrator |
| 2026-10-06 | 2 | execution started on feat/LOCAL-75-unit-2-board, stacked on the Unit 1 tip 27c26d4 | none |
| 2026-10-06 | 2 | built, awaiting /ship: 7 phases gate=pass, unit sweep clean, Phase 7 88/88 with network diff EMPTY, readiness ship with named risks (0 BUG; Medium rows accepted in todo.md) | Phase 4 took 3 RED attempts (picker pointer open, search highlight, optimistic flash root cause, group plan map); Phase 6 fixed a stale-snapshot group re-plan (debate P1) and the selection prune on the optimistic write; PRD em dash gates moved to perl; about 25 changed-decisions rows dated 2026-10-06 |
| 2026-10-07 | 3 | built, awaiting /ship: 8 phases gate=pass, unit sweep clean, Phase 8 90/90 with network diff EMPTY and ui-case-1 68/68, readiness ship with named risks (0 BUG; 7 Medium rows accepted in todo.md) | Phase 8 RED once (G8 Reconnect evidence; Open in Linear link style fixed by the a[data-slot] reset, CD:128); Phase 7 unwind focus race fixed; Phase 3 and 5 RED rounds per R-26/R-28; about 30 changed-decisions rows dated 2026-10-06 and 2026-10-07 |
| 2026-10-07 | 4 | execution started on feat/LOCAL-77-unit-4-cutover, stacked on the Unit 3 tip b123523 | none |
| 2026-10-07 | 4 | built, awaiting /ship: 9 phases gate=pass, sweep phases 2 to 9 PASS on the merged tip and Phase 1 re-gated twice (one main timing flake in accounts-route.test.ts, todo.md), Phase 9 70/70 with network and copy diffs EMPTY, panel-mount-92 PASS, readiness ship with named risks (0 BUG; Medium rows in todo.md); commits f0b4ec9 and 118ee41 on 412d0ba, then origin/main 85cb149 merged as c8831a5 | Phase 8 page change fix reverted after panel-mount FAIL (CD:170); Linear preview gate reverted (CD:171); origin/main moved mid-unit, so handoff merges ran twice on every unit branch (CD:172); Linux baselines are arm64 (amd64 Chromium crashed under emulation) |
