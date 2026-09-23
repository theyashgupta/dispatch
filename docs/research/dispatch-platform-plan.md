# Dispatch platform plan: from a board to a developer dispatcher

**Ticket:** LOCAL-22 (second deliverable)
**Companion:** `docs/research/fldsmdpr-analysis.md` (the source study; this plan does not repeat it)
**Dispatch baseline:** `main` at `3091c6a` (v3.6.3)

## 1. The decision

Dispatch today is one screen: a kanban board that turns a Linear ticket into a Claude Code session. The direction now is a **developer dispatcher**: one local app that collects everything a developer must act on (tickets, pull requests, Slack asks, errors, meetings, calendar), ranks it, and dispatches an agent from any of it. The board stays, as one view among many, reached from a persistent left sidebar.

This reverses one written decision. `docs/ARCHITECTURE.md`, section "App Shell Zones", records "The written non-goal: no persistent left sidebar" and states that `AppShell.tsx` mounts exactly one chrome container so a sidebar cannot appear without a structural change. That non-goal was correct for a single-board product. It is no longer the product. The first shell ticket below updates that section and `docs/standards/design-contract.md` so the reversal is recorded the same way the original decision was.

Everything else in the standards stays binding: inline styles plus `tokens.css`, no new styling technology, zero comments in `.tsx`, the layered import direction, the focus-ring rule, one shadow token, status colors only in `tokens.css`, the single-writer store, the exec chokepoint, and the bundle-budget ruling.

## 2. What fldsmdpr gets right that Dispatch will absorb

Short list. The mechanics are in the analysis document.

1. **One item shape for every source.** A row with `source`, `type`, `title`, `snippet`, `url`, `createdAt`, `priority`, `state` and a per-source metadata map. Every list, badge, filter and action works on that shape.
2. **Sidebar sections that are views over the same items**, filtered by source, plus cross-source views (Today, Inbox, Flow).
3. **Every item answers "what can I do about this now"**, and the best answer is an agent action. Dispatch already has the strongest agent runtime of the two; it lacks the surface area.
4. **Connection cards** with a setup guide, scopes, status and a privacy footer, plus toggle cards for sources that ride on the `claude` CLI.
5. **Keyboard-first**: a command palette with search, `j`/`k`, single-key actions, a cheat sheet.
6. **Cheap typed AI triage** to rank items, run only when content changes.

## 3. Dispatch today, in one paragraph each

**Frontend.** `src/web/App.tsx` holds the whole app state: a `viewMode` of `board` or `workspace` (the Orca view) persisted in `localStorage`, an `inboxOpen` flag that swaps the board for `InboxView`, a Settings screen with tabs, an Activity drawer, a first-run setup screen, and the modals (Start, Cleanup, Reset, Create ticket, Group start). `AppShell.tsx` has one chrome slot (`SyncStrip`) above `content` and `detail`. The strip is a three-column grid: identity, mode control, primary and utility clusters. Tokens live in `src/web/styles/tokens.css`: a dark 60/30/10 palette (`--bg`, `--surface-column`, `--surface-card`, `--border`, `--accent`, `--destructive`), an 8-point spacing scale, five chrome font sizes plus a markdown cap, three weights, a 3-value radius set, one shadow, per-column and per-priority colors, motion tokens, and three breakpoints (1600, 1023, 767). Hooks in `src/web/hooks/` own data: `useBoardStream` (one `EventSource` on `/api/stream` carrying `data` board frames, `activity` events and `tunnel` state, with a 15 s heartbeat), `useActivityFeed`, `useClaudeAccounts`, `useClaudeLogin`, `useTransitionNotifications`, `useUnseenActivity`, `useMediaQuery` (with `CAROUSEL_QUERY` at 1023 px), plus panel, column width and chrome height hooks. Primitives: Button, IconButton, Notice, Modal (compound), Field, Glyph, Markdown, Toast, Spinner, ActivityItem, and the modals that grew there. The detail panel is `features/detail/DetailPanel.tsx` with PanelHeader, SessionSwitcher, SessionLostSection, TerminalRegion (the iframe), PreviewRow, ReferenceBlocks, CardTimeline.

**Backend.** Express on loopback (default 4700), SQLite `board.db` with a single-writer `BoardStore`, one `TicketSource` (Linear) behind a registry, a self-rescheduling poller, a marker watcher, the start and cleanup sagas over tmux, git worktrees and ttyd, Claude accounts and usage, playbooks, archive, vault, push notifications, a Cloudflare tunnel for remote access, an update checker, and an SSE broadcaster. Route files: `accounts`, `archive`, `board`, `cards`, `events`, `hooks`, `images`, `playbooks`, `push`, `remote`, `setup`, `sse`, `terminal-proxy`, `update`, `vault`, `viewer`.

**What is missing for a dispatcher:** a light item entity for things that are not yet tickets, more than one source, a navigation shell, per-source pages, cross-source pages (Today, Ask, Flow), and a sessions view that is not tied to one card.

## 4. Information architecture

Sidebar, top to bottom. Sections are groups with a small label; each row is a page. Counts are unread badges.

```
DISPATCH                          (glyph + wordmark; collapses to glyph)
Search...                 Cmd+K   (opens the palette)

HOME
  Today
  Inbox                     12
  Ask

WORK
  Board
  Sessions                   2    (spinner while any session works)
  Activity

SOURCES                           (a row appears only when its source is enabled)
  Pull Requests              1
  Tickets                    4
  Slack                      3
  Errors                     1
  Meetings
  Calendar

SYSTEM
  Flow
  Accounts and Usage              (usage chip inline)
  Playbooks
  Workspaces
  Vault
  Archive

footer: sync status dot + last sync, active account chip, Settings, collapse
```

Overlays, not pages: command palette, keyboard cheat sheet, the detail panel (slides over any list page, same component the board uses), modals, toasts, the terminal region inside the detail panel.

Routing: hash routes (`#/board`, `#/inbox`, `#/sessions`, `#/tickets/LOCAL-22`), parsed by one `useRoute` hook, last route remembered in `localStorage` under the existing `dsp.` prefix. No router dependency: the bundle-budget ruling in `docs/standards/architecture.md` and the one-user scale do not justify one. Deep links matter for the remote tunnel and for push notifications, which is why hashes replace the current `viewMode` state.

Responsive: at or below 1023 px (the existing `CAROUSEL_QUERY`, where the board becomes a carousel and the detail panel takes over) the sidebar collapses to icons; below 768 px it becomes a top bar with a menu button that opens the same nav as a sheet. The detail panel is already full-width there.

## 5. Backend foundation the pages need

Two additions, both prerequisites for most pages below.

### 5.1 The `Item` entity

A `Card` is heavy: sessions, worktrees, ports, tokens. Most things a dispatcher shows are not work units yet: a PR asking for review, a Slack mention, a Sentry error, a meeting action item, a calendar event. They need a cheap row that can become a card on demand.

```
Item {
  id: string              // "<source>:<sourceKey>"
  source: "github" | "slack" | "sentry" | "meeting" | "calendar" | "linear" | "agent"
  type: string            // pr_review | mention | dm | incident | action_item | event | ticket | session_done
  title: string
  snippet: string
  url?: string
  createdAt: string       // ISO
  priority: number        // 0..100, connector base, AI override later
  state: "unread" | "read" | "snoozed" | "done"
  snoozedUntil?: string
  meta: Record<string, string>
  cardId?: string         // set once promoted to a Card
}
```

Rules copied from fldsmdpr's upsert, restated for Dispatch:

- one upsert per source poll; an existing row keeps `state`, `snoozedUntil` and `cardId`; `meta` is merged, connector keys overwrite, app keys survive;
- snapshot sources (GitHub, Sentry, Calendar, Linear) auto-mark missing rows done after a complete, successful fetch; append sources (Slack, Meetings) never do;
- `POST /api/items/:id/promote` creates a local card from the item (title, description from snippet plus meta, source link) and sets `cardId`. The card's `source` and a `sourceKey` are stamped so the two stay linked;
- items live in a new `items` table in `board.db`, written only through `BoardStore` so the single-writer rule holds; the SSE `data` frame on `/api/stream` (the `BoardSnapshot`) gains an `items` array with the same redaction discipline as cards, and `GET /api/board` returns the same shape.

Linear stays as it is: issues still become cards directly in the Inbox column. The Inbox page (section 6) shows both. Unifying Linear onto items is a possible later step, not part of this plan.

### 5.2 The multi-source registry

Ticket LOCAL-34 already scopes this: several `TicketSource` instances, one poll loop and cadence per source, snapshot versus append kinds, per-source id prefixes, a source badge and filter. This plan adds one thing to it: a source may produce **items** as well as, or instead of, **issues**. The contract becomes `fetch(): Promise<{ issues: SourceIssue[]; items: Item[]; truncated: boolean }>`.

## 6. Page catalogue

Twenty pages plus two overlays. For each: what it is for, what it shows, the data behind it, the new work, effort (S under two days, M under a week, L more), dependencies, and the fldsmdpr reference in the analysis document. Existing tickets are named where they cover part of the work.

### Home

**1. Today.** The morning screen. Greeting and date; a P0 card with the three to five items most in need of the user right now (sessions in Needs Input first, then urgent tickets, then review requests, then mentions), each with its context chips and its default action; per-source count chips that filter the list below; today's agenda from Calendar; a paged "top of your list". Data: cards in Needs Input and Agent Done, items ordered by priority, calendar items. New: `features/today/`, a `pickP0` pure function with tests, a `PageHeader` primitive. Effort M. Depends on 5.1. Reference: analysis 6.5 and screenshot `06-today.png`. Later: replace the fixed ranking with AI triage (page 13 in section 8 of the analysis).

**2. Inbox.** Everything new, across sources, in one list. Rows are items and Inbox-column cards, sorted by priority then time, with a source badge, chips, relative time and an unread dot. Toolbar: free text filter, source filter, time range (all, today, 3 days, week), unread only, group by source or type, mark all read. Row actions: promote to ticket, snooze (1 h, 4 h, tomorrow 9, next Monday), done, open, copy link, run agent. Selecting a row opens the detail panel. Data: `items` plus Inbox cards from the board stream. New: `features/inbox/` grows from the current Linear-only view; `useItems` hook; item routes (`GET /api/items`, `POST /api/items/:id/state`, `snooze`, `promote`). Effort M. Depends on 5.1, LOCAL-34.

**3. Ask.** Chat with Claude over the app's own data: the last 250 items and cards, session history, sync times, serialized as compact JSON lines and sent with the question through the existing `run-claude` runner with tools disabled. Suggestions as chips ("What needs me right now", "What did the agents finish this week"). "Ask about this" on any item lands here with the question prefilled. Data: read-only dump built server side. New: `features/ask/`, `POST /api/ask` (single flight, 180 s timeout, abort on disconnect, same fixed-flag discipline as `ticket-generate.ts`). Effort M. Depends on nothing but is more useful after sources exist. Reference: analysis 7, item 5.

### Work

**4. Board.** The existing kanban, unchanged in behavior, reached from the sidebar. The strip's mode control and Inbox toggle move out: mode becomes the Board and Sessions pages, Inbox becomes page 2. Column widths, density and drag rules stay. Effort S (routing only). Depends on the shell ticket.

**5. Sessions.** Every Claude session across every card, live and past, on one page: card identifier and title, playbook, account, started and ended, status (working, waiting, done, failed, lost), worktree, PRs and previews detected, last marker. Filters: live only, by account, by status. Row click opens the card's detail panel on that session. Bulk actions: cleanup selected, resume lost. This replaces the Orca "workspace" view as the place to see work in flight. Data: `card.sessions[]` from the board stream plus `claudeSessions` history. New: `features/sessions/`, a `flattenSessions` pure helper with tests. Effort M. Depends on the shell ticket. Reference: analysis 6.5 (Agents view) and screenshot pattern in `AgentsView.tsx`.

**6. Activity.** The activity drawer promoted to a page with the same `useActivityFeed` data: a timeline grouped by day, filterable by card, event type and source, with the existing `ActivityItem` primitive. The drawer stays for quick peeks. Effort S. Depends on the shell ticket.

### Sources

Each source page is one list of items filtered by `source`, with a page-specific detail section and page-specific actions. They share one `ItemList` feature component (toolbar, grouping, keyboard navigation, context menu) so a source page is mostly configuration.

**7. Pull Requests.** GitHub items: review requested, mentioned, assigned, plus PRs Dispatch already detects on session branches (`card.prs`). Detail: description, branch and base, additions and deletions, changed files with diffs on demand, CI checks with failing ones open, Approve, Request changes, Comment, Squash merge with confirm. Actions: Review with agent (the adversarial reviewer prompt idea: assume defects exist, verify every finding, rank by severity), Fix CI with agent. Data: a `github` source over the search API (`review-requested:@me`, `mentions:@me`, `assignee:@me`), a PR detail route. Token: `GITHUB_TOKEN` in the Vault, or reuse the `gh` CLI auth Dispatch already relies on. New: `sources/github/`, `features/pull-requests/`. Effort L. Depends on 5.1, LOCAL-34. Reference: analysis 2.5 and `connectors/github.rs` field list.

**8. Tickets.** The Linear list view: every Linear card on the board and every Linear item, grouped by status, priority, project, cycle or team, with the Linear state chip in Linear's color. Detail: description, comments, Move to, Assign to me, add comment, open in Linear. Actions: start session, promote. Data: existing Linear cards; LOCAL-23 to LOCAL-26 supply the outbound calls and the extra fields. New: `features/tickets/`. Effort S once those land. Depends on LOCAL-23 to LOCAL-26.

**9. Slack.** Mentions, DMs and, later, AI-flagged messages and the user's own unanswered asks. Pills: From X, You sent, Awaiting reply, DM, Mention, Thread. Detail: the message, channel, permalink, thread on demand. Actions: Draft reply with agent, promote to ticket, snooze. A summary card at the top (Today and Week tabs) comes later through a `claude` round. Data: the Slack source. New: `features/slack/`. Effort M for the page; the source is LOCAL-27 to LOCAL-29. Depends on those and 5.1.

**10. Errors.** Sentry unresolved issues, assigned first, then org wide, with level, project, event and user counts. Detail: exception, culprit, breadcrumbs, stack trace with in-app frames and source context, tags. Actions: Fix with agent (stack trace injected into the kickoff), Create ticket, Resolve in Sentry, snooze. Data: a `sentry` source over the org issues API and the latest-event route; `SENTRY_TOKEN` in the Vault. New: `sources/sentry/`, `features/errors/`. Effort M. Depends on 5.1, LOCAL-34. Reference: analysis 7 item 4 and `connectors/sentry.rs`.

**11. Meetings.** Action items from meetings, grouped by meeting, with the sibling items and a transcript on demand. Actions: promote to ticket, run agent, done. Two feeds: the paste flow (LOCAL-30) and the Granola round (LOCAL-31). New: `features/meetings/`. Effort S once the sources land. Depends on LOCAL-30, LOCAL-31, 5.1.

**12. Calendar.** The next 48 hours as an agenda with a Join button, meeting-soon highlighting, and a "prepare with agent" action that gathers the tickets and PRs mentioned in the event description. Data: a `calendar` source reading the macOS Calendar through `osascript` (JXA) with a calendar picker, or a secret iCal URL parsed server side. New: `sources/calendar/`, `features/calendar/`. Effort M. Depends on 5.1, LOCAL-34. Reference: analysis 5.2.

### System

**13. Flow.** A live diagram of how work reaches the user: sources on the left, the poller in the middle, then triage, then the four urgency trays (or the board columns), with counts on every node and a chip that travels along the edge when a new item lands. Built with one `FlowStage` primitive: a fixed-coordinate stage scaled by `ResizeObserver`, one SVG of cubic edges, HTML nodes, and CSS `offset-path` tokens. No graph library. Also reused for the session flow inside the detail panel (item, agent, worktree, result). Data: the board stream and items. New: `primitives/FlowStage.tsx`, `features/flow/`. Effort M. Depends on 5.1. Reference: analysis 6.5 and screenshot `07-flow.png`.

**14. Accounts and Usage.** The existing accounts UI as a page: each Claude account with its session and weekly windows, the pacing indicator (LOCAL-14), the active account switch, add and remove, login flow. Data: `GET /api/accounts`, `useClaudeAccounts`, `useClaudeLogin`. Effort S. Depends on the shell ticket.

**15. Playbooks.** Playbooks as a page instead of a modal in Settings: list, editor with preview, generate with Claude, set default, duplicate, delete with confirm. Data: `GET /api/playbooks`, `POST /api/playbooks`, `POST /api/playbooks/generate`. Effort S. Depends on the shell ticket.

**16. Workspaces.** Workspace folders and repos: discover, add, remove; per card worktrees with branch, disk usage and age; cleanup due dates; open in editor. Data: `GET /api/workspace-folders`, `GET /api/workspace-folders/discover`, `GET /api/fs/dirs`, card session fields. New: a `GET /api/workspaces` aggregate route. Effort M. Depends on the shell ticket.

**17. Vault.** The existing Vault UI (LOCAL-10, LOCAL-12) as a page: keys, purposes, filled state, rotate with previous value, search. Gains one thing: each key shows which source uses it. Data: `GET /api/vault`. Effort S. Depends on the shell ticket.

**18. Archive.** Archived groups and cards, restore, retention countdown. Data: `GET /api/archive`, `POST /api/archive/:id/restore`. Effort S. Depends on the shell ticket.

**19. Settings.** Reorganized as a page with a left tab rail: Connections (one connection card per source, LOCAL-32), Board (columns, cleanup delay, archive retention, Claude args), Appearance (density, terminal appearance, sound), Notifications (push, chime, which events), Remote access (tunnel, access code, QR), About you (name, handles, role, brief, used by triage and by "only mine"), Updates, About. Effort M. Depends on the shell ticket and LOCAL-32.

**20. Setup.** The first-run wizard extended into a source onboarding flow: one step per source reusing the connection cards, a progress bar, Next disabled until the connection validates, Skip this connection, and a small live map that lights up each connected source. Re-runnable from Settings and from the palette. Data: `GET /api/setup`, connection test routes per source. Effort M. Depends on LOCAL-32 and at least two sources. Reference: screenshots `01-onboarding.png`, `02-onboarding-github.png`.

### Overlays

**21. Command palette.** LOCAL-33 covers it: Cmd+K, commands and card search, arrow keys, Enter. This plan widens the search to items and adds "go to page" commands for every sidebar row.

**22. Keyboard cheat sheet.** `?` opens a three-column list of every binding, generated from the same table the shortcuts hook reads, so it cannot drift.

## 7. UI revamp

### 7.1 Shell

- `AppShell.tsx` gains a second chrome slot: `nav` (the sidebar) beside `content` and `detail`. The sidebar is 240 px, 56 px collapsed, state in `localStorage`. The active row indicator is one absolutely positioned element translated by row index, so switching pages does not re-render every row.
- The sync strip shrinks to a **page header** rendered by each page: title, count, page actions on the right. Sync status, the account chip and Settings move to the sidebar footer. New Ticket becomes a sidebar footer button and a palette command, and keeps its keyboard shortcut.
- The detail panel stays as it is (`features/detail/`), opened from any list page. The PANEL-03 no-remount rule for the terminal iframe is unchanged.
- Pages are `features/<page>/` folders with an `index.ts` barrel, kebab-case folder, PascalCase components, hooks in `src/web/hooks/`, helpers in `src/web/lib/`. No feature imports a sibling feature; shared pieces go to `primitives/`, `badges/`, `hooks/` or `lib/`.

### 7.2 Tokens and primitives

Additions to `tokens.css`, ratified in `design-contract.md` first:

- per-source colors `--src-github`, `--src-linear`, `--src-slack`, `--src-sentry`, `--src-meeting`, `--src-calendar`, `--src-agent`, consumed only through one `SOURCE_ACCENT` map in `features/badges/` (extends the NEW-24 single-source rule to sources);
- `--nav-width`, `--nav-width-collapsed`, `--page-header-height`;
- a fourth surface for pills and inputs, `--surface-inset`, if the contract agrees a fourth level is needed (fldsmdpr uses four);
- one new accent job, "active sidebar row", added to the accent role list in `design-contract.md`. The contract reserves the accent for a fixed list of jobs, so the addition is ratified there before any component uses it.

New primitives (presentational, props in): `PageHeader`, `SidebarNav` and `NavRow`, `Chip` (tones: neutral, accent, success, warning, danger, ai), `Kbd`, `Collapsible` (CSS grid-rows reveal, no measuring), `ListRow`, `SourceBadge` (in `badges/`), `FlowStage`, `ConnectionCard` (LOCAL-32). Each lands as a pure component with an existing consumer, following the primitives standard; no Storybook, no variant engine.

Theme: Dispatch stays dark. A light theme is not in this plan.

### 7.3 Motion and density

Reuse the existing motion tokens. Add one capped stagger for list entrance (22 ms per row, cap 12) and the existing reduced-motion block covers it. Density: the board keeps its scan density (NEW-19). List pages use the reading rhythm only inside the detail panel.

### 7.4 Keyboard

One `actions.ts` module in `lib/` with every item and card action (done, snooze, pin, open, copy link, promote, run agent, move to column) so the palette, the context menu, the detail panel and the shortcuts share one implementation and one undo behavior. Bindings: `j`/`k` rows, `h`/`l` columns on the board, `e` done, `s` snooze, `u` read toggle, `p` pin, `o` open, `a` ask, `Enter` open detail, `1`..`7` move to column, `Cmd+1`..`9` pages, `Cmd+K` palette, `Cmd+F` filter, `?` sheet. Keys are inert while typing in an input.

## 8. Execution groups

Thirty-one tickets (LOCAL-23 to LOCAL-53) in eight Dispatch groups. One group is one Dispatch group card, one shared session, one roadmap loop, one version and one squash PR. Tickets inside a group are listed in implementation order; a later ticket may depend on an earlier one. Ticket titles still carry the milestone labels from the first draft of this plan (v3.7 to v4.1); the groups below are the authoritative sequence.

| Group                    | Version | Tickets in order                                 | Depends on                             |
| ------------------------ | ------- | ------------------------------------------------ | -------------------------------------- |
| G1 Shell                 | v3.7    | LOCAL-36, LOCAL-35, LOCAL-41, LOCAL-37           | none                                   |
| G2 Foundation            | v3.8    | LOCAL-34, LOCAL-38, LOCAL-40, LOCAL-39, LOCAL-33 | G1                                     |
| G3 Linear                | v3.9    | LOCAL-26, LOCAL-24, LOCAL-25, LOCAL-23, LOCAL-42 | G1, G2                                 |
| G4 Settings and Setup    | v3.10   | LOCAL-32, LOCAL-43, LOCAL-44                     | G1, G3                                 |
| G5 GitHub, Sentry, Today | v4.0    | LOCAL-45, LOCAL-46, LOCAL-48                     | G2, G4                                 |
| G6 Slack                 | v4.1    | LOCAL-27, LOCAL-28, LOCAL-29, LOCAL-47           | G2, G4                                 |
| G7 Meetings and Calendar | v4.2    | LOCAL-30, LOCAL-31, LOCAL-49, LOCAL-50           | G2, G4                                 |
| G8 Intelligence          | v4.3    | LOCAL-51, LOCAL-52, LOCAL-53                     | G2 (G5 to G7 make Flow and Ask useful) |

G1 to G4 are strictly sequential. G5, G6, G7 and G8 are independent of each other once G4 has merged; they can run one after another or in parallel worktrees, each on its own version.

Per group, the loop is: select the group's tickets in To Do, create the group card with the PRD and Ralph Loop playbook, and in the session run `write-roadmap` over the group (units = the tickets in the order above, with the two grills), `write-prd` per unit, then `roadmap-loop`. The grills are the one human-present step per group; the loop then runs unattended, commits at unit boundaries, never pushes. `/ship` opens the version PR when the loop ends.

## 9. Tickets created for this plan

Created on the Dispatch board as LOCAL-35 to LOCAL-53, in the order below. Each carries scope, out of scope and acceptance.

| #   | Ticket                                                                                                  | Version | Effort |
| --- | ------------------------------------------------------------------------------------------------------- | ------- | ------ |
| 1   | Shell: sidebar navigation, hash routing and page header (replaces the strip mode control)               | 3.7     | L      |
| 2   | Shell: record the sidebar decision in ARCHITECTURE.md and design-contract.md, add nav and source tokens | 3.7     | S      |
| 3   | Pages: Accounts, Playbooks, Vault, Archive and Activity as sidebar pages                                | 3.7     | M      |
| 4   | Backend: Item entity, items table, item routes and SSE snapshot field                                   | 3.8     | M      |
| 5   | Sessions page: every session across cards, live and past, with filters and bulk actions                 | 3.8     | M      |
| 6   | Inbox page: items plus Inbox cards, toolbar, snooze, promote, keyboard rows                             | 3.8     | M      |
| 7   | Primitives: Chip, Kbd, Collapsible, ListRow, SourceBadge, PageHeader                                    | 3.8     | M      |
| 8   | Tickets page: Linear list view with grouping and inline actions                                         | 3.9     | S      |
| 9   | Settings page: tab rail, Connections, Board, Appearance, Notifications, Remote, About you               | 3.9     | M      |
| 10  | Setup flow: per-source onboarding steps with a live connection map                                      | 3.9     | M      |
| 11  | GitHub source and Pull Requests page with review actions                                                | 4.0     | L      |
| 12  | Sentry source and Errors page with stack trace context for the fix agent                                | 4.0     | M      |
| 13  | Slack page over the Slack source, with pills, thread and Draft reply                                    | 4.0     | M      |
| 14  | Today page: P0 picks, agenda, source counts, top of your list                                           | 4.0     | M      |
| 15  | Meetings page over the paste flow and the Granola round                                                 | 4.1     | S      |
| 16  | Calendar source and page with Join and prepare-with-agent                                               | 4.1     | M      |
| 17  | Ask page: chat over the local database through the Claude runner                                        | 4.1     | M      |
| 18  | Flow page and FlowStage primitive, reused for the session flow in the detail panel                      | 4.1     | M      |
| 19  | Workspaces page: folders, repos, worktrees, disk usage, cleanup due dates                               | 4.1     | M      |

Together with LOCAL-23 to LOCAL-34 from the analysis, the backlog is 31 tickets in the eight groups of section 8.

## 10. Risks and open decisions

- **Scope of the Item entity.** Keeping Linear on cards while other sources use items means the Inbox page merges two shapes. It is the smallest change that keeps the start saga untouched. Revisit only if the two-shape Inbox proves confusing in use.
- **Sources need credentials the org may block.** fldsmdpr's whole Slack design exists because its org blocks Slack apps. If that is true here too, the Slack pages wait; the GitHub and Sentry sources use personal tokens and are not blocked the same way.
- **The bundle budget.** Every page is lazy loaded (`React.lazy` at the route switch) so the board's cold start does not pay for pages the user has not opened. The budget script must gain a per-chunk line.
- **Mobile.** Every new page must pass the same 390 px check the strip does. List pages are naturally narrow; Flow is the exception and gets a "best on desktop" notice below 768 px.
- **Tests.** Every pure helper (ranking, flattening, routing, upsert rules) ships with a `node:test` file. Pages are smoke tested through the existing panel scripts pattern in `scripts/`.
