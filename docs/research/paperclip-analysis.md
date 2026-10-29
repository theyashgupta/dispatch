# Paperclip analysis: design tokens, UI patterns, orchestrator placement and org chart for Dispatch

**Ticket:** LOCAL-138
**Studied:** [paperclipai/paperclip](https://github.com/paperclipai/paperclip) at commit `854ab294cc82a40f5fbcaa2afaa13466b436e944` (2026-10-15). Cloned into a scratch folder and read as data. No Paperclip code was run.
**Dispatch baseline:** `LOCAL-138` branch at `f25154f9` (v4.5.4).
**Paths:** a Paperclip path is relative to the Paperclip repository root. To open one, add it to `https://github.com/paperclipai/paperclip/blob/854ab294cc82a40f5fbcaa2afaa13466b436e944/`. A Dispatch path is relative to this repository.
**Token names:** names such as `--status-task-done` are CSS custom property identifiers. The leading hyphens are part of the name.

## Summary

Paperclip is an open source control plane for teams of AI agents: a Node.js server, a Postgres database and a React UI. It models a company with an org chart, tasks, heartbeat runs, budgets and approvals. Dispatch is a local, single user board that runs one real Claude Code session per ticket. The products differ in model, but the UI problems are the same: show what is running, show what needs the human, and let the human steer.

The main recommendations:

1. **Orchestrator placement.** Remove the "Orchestrator" button from the board page header. Put the orchestrator in a **bottom dock** on every board page, with a **sidebar row** under the selected board and **command palette commands**. The phone form is a floating button above a new bottom bar. See section 4.
2. **Design tokens.** Dispatch is already token first for color and is stricter than Paperclip. Add a **session status vocabulary** and a **motion duration scale**, set a **spacing policy**, and add a **token gate script** for CSS and arbitrary values. A token first restyle is **M**. See section 2.
3. **Org chart.** Do **not** build an org chart page. Let a group tile in the command centre **expand in place** to show its units (S). Later, add a **Bands | Tree** view mode to the centre canvas for boards with more than one orchestrator (M). See section 5.
4. **Other features.** The two features with the most value for Dispatch are **ticket dependencies with auto start** and a **cost warning threshold**. See section 6.

**First step:** ticket 1 in section 10, "Orchestrator: sidebar row and palette commands, remove the board header button" (S).

**License:** MIT. Reuse is permitted if the copyright notice is kept. The ticket forbids copied code, so this report describes patterns only. Brand logos and the Inter font files carry their own terms. See section 7.

## 1. Architecture

### 1.1 Repository layout

- pnpm monorepo. `pnpm-workspace.yaml` lists `packages/*`, `packages/adapters/*`, `packages/plugins/*`, `server`, `ui` and `cli`.
- `server/` is Express 5 with `ws`, Drizzle ORM, better-auth and embedded Postgres (`server/package.json`). The code is large: `server/src/routes/issues.ts` has 19,631 lines and `server/src/services/heartbeat.ts` has 4,102 lines.
- `ui/` is a React 19 single page app built with Vite 8 and Tailwind 4 (`ui/package.json`).
- `cli/` is the npm package `paperclipai`. Its commands are in `cli/src/commands/` (onboard, run, doctor, worktree, routines, heartbeat-run, db-backup and others).
- `packages/db` holds the schema and migrations. `packages/shared` holds zod validators, constants and API types. `packages/adapters/*` holds one adapter per agent runtime (claude-local, codex-local, cursor-local, gemini-local, opencode-local and more).

### 1.2 Entry points

| Entry      | File                                                          | Notes                                                                                                                               |
| ---------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Server     | `server/src/index.ts`, app assembly `server/src/app.ts`       | Runs migrations, starts embedded Postgres when `DATABASE_URL` is not set, starts the heartbeat scheduler interval.                  |
| CLI        | `cli/src/index.ts`                                            | Built with esbuild.                                                                                                                 |
| UI         | `ui/index.html` loads `ui/src/main.tsx`                       | In development, Vite proxies `/api` to the server. In production, the server serves the built UI (`server/src/static-ui-cache.ts`). |
| Deployment | `packages/shared/src/constants.ts`, `doc/DEPLOYMENT-MODES.md` | Modes `local_trusted` and `authenticated`, exposure `private` or `public`.                                                          |

### 1.3 Data model

Postgres through Drizzle, one file per table group in `packages/db/src/schema/`. Every table carries `company_id`.

| Concept         | Schema file                                                                        | Key columns                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Company         | `companies.ts`, `company_memberships.ts`                                           | Tenant root.                                                                                                                                  |
| Agent and org   | `agents.ts`                                                                        | `reportsTo` (self reference, line 34), `role`, `adapterType`, `adapterConfig`, `budgetMonthlyCents`, `status`, `pausedAt`.                    |
| Task ("issue")  | `issues.ts` plus `issue_relations.ts`, `issue_tree_holds.ts`, `issue_watchdogs.ts` | `parentId` (task tree), `goalId`, `assigneeAgentId`, `checkoutRunId`, status backlog, todo, in_progress, in_review, done, blocked, cancelled. |
| Goal            | `goals.ts`                                                                         | `level` company, team, agent or task, `parentId`, `ownerAgentId`.                                                                             |
| Heartbeat run   | `heartbeat_runs.ts`, `heartbeat_run_events.ts`                                     | `agentId`, `issueId`, `invocationSource`, `status`, start and finish times.                                                                   |
| Wakeup          | `agent_wakeup_requests.ts`                                                         | `source`, `reason`, `coalescedCount`, `idempotencyKey`.                                                                                       |
| Approval        | `approvals.ts`                                                                     | Types `hire_agent`, `approve_ceo_strategy`, `budget_override_required`, `request_board_approval`.                                             |
| Budget and cost | `budget_policies.ts`, `budget_incidents.ts`, `cost_events.ts`                      | Policy per scope, `warnPercent` (default 80), `hardStopEnabled`.                                                                              |
| Activity        | `activity_log.ts`                                                                  | Actor attributed audit rows.                                                                                                                  |

### 1.4 How agents and work are represented

- An agent is a row in `agents` with an adapter. A local adapter starts the vendor CLI as a child process (`packages/adapters/claude-local/src/server/execute.ts`).
- Work runs as a **heartbeat**. A wakeup request goes into a queue, is coalesced, and becomes a `heartbeat_runs` row (`server/src/services/heartbeat/`). Wake sources are a timer, a task assignment, a comment, a resolved dependency, an approval and chat.
- A task **checkout** is an atomic claim: `POST /api/issues/:id/checkout` in `server/src/routes/issues.ts`. The claim fails with 409 when the project is paused or over budget.
- Each task can have an isolated git worktree (`server/src/services/execution-workspaces.ts`).

The contrast with Dispatch: a Paperclip agent wakes, works and sleeps. A Dispatch session is one long lived tmux session per ticket, watched by the supervisor pass.

### 1.5 API and realtime

- REST under `/api`. One router factory per resource in `server/src/routes/`, mounted in `server/src/app.ts`. Bodies are validated with zod schemas from `packages/shared`.
- Realtime is a WebSocket per company, `/api/companies/:id/events/ws` (`server/src/realtime/live-events-ws.ts`). There is no SSE. The UI turns events into react-query cache patches in `ui/src/context/LiveUpdatesProvider.tsx` and polls every 15 seconds when the socket is down. Dispatch uses SSE snapshots instead.

### 1.6 How the UI is built

| Concern          | Paperclip                                                                                                             | Dispatch                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Framework        | React 19, Vite 8                                                                                                      | React, Vite                                                     |
| Components       | shadcn "new-york" on `radix-ui` (`ui/components.json`, `ui/src/components/ui/`), plus cmdk, dnd-kit, xterm, MDXEditor | shadcn "new-york" (`components.json`, `src/web/components/ui/`) |
| Server state     | `@tanstack/react-query` v5, key factory `ui/src/lib/queryKeys.ts`                                                     | react-query with a query key factory per module                 |
| App state        | React context providers in `ui/src/context/` (Company, Sidebar, Dialog, Panel, Toast, Theme)                          | Module containers and hooks                                     |
| Routing          | react-router-dom 7, about 277 `<Route>` elements in `ui/src/App.tsx`                                                  | TanStack Router file routes (`src/web/routes/`)                 |
| Styling          | Tailwind 4, CSS first, tokens in `ui/src/index.css`                                                                   | Tailwind 4, tokens in `src/web/styles/tokens.css`               |
| Component review | Storybook 10 with 510 visual baselines                                                                                | Playwright snapshots and a gallery page                         |

## 2. Design token system

### 2.1 How Paperclip defines tokens

- **One source file:** `ui/src/index.css` (3,422 lines). `DESIGN.md` line 17 forbids a second token source. The only import is `ui/src/motion-tokens.css`. There is no Tailwind config file.
- **Three declaration blocks:**
  1. `@theme inline` (`index.css` lines 43 to 91) maps Tailwind names to variables only, for example `--color-background: var(--background)`.
  2. `:root` (lines 93 to 406) holds the values. Light is the default.
  3. `.dark` (lines 408 to 468) overrides the values that change in dark mode.
- **Why the split:** `@theme inline` bakes values in at build time. A value that must change at runtime (dark mode, a live tweak panel) must be in `:root` (`DESIGN.md` line 19).
- **Consumption:** utility classes on the bridge (`bg-primary`, `text-muted-foreground`), `cva` variants (`ui/src/components/ui/button.tsx` lines 7 to 40), Tailwind v4 parenthesis syntax for raw variables (`top-(--sz-calc-26)`), and one inline style that feeds the status chip recipe (`ui/src/components/StatusBadge.tsx` lines 14 to 16).

### 2.2 Paperclip token inventory

| Category        | Paperclip                                                                                                                                                                                                        | Reference                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Semantic color  | shadcn set in OKLCH: `--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar-*`. Neutrals have zero chroma.   | `index.css` 108 to 143, dark 418 to 430                               |
| Brand color     | Agent gradients `--agent-1a/1b` to `--agent-10a/10b` in hex. A script regenerates a TypeScript palette from them.                                                                                                | `index.css` 169 to 188                                                |
| Status color    | One hex hue per status. Agent: `--status-agent-idle`, `-running`, `-paused`, `-error`. Task: `--status-task-backlog` to `-cancelled` (7). A separate glyph set `--status-task-icon-*` is tuned for 3:1 contrast. | `index.css` 206 to 245, dark 462 to 467                               |
| Status recipe   | `.status-chip` reads one local hue `--sc` and derives fill, text and border with `color-mix`.                                                                                                                    | `index.css` 2482 to 2492                                              |
| Domain color    | Search match chips `--chip-match-*`, annotation highlights, dashboard run colors.                                                                                                                                | `index.css` 144 to 163                                                |
| Extraction debt | Value named tokens (`--hex-959596`, 154 `--sz-*`, 7 `--rad-*`, 15 `--shadow-extract-N`, 20 `--tp-*`) from a mechanical extraction run.                                                                           | `index.css` 2514 to 2934, `doc/design/DECISION-SHEET.md`              |
| Typography      | `--font-sans` InterVariable, `--font-mono` system stack. Size ladder `--text-nano` 10px, `--text-micro` 11px, `--text-compact` 13px. Tracking `--tracking-label`, `-eyebrow`, `-caps`. No weight tokens.         | `index.css` 44 to 45, 2579 to 2592                                    |
| Spacing         | Tailwind default `--spacing` plus 154 `--sz-*` extractions. The final scale is deferred (`DESIGN.md` principle 3).                                                                                               | `index.css` 2620 to 2629                                              |
| Radius          | One knob `--radius: 0.5rem`, multiplied for sm to 4xl.                                                                                                                                                           | `index.css` 78 to 90, 107                                             |
| Elevation       | No shadow scale. Tailwind default shadows plus a few named shadows. The shadow decision is open.                                                                                                                 | `index.css` 350, 359, 2788 to 2803                                    |
| Theme mode      | `.dark` class on `<html>`, `@custom-variant dark`. Two modes, stored in local storage. Pre-paint script in `ui/index.html`.                                                                                      | `index.css` 21, `ui/src/context/ThemeContext.tsx`                     |
| Motion          | Primitives `--motion-duration-instant` 80ms, `-fast` 160ms, `-base` 240ms, `-slow` 360ms, `-deliberate` 520ms and named curves. About 30 state tokens reference them. Reduced motion sets all durations to zero. | `ui/src/motion-tokens.css` 3 to 7, `index.css` 296 to 325, 939 to 956 |

**Enforcement:** `scripts/check-token-gates.mjs` scans components and pages for four classes: color literals, value arbitrary brackets such as `p-[13px]`, raw font sizes, and old `hsl(var())` wrappers. The allowlist lives in a comment block inside `index.css` and matches by path substring. Tailwind palette classes such as `bg-red-500` are **not** gated. A grep at this commit finds 3,819 of them in components and pages.

### 2.3 Dispatch tokens today

- `src/web/styles/tokens.css` holds the values. **Dark is the default.** `:root[data-theme="light"]` (line 191) overrides 32 names, mostly as `color-mix` of the dark hex value.
- `src/web/styles/globals.css` maps shadcn names to Dispatch names (`--background: var(--bg)`, `--primary: var(--accent)`). Its `@theme inline` block starts with `--color-*: initial` (line 73) and `--shadow-*: initial` (line 122). This removes the Tailwind default palette and shadows, so `bg-red-500` produces no CSS.
- Spacing is a named scale `--space-xs` to `--space-3xl` (4, 8, 12, 16, 24, 32, 48 px). Type is `--font-micro` to `--font-page-title` with `--weight-*` tokens. Radius is fixed px `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill`. Elevation is one `--shadow-float`. Motion durations are named by role (`--motion-hover`, `--motion-panel-open`) with `--easing-enter` and `--easing-exit`.
- Theme preference has three values (system, light, dark) in `src/shared/theme.ts`. `src/web/components/ui/hooks/use-theme.ts` sets `data-theme` and blocks transitions for two frames during a switch.
- **Enforcement:** `src/web/styles/tokens.test.ts` checks that each signal token is one hex in `:root`, that light values derive from it, that every `var()` read is declared, and that 70 contrast marks pass. `eslint.config.ts` bans hex literals and the JSX `style` prop in `src/web`. Invariant NEW-24 in `scripts/check-invariants.mjs` blocks status color literals.
- Primitives: `src/web/components/ui/badge.tsx` adds a `tone` axis (neutral, accent, success, warning, danger, state). `tone="state"` takes a runtime hue through `--badge-state`. This is the same mechanism as the Paperclip `.status-chip` recipe.

### 2.4 Mapping note

| Paperclip token or tier                           | Dispatch equivalent                                                 | Status                                  |
| ------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------- |
| `--background`, `--foreground`                    | `--bg`, `--text` (aliased in `globals.css`)                         | Renamed                                 |
| `--card`, `--popover`                             | `--surface-card`, `--popover`                                       | Renamed                                 |
| `--primary` (neutral gray)                        | `--primary` maps to `--accent` (indigo)                             | Same name, different value              |
| `--accent` (hover gray)                           | `--surface-card-hover`. Dispatch `--accent` is the brand indigo.    | Same name, different meaning            |
| `--muted`, `--muted-foreground`                   | `--surface-inset`, `--text-muted`                                   | Renamed                                 |
| `--destructive`                                   | `--destructive`, `--destructive-text`, `--destructive-button-fill`  | Same, Dispatch splits roles             |
| `--border`, `--input`, `--ring`                   | `--border`, `--border-strong`, `--accent`                           | Same or renamed                         |
| `--sidebar-*`                                     | `--sidebar-*`                                                       | Same                                    |
| `--chart-1..5`                                    | None                                                                | New, add only if charts ship            |
| OKLCH values                                      | Hex plus `color-mix(in srgb)`                                       | Different format, keep Dispatch         |
| `--agent-Na/Nb` gradients                         | None                                                                | Not needed                              |
| `--status-task-*` (7 workflow states)             | `--col-*` (7 column identities)                                     | Renamed, different vocabulary           |
| `--status-agent-*` (idle, running, paused, error) | `--status-ok`, `--status-stale`, `--status-down` (sync health only) | **New**: session status set             |
| `--status-task-icon-*` (3:1 glyph set)            | None                                                                | New, only if bare status glyphs ship    |
| `.status-chip` with `--sc`                        | Badge `tone="state"` with `--badge-state`                           | Same mechanism                          |
| `--chip-match-*`                                  | `--src-*` (source colors)                                           | Same tier, different content            |
| Priority colors (value named)                     | `--prio-urgent`, `-high`, `-medium`, `-low`                         | Dispatch is better                      |
| `--radius` with multiplied ladder                 | `--radius-sm`, `--radius`, `--radius-lg`, `--radius-pill`           | Different mechanism, keep Dispatch      |
| Named shadows and 15 extractions                  | `--shadow-float`                                                    | Dispatch is simpler                     |
| `--font-sans`, `--font-mono`                      | `--font-ui`, `--font-mono`                                          | Renamed or same                         |
| `--font-heading` (a family)                       | `--font-heading` (a 17px size)                                      | Same name, different meaning            |
| `--text-nano`, `-micro`, `-compact`               | `--font-micro`, `--font-label`, `--font-body`                       | Renamed                                 |
| `--tracking-label`, `-eyebrow`, `-caps`           | None (5 uses of `tracking-[0.04em]`)                                | **New**                                 |
| No weight tokens                                  | `--weight-regular`, `-medium`, `-semibold`                          | Dispatch only                           |
| `--sz-*` (154, value named)                       | `--space-xs` to `--space-3xl`                                       | Dispatch is better                      |
| `--motion-duration-instant` to `-deliberate`      | Role named `--motion-*`, no scale                                   | **New**: duration scale                 |
| Named curves `--motion-ease-*`                    | `--easing-enter`, `--easing-exit` (keywords only)                   | **New**: one or two curves              |
| Reduced motion at token level                     | One global rule stops all transitions                               | Keep Dispatch                           |
| `.dark` class                                     | `data-theme` attribute, three way preference, switch lock           | Dispatch is better                      |
| `check-token-gates.mjs`                           | ESLint bans, `tokens.test.ts`, NEW-24                               | Partial: CSS and brackets are not gated |

**New and worth adding:**

1. A **session status vocabulary**: running, idle, waiting for input, stopped, errored. Dispatch has columns, priorities and sync health, but no token set for the state of a live session. Paperclip principle 5 (`DESIGN.md`): one status set used the same way in a badge, a row, a chart and a log.
2. A **motion duration scale** (instant, fast, base, slow) and one named curve. The role tokens then reference the scale.
3. **Tracking tokens**, because uppercase eyebrow labels already use raw `tracking-[...]` values.
4. A **mono size role** for machine values (IDs, costs, times). Dispatch already has the rule "one step below adjacent text" in `docs/standards/design-contract.md`, but no token.

**Do not copy:** OKLCH, value named tokens (`--sz-*`, `--hex-*`, `--rad-*`, `--tp-*`), agent gradients, the multiplied radius ladder.

**Where Dispatch is already stronger:** the default palette is removed, hex is banned in all of `src/web`, contrast is measured by test, the spacing scale is named, and the theme switch has a lock.

### 2.5 What a token first restyle of Dispatch takes

Measured in `src/web` on this branch:

| Check                                               | Result                                                |
| --------------------------------------------------- | ----------------------------------------------------- |
| Hex in TS and TSX, tests excluded                   | 0                                                     |
| Hex in CSS outside `tokens.css`                     | 12, all `--hl-*` in `src/web/viewer/viewer.css`       |
| Tailwind palette classes                            | 0                                                     |
| JSX `style={{`                                      | 0                                                     |
| Arbitrary bracket values, variant brackets excluded | 189 (116 with a unit, 64 with `var()` or `color-mix`) |
| Numeric spacing utilities (`p-2`, `gap-1.5`)        | 1,152                                                 |
| Token spacing utilities (`p-(--space-sm)`)          | 288                                                   |
| Raw `ms` or `cubic-bezier` in TS and TSX            | 0                                                     |

Work items:

1. Move the 12 `viewer.css` highlight colors into `tokens.css`.
2. Set the spacing policy. **Recommended:** set Tailwind `--spacing` to the 4px base and accept numeric utilities as canonical, because `p-2` already equals `--space-sm`. The other path moves about 1,100 sites by codemod and makes the job L.
3. Add the session status vocabulary, the motion scale, tracking tokens and the mono size role. Each new color needs a light value, a contrast pair in `scripts/contrast-113.mjs` and a `tokens.test.ts` update (the test holds `SIGNAL_COUNT = 21`).
4. Move the 64 `var()` and `color-mix` brackets into named tokens or Badge tones.
5. Replace or allowlist the 116 unit brackets (`max-h-[...]`, `grid-cols-[...]`).
6. Add a token gate script for what ESLint does not cover: color literals in CSS, value brackets, raw font sizes, raw `ms` and `cubic-bezier`. Keep the allowlist next to the script and match exact paths.
7. Update `docs/standards/design-contract.md` with each new token.

**Estimate: M.** The color work is done. About 30 new tokens need tests. The spacing decision moves the estimate: S with the recommended path, L with a full migration. The Playwright snapshot coverage was not audited, so the visual risk is not measured.

## 3. UI patterns

Verdicts: **Borrow** has a follow-up ticket in section 10. **Later** is a good idea with no ticket now. **Skip** does not fit Dispatch.

| Pattern               | Paperclip reference                                                                   | What it is                                                                                                                                                                                                    | Verdict and where in Dispatch                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout shell          | `ui/src/components/Layout.tsx`, `ui/src/context/PanelContext.tsx`                     | Resizable sidebar that collapses to a rail, 60px breadcrumb bar, content, right properties panel that any page fills.                                                                                         | **Skip.** `src/web/modules/shell/components/ShellFrame.tsx` has the same skeleton. **Later:** hover peek on the collapsed rail (50ms open, 120ms close) for `AppSidebar.tsx`. |
| Sidebar rows          | `ui/src/components/SidebarNavItem.tsx`                                                | Row takes a count, an alert dot and a "N live" cluster. In the rail, the count becomes a dot and the label is spoken, for example "Dashboard, 3 live".                                                        | **Borrow.** Per board running count and spoken rail labels in `src/web/modules/shell/components/NavRow.tsx` and `SidebarBoards.tsx`. Ticket 9.                                |
| Organization switcher | `ui/src/components/SidebarCompanyMenu.tsx`                                            | Popover with avatar rows, reorder by drag, a retry row on load failure.                                                                                                                                       | **Skip.** The Boards section in `SidebarBoards.tsx` is stronger.                                                                                                              |
| Breadcrumbs           | `ui/src/components/BreadcrumbBar.tsx`                                                 | Pages register crumbs and a toolbar slot. Identifiers show in mono.                                                                                                                                           | **Skip.** Dispatch pages are flat. The mono identifier rule is already in place.                                                                                              |
| Mobile bottom nav     | `ui/src/components/MobileBottomNav.tsx`, `ui/src/hooks/useMobileNavVisibility.ts`     | 64px bar: Home, Tasks, New, Agents, Inbox. Hides on scroll down. Publishes a CSS variable so a docked composer clears it.                                                                                     | **Borrow.** Replace the hamburger only `TopBar.tsx` flow below 768px. Slots: Today, Inbox, New ticket, Board, Orchestrator. Ticket 3.                                         |
| Task list             | `ui/src/components/IssuesList.tsx`, `ui/src/lib/issue-filters.ts`                     | One persisted view state (group by, sort, list or kanban, columns). "Live only" filter. Rows render in windows of 50 then 100.                                                                                | **Later.** Persisted view state and a "live only" filter for `src/web/modules/tickets` and `src/web/modules/sessions`.                                                        |
| Agent list            | `ui/src/pages/Agents.tsx`                                                             | Filter tabs are routes. List and org chart toggle. Paused rows at 50 percent opacity.                                                                                                                         | **Later.** Tabs Needs you, Running, Stopped in `src/web/modules/sessions`.                                                                                                    |
| Inbox                 | `ui/src/pages/Inbox.tsx`, `ui/src/lib/inbox.ts`                                       | Tabs Mine, Recent, Unread, Blocked, All. Date separators. Persisted group collapse. Swipe to archive.                                                                                                         | **Later.** Date separators for `src/web/modules/inbox`. Skip swipe, Dispatch has row keys.                                                                                    |
| Task detail           | `ui/src/pages/IssueDetail.tsx`, `ui/src/components/StatusIcon.tsx`                    | Status glyph opens a picker. Sub task strip "3/3 done, 0 in progress, 0 blocked" with a bar. Right properties panel with label left, value right rows.                                                        | **Later.** Sub task strip for group cards in `src/web/modules/detail/views/DetailPanelView.tsx`.                                                                              |
| Empty states          | `ui/src/components/EmptyState.tsx`                                                    | Icon, title, message, one primary action. A filtered empty uses a different message and no onboarding action.                                                                                                 | **Skip** the component, `src/web/components/ui/empty.tsx` exists. Keep the rule: a filtered empty never shows the onboarding action.                                          |
| Status chips          | `ui/src/components/StatusBadge.tsx`, `StatusGlyph.tsx`, `ui/src/lib/status-colors.ts` | A status names one base hue. The chip derives fill, text and border. Workflow status and run liveness are separate: liveness shows as a pulsing agent capsule.                                                | **Borrow** the vocabulary and the liveness split through tokens (ticket 4). Skip the generic `StatusBadge`, it uses raw hex classes.                                          |
| Dashboard             | `ui/src/pages/Dashboard.tsx`, `ui/src/components/ActiveAgentsPanel.tsx`               | Pause banner, up to four live run cards with the last transcript lines, metric cards, charts.                                                                                                                 | **Skip.** The Dispatch project map is richer. **Later:** a one line "last output" on running tiles in the centre.                                                             |
| Task conversation     | `ui/src/components/IssueChatThread.tsx`, `ScrollToBottom.tsx`                         | Composer docked at the bottom, "Jump to latest", a "Queued" chip with Interrupt and Cancel for a message sent while the agent works, a stop menu on the live run.                                             | **Borrow** the Queued state in `src/web/modules/orchestrator/components/CommentBox.tsx` and `ConversationList.tsx`. Ticket 8.                                                 |
| Approvals, decisions  | `ui/src/pages/Approvals.tsx`, `ui/src/pages/WhatNeedsMe.tsx`                          | Items group, filter and show age.                                                                                                                                                                             | **Skip.** Dispatch decision items cover this.                                                                                                                                 |
| Command palette       | `ui/src/components/CommandPalette.tsx`, `ui/src/hooks/useKeyboardShortcuts.ts`        | Cmd+K. Groups Search, Quick filters, Projects, Actions, Pages, Tasks, Agents. Keys `/`, `?`, `c`, `[`, `]`, `g i`.                                                                                            | **Borrow** for orchestrator commands in `src/web/modules/shell/domain/commands.ts`. Ticket 1.                                                                                 |
| Toasts                | `ui/src/context/ToastContext.tsx`, policy in `doc/TOASTS.md`                          | Dedupe key, time to live, undo action. The policy: a run start or success never toasts, a failure older than 5 minutes stays quiet, a reconnect replay is suppressed, a hidden tab does not replay a backlog. | **Borrow** the policy, not the widget. Audit `src/web/modules/shell/hooks/use-transition-notifications.ts`. Ticket 10.                                                        |
| Live run indicators   | `ui/src/components/LiveRunWidget.tsx`, `AgentStatusCapsule`                           | Live runs panel with Cancel, polled every 3 seconds only while the tab is visible. Capsule pulses while running.                                                                                              | **Borrow** with ticket 9 (per board count) and ticket 4 (running marker).                                                                                                     |

**Screenshots.** This report uses file references only. No image was copied (see section 8, question 1). The useful screenshots in the Paperclip repository:

- `screenshots/PR-8000-home-flag-on.png`: dark dashboard at 1440 by 900 with the sidebar, four live agent cards, metrics and charts.
- `screenshots/PR-8000-conference-room-flag-on.png`: the CEO chat page, chat on the left with a docked composer, "Agent Feed" on the right.
- `screenshots/PR-8000-task-thread-flag-on.png`: task detail with breadcrumb, sub task strip and properties panel.
- `screenshots/PAP-10535-live-run-menu-after.png`: the live run menu (Stop run, Stop and cancel, Stop and done, View run).
- `docs/pr-screenshots/pr-6384/inbox-rows-desktop.png`: list, filter and run ledger states.

There is no screenshot of the org chart or the command palette. The set `doc/assets/pap-2189/*` shows a Storybook error page and has no value.

## 4. Orchestrator placement

### 4.1 How Paperclip exposes its control surface

- The human is "the Board" (`doc/SPEC.md`, Board Governance). The board can set budgets, pause any agent, approve, reject and override. `doc/SPEC.md` lists "Board Controls (Available Everywhere)", but the UI spreads them over pages.
- The CEO is an ordinary agent with `role` "ceo". The board approves the CEO strategy and every hire.
- Where the human acts: Approvals (`ui/src/pages/Approvals.tsx`), Inbox (`ui/src/pages/Inbox.tsx`, red badge on failed runs), Decisions (`ui/src/pages/WhatNeedsMe.tsx`), the Conference Room (`ui/src/pages/BoardChat.tsx`, behind a flag) and per agent chat (`ui/src/pages/AgentChat.tsx`).
- The Conference Room is a full page: CEO chat on the left, live agent feed on the right, a composer docked at the bottom. On a phone, the feed is a bottom sheet opened by a floating round button.
- Paperclip has **no persistent dock** and **no top bar chat entry**. The only floating control is that phone button.

### 4.2 How Dispatch exposes the orchestrator today

- `src/web/routes/__root.tsx` (`PAGE_HEADER_VIEWS.board`, line 72) mounts `src/web/modules/orchestrator/views/OrchestratorEntryView.tsx`. It puts `src/web/modules/orchestrator/components/EntryButton.tsx` into the board page header. The button reads "Orchestrator", or "Add orchestrator" when the board has none, and opens `/boards/$key/orchestrator`. **This is the top bar entry that the user does not want.** It shows on the board page only.
- Other entries: an "Open command centre" link in `src/web/modules/dashboard/containers/HeaderStripContainer.tsx`. There is no sidebar row, no palette command and no global key. The global keys in `src/shared/shortcuts.ts` are Cmd+K, `n`, `?` and `b`.
- **Effect:** when an orchestrator needs the user, a user on Tickets, Sessions or Inbox cannot see or answer the conversation without going to the board page first.

### 4.3 Options

| Option            | Assessment                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Bottom dock       | Always reachable and can hold the conversation. Uses vertical space. Needs a phone form. **Primary.**             |
| Right dock        | The right edge belongs to the detail panel, which has Escape order rules. **Reject.**                             |
| Per board node    | Already exists on the centre canvas (`CentreCanvas.tsx`). A destination, not an entry, because it is on one page. |
| Palette action    | Near zero cost. Cannot show attention. **Add as a complement.**                                                   |
| Sidebar row       | Always visible, has a badge, collapses to an icon. Navigates but does not converse. **Secondary.**                |
| Floating launcher | On a desktop it covers cards and the terminal toolbar. **Use only as the phone form of the dock.**                |

### 4.4 Recommendation

- **Primary: a bottom dock** for the main orchestrator of the selected board. It sits across the content area, between the sidebar and the detail panel. It shows on every board scoped page. It does not show on the centre page (that page has the same pane) or on a board with no orchestrator. It reuses `CentrePaneContainer`, `ConversationList` and `CommentBox`. Frontend rule 8 forbids a sibling module import, so `src/web/routes/__root.tsx` or a shared layout component composes it.
- **Secondary: a sidebar row** under the selected board in `SidebarBoards.tsx`. It shows "Orchestrator" with the state glyph and the needs you count, or a muted "Add orchestrator" when the board has none. This is the only entry on a board with no orchestrator.
- **Palette commands:** "Open orchestrator", "Message orchestrator", "Start orchestrator".
- **Shortcut:** `m` focuses the dock field. `m` is free in the global set. Check page scoped keys before adoption.
- **Reasons:** the user can answer a stopped loop on the page where they already are. The sidebar row shows attention when the dock is collapsed. The header button goes away.

### 4.5 Wireframe

The dock has three states.

- **Collapsed** (44px): a one row strip at the bottom of the content area. Left to right: the state glyph and label, the last orchestrator message on one line, the message field, and an "Open" control.
- **Expanded** (40 percent of height, minimum 280px, resizable): the strip grows up. At 1280px and wider it pushes the page up. Below 1280px it overlays as a sheet. The header shows the board key, state, context percent and cost, with "Open centre" and "Settings". The conversation and the message field fill the body.
- **Needs attention** (72px): the strip takes the state tone of `ToneBadge`, never the accent. It shows the question and its option buttons in the outline variant, so the user answers without expanding. A line shows how long the question has waited.
- **Phone** (below 768px): a round button above the bottom bar of ticket 3. It opens a bottom sheet with the same conversation.
- Escape closes the dock before the detail panel.

```
COLLAPSED (44px)
┌──────────┬────────────────────────────────────────────────┐
│ sidebar  │  page content (board, tickets, sessions ...)   │
│          ├────────────────────────────────────────────────┤
│ Boards   │ (o) Working  "Unit 2 of 3 started on GROUP-14" │
│  CEN     │ [ Message the orchestrator           ]  Open ^ │
│  Orch. o │                                                │
└──────────┴────────────────────────────────────────────────┘

EXPANDED (40 percent)
┌──────────┬────────────────────────────────────────────────┐
│ sidebar  │  page content, pushed up                       │
│          ├────────────────────────────────────────────────┤
│          │ Orchestrator CEN  (o) Working  ctx 38%  $4.10  │
│          │ [Open centre] [Settings]          [Collapse v] │
│          │ You, 5m ago: split GROUP-14 in two             │
│          │ Orchestrator: planned 2 groups, approve?       │
│          │ [ Message the orchestrator         ]  [Send]   │
└──────────┴────────────────────────────────────────────────┘

NEEDS ATTENTION (72px)
┌──────────┬────────────────────────────────────────────────┐
│ sidebar  │  page content                                  │
│          ├────────────────────────────────────────────────┤
│ Boards   │ (!) Needs you (2)  GROUP-14: approve the plan? │
│  CEN  2  │ [Approve the plan] [Do not approve] [Reply]    │
│  Orch. 2 │ Waiting 34 min                                 │
└──────────┴────────────────────────────────────────────────┘
```

## 5. Org chart

### 5.1 How Paperclip builds it

- **Data model:** `agents.reportsTo` is a nullable self reference (`packages/db/src/schema/agents.ts` line 34) with the index `agents_company_reports_to_idx`. A null value makes a root. More than one root is allowed.
- **Tree builder:** `orgForCompany` in `server/src/services/agents.ts` (line 206). It drops terminated agents, groups rows by manager, and turns an orphan into a root. `GET /companies/:companyId/org` returns lean nodes `{id, name, role, status, reports}`.
- **Integrity:** `assertNoCycle` and `ensureManager` run on each `reportsTo` change (`server/src/services/agent-configuration.ts`). `getChainOfCommand` walks up to 50 managers. An agent with an invalid chain cannot run.
- **Export:** `server/src/routes/org-chart-svg.ts` renders the chart as SVG or PNG in five styles for a company README.

### 5.2 Layout and interactions

- `ui/src/pages/OrgChart.tsx` (673 lines) uses **no chart library**. A custom subtree width pass places fixed 200 by 100px cards, 32px apart, with 80px between levels. Parents are centred over their children. Edges are SVG elbow paths.
- Pan and zoom are hand written: drag, wheel zoom to the pointer, pinch, Fit, zoom limits 0.2 to 2.
- A card shows an avatar with a status dot, name, role, adapter in mono and two lines of capabilities. Status is a color dot only.
- A click opens the agent. There is no drag to reparent, no hire button, no subtree collapse and no keyboard navigation. The manager changes in the agent form.
- **Placement:** with the streamlined UI flag on, `/org` redirects to `/agents/all` (`ui/src/App.tsx` line 285), and the chart is a view toggle next to the agent list. Paperclip's own redesign made the chart a **view mode, not a page**.

### 5.3 What it is for

The reporting line is a delegation and escalation structure, not access control (`doc/SPEC.md`: every agent sees the whole org). It decides who can take a task, who a blocked agent escalates to, and who may be hired under whom. The chart is the human's map of that structure, with live status.

### 5.4 Should Dispatch render an org chart?

**Recommendation: no separate org chart. Use the command centre canvas.**

Reasons:

1. **Dispatch structure is data, not governance.** It comes from `ownerOrchestrator` on a group card, `memberIds` on a group and `loopProgress.units` on a loop (`src/shared/types.ts`). Nobody reports to anybody. No chain can be invalid. The supervisor escalates, not a manager.
2. **The centre already draws the tree.** `src/web/modules/orchestrator/domain/centre-graph.ts` builds the orchestrator node, the bands and the edges. `CentreEdges.tsx` draws them. The dashboard already shows units as a milestone track (`src/web/modules/dashboard/components/GroupProgressBar.tsx`).
3. **One structure for keyboard, screen reader and phone.** The centre research (`docs/research/orchestration-centre-research.md`, F-4 and F-5) fixed the bands list as the phone and keyboard order. A tree does not fit 390px.
4. **The graph is small.** A board has at most 10 loops and a few dozen tiles, so Paperclip's pan and zoom code is not needed.

What to build:

- **Step 1 (S):** a group tile in the centre expands in place to show its units (the milestone track nodes) and member tickets. This gives the orchestrator, group, unit, loop reading with no new surface.
- **Step 2 (M), later:** a "Bands | Tree" toggle in `CentreToolbar.tsx`, shown only when a board has more than one orchestrator. Tree mode places the main orchestrator, the extra orchestrators, then the groups each one owns, with units collapsed under each group. A pure layout function with tests, the existing `CentreEdges.tsx`, tiles as focusable buttons in tree order, and `SessionStateBadge` (glyph and label) instead of a color dot.

What it replaces: nothing. It sits beside the Bands view (default) and the dashboard "Progress per group". The Settings sheet "Orchestrators" table stays the place to change ownership.

Not now: drag to reparent (ownership moves need a confirmation design and a guard for running loops), SVG export, persisted collapse state. These would make it L.

## 6. Other features, ranked

Ranked by value to Dispatch. The rank takes into account what Dispatch already has: decision items (`routes/decisions.route.ts`), orchestration events written by the supervisor (`src/server/services/orchestration/supervisor-record.ts`), group costs and a budget stop in the supervisor pass.

| Rank | Feature                                 | Paperclip reference                                                     | One line for Dispatch                                                                                                  |
| ---- | --------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1    | Task dependencies with auto wake        | `issue_relations.ts`, `server/src/services/issue-dependency-wakeups.ts` | A ticket says "blocked by" another ticket and starts when the blocker reaches Done. Ticket 11.                         |
| 2    | Budget warning threshold                | `budget_policies.ts` (`warnPercent` 80), `ui/src/pages/Costs.tsx`       | Warn at a percent of the budget before the hard stop, and roll cost up per group. Ticket 12.                           |
| 3    | Bounded recovery actions                | `doc/TASK-WATCHDOG.md`, `issue_recovery_actions.ts`                     | When the supervisor gives up, show named recovery actions on the card instead of a plain Needs input.                  |
| 4    | Tree holds                              | `issue_tree_holds.ts`, `server/src/routes/issue-tree-control.ts`        | Pause a whole group with one action, and resume it.                                                                    |
| 5    | Activity timeline with actor and reason | `activity_log.ts`, `ui/src/pages/audit`                                 | Show the supervisor and orchestrator events that Dispatch already records as a timeline on the card and in the centre. |
| 6    | Routines                                | `routines.ts`, `ui/src/pages/Routines.tsx`                              | Recurring cards (weekly triage, dependency bumps) through the existing start saga.                                     |
| 7    | Full text search                        | `doc/SEARCH.md`, `server/src/services/company-search.ts`                | Search titles, notes and loop reports across boards.                                                                   |
| 8    | Work products on tasks                  | `issue_work_products.ts`, `doc/html-artifact-previews.md`               | Show the PR, preview URL and plan document as artifacts on a card.                                                     |
| 9    | Skill versions and test inputs          | `ui/src/pages/SkillStudio.tsx`, `packages/skills-catalog`               | Version playbooks and keep a sample input per playbook.                                                                |
| 10   | Ask first tool policies                 | `doc/MCP-ACCESS-GOVERNANCE.md`, `server/src/routes/tool-gateway.ts`     | Per tool Allowed, Ask first or Off. Dispatch runs plain `claude` with the user's own MCP setup, so the value is low.   |
| 11   | Goals hierarchy                         | `goals.ts`, `ui/src/pages/Goals.tsx`                                    | A layer above groups. A single user rarely needs it.                                                                   |
| 12   | Heartbeat wakeups                       | `agent_wakeup_requests.ts`, `server/src/services/heartbeat/`            | Dispatch sessions live long. Only the coalescing idea is useful.                                                       |
| 13   | Agent and board chat                    | `ui/src/pages/AgentChat.tsx`, `BoardChat.tsx`                           | The real terminal is the Dispatch surface. The dock covers the orchestrator.                                           |
| 14   | Chat channels (Slack, Discord, email)   | `server/src/routes/chat-channels.ts`                                    | Dispatch has a Slack source and push notifications.                                                                    |
| 15   | Company import and export               | `server/src/services/company-portability.ts`                            | Low. Board and playbook export could reuse the idea.                                                                   |
| 16   | Plugin system                           | `packages/plugins/sdk`, `doc/plugins/PLUGIN_SPEC.md`                    | Heavy. Revisit only if third party sources multiply.                                                                   |
| 17   | Secrets with versions                   | `company_secrets.ts`, `server/src/secrets/`                             | Dispatch has the vault. Single user.                                                                                   |
| 18   | Multi user, invites, access             | `ui/src/pages/CompanyAccess.tsx`, `server/src/routes/access.ts`         | Not for a local single user app.                                                                                       |
| 19   | Cloud sandbox runners                   | `packages/plugins/sandbox-providers/*`                                  | The global rule is local loops only.                                                                                   |
| 20   | Pipelines, cases, decision queues       | `pipelines.ts`, `cases.ts`, `decision_queues.ts`                        | Domain specific to Paperclip.                                                                                          |

Ranks 3 to 10 are "Later": no ticket now. Each one needs a short check against the current supervisor before it gets a ticket.

## 7. License and reuse limits

- **Root license:** MIT, "Copyright (c) 2025 Paperclip AI" (`LICENSE`). `README.md` says "MIT (c) 2026 Paperclip Labs, Inc". The holder names differ. Treat both names as the copyright holder in any notice.
- **Packages:** every `package.json` license field is MIT (`server`, `ui`, `cli`, all `packages/*`, all adapters). Private examples and fixtures have no field, so the root MIT applies.
- **No NOTICE file** at the root or in `server`, `ui` or `cli`. No GPL, AGPL, BUSL or source available text was found. `doc/LOW-TRUST-PRESETS.md` mentions a "Community Edition", but no enterprise code or license is in the repository.
- **Third party assets with their own terms:**
  - Inter font (`ui/public/fonts/InterVariable*.woff2`): SIL Open Font License 1.1 (`ui/public/fonts/NOTICE.md`). Dispatch already uses Inter from its own source.
  - Brand icons (`ui/public/brands/adapters/*.svg`): Lobe Icons, MIT, Copyright 2023 LobeHub. The logos are trademarks of their owners. MIT does not grant trademark rights.
  - `packages/shared/src/cliplab/`: MIT with separate holders (`PROVENANCE.md`).
- **Paperclip name and art:** no trademark policy exists. Do not use the Paperclip name, logo or banner art in Dispatch.

**Reuse rules for Dispatch:**

1. MIT permits copy and change of code if the copyright and permission notice stays with the copy. **This ticket forbids copied code.** Follow-up tickets also take ideas only. If a later ticket wants to copy a file, it must add the MIT notice to `docs/licenses/` and name the source file.
2. Token **values** (hex and OKLCH numbers) are MIT code. Do not copy them. Dispatch keeps its own palette. Token **names** and the tier structure are ideas and are free to use.
3. Do not copy brand SVGs, the Inter files from Paperclip, or Paperclip artwork.
4. The screenshots in the Paperclip repository are MIT, but this report does not copy them.

## 8. Questions and answers taken

The loop ran with no interactive prompts. Each question below took the recommended answer.

1. **Copy Paperclip screenshots into `docs/research/paperclip/`?** No. File references only. This keeps third party marks out of the repository and the diff to one file.
2. **Run Dispatch to capture comparison screens?** No. The comparison uses file references. No port was used.
3. **Run Paperclip to see its UI?** No. The ticket direction says to run nothing from the clone.
4. **Primary orchestrator placement?** Bottom dock, with a sidebar row and palette commands as secondary entries.
5. **Spacing policy for the restyle?** Accept numeric Tailwind utilities on a 4px base. This keeps the restyle at M instead of L.
6. **Org chart as a page or a view?** A view mode of the command centre canvas, in two steps.
7. **Which "Later" items get tickets now?** None. Only the Borrow verdicts and the top two features get tickets, to keep the proposal small.
8. **Shortcut for the dock?** `m`, subject to a collision check in ticket 2.

## 9. Ranked implementation order

| Order | Ticket                                                                            | Estimate | Why in this position                                                                        |
| ----- | --------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------- |
| 1     | 1. Orchestrator: sidebar row and palette commands, remove the board header button | S        | **First step.** Removes the top bar entry the user does not want, with a replacement entry. |
| 2     | 2. Orchestrator: bottom dock                                                      | M        | The main placement change. Needs ticket 1 for the no orchestrator entry.                    |
| 3     | 8. Orchestrator conversation: Queued state                                        | S        | The dock makes messages during work more frequent.                                          |
| 4     | 9. Sidebar: per board live count and spoken rail labels                           | S        | Small, and it supports the sidebar row of ticket 1.                                         |
| 5     | 6. Command centre: group tile expands to show units                               | S        | The org chart answer, at low cost.                                                          |
| 6     | 5. Tokens: spacing policy and token gate script                                   | S        | Locks the token rules before new tokens arrive.                                             |
| 7     | 4. Tokens: session status vocabulary and motion scale                             | M        | Gives the dock, sidebar and centre one status language.                                     |
| 8     | 3. Shell: mobile bottom bar with an orchestrator slot                             | M        | The phone form of the dock.                                                                 |
| 9     | 10. Notifications: toast policy audit                                             | S        | Independent. Low risk.                                                                      |
| 10    | 11. Tickets: blocked by relation with auto start                                  | M        | Highest value feature from section 6. Needs a design pass on the start saga.                |
| 11    | 12. Costs: budget warning threshold and per group rollup                          | S        | Extends the existing budget stop.                                                           |
| 12    | 7. Command centre: Bands and Tree view mode                                       | M        | Only useful when boards have more than one orchestrator.                                    |

## 10. Follow-up tickets

The orchestrator raises these drafts as a proposal. The number is the ticket number used in this report.

### Ticket 1. Orchestrator: sidebar row and palette commands, remove the board header button

**What:** Add an "Orchestrator" row under the selected board in the sidebar, and orchestrator commands in the command palette. Remove the "Orchestrator" button from the board page header.

**Why:** The user does not want the orchestrator as a top bar entry. Today the header button is the only entry on the board page, and no entry exists on other pages.

**Scope:**

- In `src/web/modules/shell/components/SidebarBoards.tsx`, add a row under the selected board. It shows "Orchestrator" with the state glyph and the needs you count. On a board with no orchestrator, it shows a muted "Add orchestrator" row.
- The row opens `/boards/$key/orchestrator`. "Add orchestrator" opens the existing add flow.
- In `src/web/modules/shell/domain/commands.ts`, add "Open orchestrator", "Message orchestrator" and "Start orchestrator" for the selected board.
- Remove `board` from `PAGE_HEADER_VIEWS` in `src/web/routes/__root.tsx` and delete the entry view and `EntryButton.tsx` if nothing else uses them.
- Update `docs/standards/orchestration-ui-spec.md` for the new entries.

**Out of scope:** the bottom dock (ticket 2). The mobile bottom bar (ticket 3).

**Acceptance:**

- The board page header shows no orchestrator button.
- The sidebar shows the orchestrator row under the selected board on every page, with the needs you count.
- On a board with no orchestrator, the sidebar shows "Add orchestrator" and the shell is otherwise unchanged.
- The palette lists the three commands and each one works.
- `npm run check` passes. Visual snapshots are updated for the header and sidebar.

### Ticket 2. Orchestrator: bottom dock

**What:** Add a bottom dock that holds the conversation of the main orchestrator of the selected board, on every board scoped page.

**Why:** The user can answer a stopped orchestrator on the page where they already are.

**Scope:**

- A dock with three states as in section 4.5: collapsed (44px), expanded (40 percent, minimum 280px, resizable) and needs attention (72px with the question and option buttons).
- Reuse `CentrePaneContainer`, `ConversationList` and `CommentBox`. Compose the dock in `src/web/routes/__root.tsx` or a shared layout component (frontend rule 8).
- Hide the dock on the centre page and on boards with no orchestrator.
- The needs attention state uses the `ToneBadge` state tone, never the accent.
- Escape closes the dock before the detail panel.
- Shortcut `m` focuses the message field. Check `src/shared/shortcuts.ts` and page scoped keys for a collision first.
- Persist the expanded state and height per board in local storage.

**Out of scope:** the phone form (ticket 3). A dock for extra orchestrators.

**Acceptance:**

- On Board, Tickets, Sessions and Inbox, the dock shows the last orchestrator message and a message field.
- A message sent from the dock appears in the centre conversation.
- A decision item shows in the strip, and an option button answers it.
- The dock does not cover board cards or the terminal toolbar at 1280px.
- `npm run check` passes. Visual snapshots cover all three states in both themes.

### Ticket 3. Shell: mobile bottom bar with an orchestrator slot

**What:** Below 768px, replace the hamburger only top bar flow with a bottom bar: Today, Inbox, New ticket, Board, Orchestrator.

**Why:** A phone user cannot reach the orchestrator today. The bottom bar is also the phone form of the dock.

**Scope:**

- A 64px opaque bottom bar in `src/web/modules/shell/components/ShellFrame.tsx`. It hides on scroll down and returns on scroll up, and honors reduced motion.
- The Orchestrator slot shows the needs you count and opens a bottom sheet with the conversation.
- The bar publishes its height as a CSS variable so that sheets and composers clear it.
- Editable fields use at least 16px text on touch devices.

**Out of scope:** desktop layout changes.

**Acceptance:**

- At 390px, the bar shows five slots and each one navigates or opens the sheet.
- A message sent from the sheet appears in the centre conversation.
- The page content is never hidden under the bar.
- `npm run check` passes. Visual snapshots at 390px in both themes.

### Ticket 4. Tokens: session status vocabulary and motion scale

**What:** Add one status token set for live session state, a motion duration scale with one named curve, tracking tokens and a mono size role.

**Why:** Dispatch has no shared status language for running, idle, waiting, stopped and errored. Durations are named by role with no scale.

**Scope:**

- Status tokens for running, idle, waiting for input, stopped and errored in `src/web/styles/tokens.css`, with light values and contrast pairs in `scripts/contrast-113.mjs`.
- Update `src/web/styles/tokens.test.ts` counts and rules.
- Duration scale (instant, fast, base, slow) and one named curve. Role tokens reference the scale.
- Tracking tokens to replace raw `tracking-[...]` values. A mono size role.
- Move `SessionStateBadge` and the centre tiles onto the status set. A running tile shows a pulse that honors reduced motion.
- Update `docs/standards/design-contract.md`.

**Out of scope:** new colors for columns, priorities or sources.

**Acceptance:**

- `tokens.test.ts` and the contrast script pass on both themes.
- No raw `tracking-[` remains in `src/web`.
- The session badge, sidebar row and centre tiles use the same status tokens.
- `npm run check` passes.

### Ticket 5. Tokens: spacing policy and token gate script

**What:** Set Tailwind `--spacing` to the 4px base, state the spacing policy, and add a token gate script for what ESLint does not cover.

**Why:** 1,152 numeric spacing utilities sit next to 288 token utilities with no stated rule. Color literals in CSS and value brackets are not gated.

**Scope:**

- One `@theme` line for the 4px base. A policy paragraph in `docs/standards/design-contract.md`.
- A script in `scripts/` that fails on: color literals in CSS outside `tokens.css`, value arbitrary brackets, raw font sizes, raw `ms` and `cubic-bezier`. The allowlist sits next to the script and matches exact paths with a reason per line.
- Add the script to `check:unlocked` in `package.json`.
- Move the 12 `viewer.css` highlight colors into `tokens.css`.
- Allowlist or fix the current bracket values.

**Out of scope:** a codemod of the numeric spacing utilities.

**Acceptance:**

- The gate passes on the branch and fails on a test fixture for each of the four classes.
- `viewer.css` has no hex value.
- `npm run check` passes and visual snapshots show no change.

### Ticket 6. Command centre: group tile expands to show units

**What:** Let a group tile in the command centre expand in place to show its units and member tickets.

**Why:** This answers the org chart question at low cost: the user sees orchestrator, group, unit and loop on one canvas.

**Scope:**

- An expand control on `src/web/modules/orchestrator/components/BranchTile.tsx` for group tiles.
- The expanded tile shows the milestone track of units and the member ticket rows with state.
- The keyboard order and the 390px list stay one structure.

**Out of scope:** the Tree view mode (ticket 7). Drag to move ownership.

**Acceptance:**

- A group tile expands and collapses with the mouse and with the keyboard.
- Units show their state with glyph and label.
- The phone list shows the same content.
- `npm run check` passes. Visual snapshots for both states.

### Ticket 7. Command centre: Bands and Tree view mode

**What:** Add a "Bands | Tree" toggle to the centre toolbar, shown only when the board has more than one orchestrator.

**Why:** With several orchestrators, the user needs to see which orchestrator owns which group.

**Scope:**

- A pure layout function in `src/web/modules/orchestrator/domain/` with unit tests: main orchestrator, extra orchestrators, then owned groups, units collapsed.
- Reuse `CentreEdges.tsx` for edges.
- Tiles are focusable buttons in tree order. Status uses `SessionStateBadge`.
- Below the wide breakpoint, the toggle does not show and the Bands list stays.

**Out of scope:** pan and zoom, drag to reparent, SVG export.

**Acceptance:**

- The toggle shows only on a board with two or more orchestrators.
- Tree mode places each group under its owner.
- Keyboard order follows the tree.
- `npm run check` passes.

### Ticket 8. Orchestrator conversation: Queued state

**What:** Show a "Queued" state on a message sent while the orchestrator is working, with Cancel.

**Why:** Today the line shows only "Delivered" or "Not confirmed". The user cannot tell that a message waits for the current turn.

**Scope:**

- A Queued state in `src/web/modules/orchestrator/components/ConversationList.tsx` and `CommentBox.tsx`.
- Cancel removes the queued message before delivery.
- The state changes to Delivered when the orchestrator takes the message.

**Out of scope:** an Interrupt action.

**Acceptance:**

- A message sent while the orchestrator works shows "Queued".
- Cancel removes it, and the orchestrator does not receive it.
- `npm run check` passes.

### Ticket 9. Sidebar: per board live count and spoken rail labels

**What:** Show a running loop count on each board row, and give each collapsed rail icon a spoken label with its count.

**Why:** The user sees where work runs without opening a board. A screen reader user gets the count in the rail.

**Scope:**

- "N live" on each board row in `src/web/modules/shell/components/SidebarBoards.tsx`, from the board stream.
- In the collapsed rail, the count becomes a dot and the `aria-label` reads, for example, "CEN, 3 live, 2 need you".

**Out of scope:** new polling.

**Acceptance:**

- The count changes when a loop starts or stops, with no page reload.
- The rail labels read the counts in a screen reader check.
- `npm run check` passes.

### Ticket 10. Notifications: toast policy audit

**What:** Audit Dispatch toasts against four suppression rules and fix the gaps.

**Why:** Toasts that repeat on reconnect or report routine success use the user's attention for nothing.

**Scope:**

- Audit `src/web/modules/shell/hooks/use-transition-notifications.ts` and `use-undo-toast.ts` against these rules: a session start or success does not toast, a failure older than 5 minutes does not toast, a reconnect replay does not toast, a hidden tab does not replay a backlog when it becomes visible.
- Fix each gap and add a test per rule.
- Record the policy in `docs/standards/orchestration-ui-spec.md`.

**Out of scope:** a new toast component.

**Acceptance:**

- One test per rule passes.
- `npm run check` passes.

### Ticket 11. Tickets: blocked by relation with auto start

**What:** Let a ticket name another ticket as its blocker, and start it when the blocker reaches Done.

**Why:** This is the highest value feature in section 6. It removes manual sequencing for tickets outside a group.

**Scope:**

- A `blockedBy` field on a card, set from the card panel and from the orchestrator API.
- When a blocker moves to Done, the start saga starts each card it blocks, inside the board policy limits.
- A blocked card shows its blocker on the card and in the panel.
- Reject a cycle with a clear error.
- Update `docs/ARCHITECTURE.md` (Column Transition Specification and the board API).

**Out of scope:** dependencies across boards. Linear relation sync.

**Acceptance:**

- A card blocked by another card starts when the blocker reaches Done.
- A cycle is rejected.
- The policy concurrency cap still applies.
- `npm run check` passes.

### Ticket 12. Costs: budget warning threshold and per group rollup

**What:** Warn at a set percent of a budget before the hard stop, and show the cost rollup per group.

**Why:** Today the supervisor stops at the budget with no early warning.

**Scope:**

- A warning percent in the board policy, default 80.
- When a scope passes the percent, add an attention item and a sidebar count once.
- Show the cost total per group in the centre tile and the group panel.

**Out of scope:** new cost sources. Monthly windows.

**Acceptance:**

- A scope that passes the percent raises one attention item, not one per pass.
- The hard stop behavior does not change.
- `npm run check` passes.

## Appendix. Method and files read

- Paperclip: `README.md`, `DESIGN.md`, `LICENSE`, every `package.json`, `doc/SPEC.md`, `doc/DATABASE.md`, `doc/TOASTS.md`, `doc/TASK-WATCHDOG.md`, `doc/design/DECISION-SHEET.md`, `packages/db/src/schema/` (agents, issues, goals, heartbeat runs, approvals, budgets, activity), `server/src/app.ts`, `server/src/index.ts`, `server/src/services/agents.ts`, `server/src/routes/agents.ts`, `server/src/routes/issues.ts` (checkout), `server/src/routes/org-chart-svg.ts`, `server/src/realtime/`, `ui/src/index.css`, `ui/src/motion-tokens.css`, `ui/components.json`, `ui/src/components/ui/`, `ui/src/App.tsx`, `ui/src/components/` (Layout, Sidebar, BreadcrumbBar, MobileBottomNav, IssuesList, StatusBadge, StatusGlyph, EmptyState, CommandPalette, IssueChatThread, LiveRunWidget), `ui/src/pages/` (OrgChart, Agents, Inbox, IssueDetail, AgentDetail, Dashboard, BoardChat, Approvals), `scripts/check-token-gates.mjs`.
- Dispatch: `src/web/styles/`, `src/web/components/ui/`, `src/web/routes/__root.tsx`, `src/web/modules/shell/`, `src/web/modules/orchestrator/`, `src/web/modules/shell/domain/commands.ts`, `src/shared/shortcuts.ts`, `src/shared/types.ts`, `src/server/services/orchestration/supervisor-*.ts`, `eslint.config.ts`, `docs/ARCHITECTURE.md`, `docs/standards/design-contract.md`, `docs/standards/frontend-architecture.md`, `docs/standards/orchestration-ui-spec.md`, `docs/research/orchestration-centre-research.md`.
- Counts in section 2.5 come from grep over `src/web` on this branch. Counts in section 2.2 come from grep over the Paperclip clone.
