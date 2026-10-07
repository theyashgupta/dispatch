# G13 Module Migrations B and Cutover Roadmap

Slug: `g13-modules-b`. Decision register: `.roadmap/g13-modules-b/decisions.md` (R-01 to R-24). Repo worktree: `dispatch/`, branch `GROUP-14`, base `8f2c59d` (`base/g13`, the G11 stack tip). origin/main is `46d060b`.

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


### Unit 2: Cutover, legacy deletion, global lint scope and screenshot suite
- **Tickets:** LOCAL-77
- **Repos:** dispatch (1 PR)
- **Depends on:** Unit 3; every G12 PR merged to main and origin/main merged into the branch (R-04)
- **Delivers:** deletion of `src/web/primitives/`, the rest of `src/web/features/` (`splash/` moves to `components/splash/`), `lib/api.ts`, the `AppState` context and the `App.tsx` state; zero `style={{`; lint rules on all of `src/web/**`; retired NEW-15, NEW-16, NEW-17 and NEW-19 with dated records; a Playwright screenshot suite in CI; docs that describe the module tree only.
- **Acceptance boundary:** `env -u NODE_ENV npm run check` passes with the global lint scope; `npm run depcruise` reports zero orphans; `knip -production` is clean; `git grep -c "style={{" src/web` is 0; hex appears only in `tokens.css`, the `viewer.css` hl lines, `terminal.html`, `terminal-main.ts`, `manifest.json` and `favicon.svg`; `ls src/web/primitives src/web/features` fails and `ARCHITECTURE.md` cites no path under them; the Playwright suite passes locally and in CI, and a one pixel padding change on Board fails it (proven, then reverted); every route opens at 1440 px and 390 px in both themes with no console error; `panel-mount-92.mjs` passes; the gsd-ui-review report has no open blocker.
- **Spec artifacts:** none
- **Execution:** `-qa-subagent`, budget; the app store phase (first-of-its-kind pattern, U4-08) and the invariant retirement and `FROZEN_COUNT` phase (gate migration) run no-budget; debate panel review
- **PRD:** `dispatch/.planning/prds/g13-modules-b-unit-2.md` (9 phases)
- **Status:** in progress
- **Risk notes:** starts only after G12 ships. Linux screenshot baselines need a container (R-24). Deleting `AppState` touches every route file. NEW-20, NEW-22, NEW-24 and PANEL-03 stay.
- **Scope corrections:** six files already gone (R-23); `AppState` is replaced by one app store through the router context (U4-06); a retired invariant ID leaves `docs/ARCHITECTURE.md` and `FROZEN_COUNT` goes 149 to 145; Linux baselines from a dedicated colima profile at 2 CPU and 3 GiB; the main app stays without global preflight (U4-19); citation counts (R-22); `favicon.svg` in the hex allow list (R-23).

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
- **Status:** not started
- **Risk notes:** PANEL-03 is the top risk: no key, no portal, no new parent. The OrcaView auto-select can reopen the panel on a page change (G11 R-12 caveat). `panel-mount-92.mjs` has fixed ports (R-12). A live session for QA must not be a real `claude` session.
- **Scope corrections:** `CAROUSEL_QUERY` and no Sheet (R-11); `panel-mount-92.mjs` reads a `data-docked` attribute in place of the inline transform (U3-12); `SessionSwitcher` stays a ToggleGroup, not Select (U3-13); Workspace groups never collapse and its controls are three Selects (U3-19); `Spinner.tsx` stays for `App.tsx` (U3-21); the VS Code hex becomes a token (U3-15); docked mode line (R-11); Modal deletion is conditional (R-18); `PanelHeader.tsx` hex removed (R-23).
