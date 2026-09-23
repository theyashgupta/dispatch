# fldsmdpr analysis: Slack, Linear and Meetings connections for Dispatch

**Ticket:** LOCAL-22
**Studied:** [edumntg/fldsmdpr](https://github.com/edumntg/fldsmdpr) at commit `bc4c398` (v0.2.0, 2026-09-23). Cloned and read end to end (about 18k lines of Rust and TypeScript, lockfiles excluded).
**Dispatch baseline:** `main` at `3091c6a` (v3.6.3).
**Screenshots:** `docs/research/assets/fldsmdpr/` (captured from the Vite browser preview with mock data, 1280x820).

## 1. Summary

fldsmdpr is a local-first desktop inbox (Tauri 2 + Rust core, React 19 frontend, SQLite, OS keychain) that pulls actionable items from GitHub, Linear, Sentry, Slack, Calendar, Notion and Granola into one prioritized list, and launches a Claude Code session from any item. It is one developer's daily driver, two weeks old, alpha.

The three connections in scope differ a lot in maturity:

| Connection | Direction      | Mechanism                                                                                                                                            | Maturity                                     |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Slack      | read only      | Web API with the user's browser session token, plus an optional headless `claude` round over the Slack MCP connector                                 | Working, fragile auth                        |
| Linear     | read and write | GraphQL with a personal API key: assigned issues in, create/update/comment out                                                                       | Working, no pagination, no conflict handling |
| Meetings   | read only      | Calendar events (macOS Calendar via JXA, or a secret iCal URL) and Granola action items via a headless `claude` round over the Granola MCP connector | Working, slow, model-dependent IDs           |

**Recommendation:** build **Linear two-way sync first**, then **Slack**, then **Meetings**. Details in section 8. Twelve follow-up tickets are listed in section 9.

**License:** the repository has **no LICENSE file** (GitHub API reports `license: null`). Under default copyright the code is all rights reserved. Dispatch must not copy code, prompt text or UI copy from it. Reimplementing the ideas and patterns described here is fine. See section 10.

## 2. Architecture map

### 2.1 Stack and process model

- **Shell:** Tauri 2, one Rust process, tokio runtime. `src-tauri/src/lib.rs` registers every IPC command (about 60) in one `generate_handler!` list.
- **Frontend:** React 19, Vite, Tailwind 4, Zustand stores, lucide icons, xterm.js for the built-in terminal. `src/lib/ipc.ts` wraps every Tauri command and falls back to mock data outside Tauri, which is why the app runs in a plain browser for design work.
- **Storage:** SQLite (rusqlite, WAL) at the app data dir, `fldsmdpr.db`. Schema in `src-tauri/src/db.rs`, three migrations tracked by `PRAGMA user_version`.
- **Secrets:** OS keychain through the `keyring` crate. All secrets live in **one keychain item** as a JSON blob so macOS prompts once per launch instead of once per token (`src-tauri/src/secrets.rs`). Keys are `token:github`, `token:linear`, `token:slack`, `token:slack_cookie`, `token:openrouter`, `token:gcal`, `token:sentry`.
- **Settings:** a `kv(key, value)` table holds everything else: profile fields, per-source enable flags, cursors, cached summaries, UI prefs.

### 2.2 Data model

One table carries every item regardless of source (`db.rs` v1 migration):

```
notifications(id, source, type, title, snippet, url, created_at, priority REAL,
              state unread|read|snoozed|done, snoozed_until,
              relevance_kind, relevance_score, relevance_reason,
              context_json, group_key) + FTS5 over title and snippet
```

Connectors produce a provider-agnostic `Fetched` struct (`src-tauri/src/connectors/mod.rs`): `id`, `source`, `ntype`, `title`, `snippet`, `url`, `created_at`, `priority`, `meta: HashMap<String,String>`, optional `relevance`. `meta` is a free-form string map serialized into `context_json`. Everything source-specific (repo, channel, Linear state color, comments JSON, meeting siblings, Jev scores) lives in `meta`. This is the single most reusable idea in the codebase: **one row shape, one upsert, per-source detail in a string map.**

Tables `sources`, `profile` and `triage_feedback` exist in the schema but are unused; the kv table took over.

### 2.3 Sync loop

The scheduler lives in the **frontend**, not in Rust (`src/stores/sync.ts`):

- refresh on app open;
- a 30 s tick that re-syncs when the last sync is older than 60 s while focused or 5 min in background;
- one configurable daily refresh (default 09:00) followed by a native "morning briefing" notification.

Each tick calls one Rust command, `run_sync` (`src-tauri/src/providers.rs`), which runs the fast connectors **sequentially**: GitHub, Linear, Sentry, Slack fast path, then Calendar. Results are upserted in one pass by `inbox::upsert`, which has three rules worth copying:

1. an existing row keeps its `state` (read, done, snoozed): a sync never resurrects triaged items;
2. `meta` is merged with `json_patch`, so app-owned keys (pinned, linked ticket, AI scores) survive a connector overwrite;
3. items a **complete and successful** fetch no longer returns are auto-marked done (`resolve_missing`), but only for sources whose fetch is a full snapshot (GitHub, Linear, Sentry, Calendar). Slack, Notion and Granola items are point-in-time and are never auto-resolved.

Slow AI rounds (Slack summaries, Notion, Granola) run on their own hourly cadence from `src/stores/aiSources.ts` and `src/stores/slackAi.ts`, never inside `run_sync`.

### 2.4 AI layers

Two distinct AI mechanisms:

- **Jev triage** (`src-tauri/src/jev.rs`): TypeSafe's decision model through OpenRouter's `/api/alpha/decisions` endpoint. It answers typed questions (urgency choice, needs-action probability, a 0 to 4 "attack now" score, suggested agent action) in a few hundred milliseconds per item, at negligible cost. Results land in `meta.jev_*` and override the connector's priority when confidence is at least 0.5. Only items whose title or snippet hash changed are re-judged. Jev also links Sentry errors to related PRs and tickets, and reads agent terminal tails to decide done/needs-input/failed.
- **Headless `claude` rounds** (`src-tauri/src/claude_cli.rs`): spawn `claude -p <prompt>` with JSON output, a single allowed MCP tool, Sonnet as the model, stdin closed and stdout/stderr redirected to temp files (both load-bearing: a piped stdout that nobody drains deadlocks at 64 KB, and `-p` waits on a non-TTY stdin). Used where no token API exists (Granola), where the org blocks tokens (Notion), and for Slack summaries.

### 2.5 Agent execution

Three runners, chosen per launch (`src/stores/agents.ts`, `src/features/agents/AgentRunButton.tsx`): Orca worktree via its CLI, Claude Desktop via a `claude://code/new?folder=&q=` deep link, or the built-in PTY terminal running `claude` with the prompt injected. Prompts are built per item type in `src/features/agents/prompt.ts` (title, repo, reference, URL, snippet, optional rich context such as a Sentry stack trace). Agent completion flows back as an `agent` source notification. Dispatch already covers this space more deeply (worktrees, tmux, hooks, DISPATCH_STATUS), so it is not analysed further.

## 3. Slack connection

### 3.1 What it does and the user flow

Settings shows a Slack master switch (off by default). When on, a connection card appears with two sections (screenshot `05-settings-connections.png` shows the collapsed state):

1. **Fast path: your browser session.** A consent gate lists what the app will do (read the picked channels and DMs, store them locally, act read-only), what it will never do (see the password, upload anything, read the Slack desktop app), and how to undo (Disconnect wipes the keychain entry). Then "Sign in to Slack" opens a Tauri-owned webview on `slack.com/signin`; the user logs in normally; the window closes itself when the app has picked up the session. A manual fallback lets the user paste the two values from DevTools.
2. **Channels to watch.** A checkbox list from `users.conversations`, or, when the enterprise blocks that call, a paste box that accepts a channel link or bare ID. DMs are always included.
3. **Day and week summaries via Claude** (optional, slow): a second toggle, a "Check connection" button that runs `claude mcp list`, "Analyze now" and a last-analyzed stamp.

In the inbox, Slack items carry pills (You sent, From X, Awaiting reply, DM, Mention, Thread). The Slack section adds a collapsible "Slack summary" card with Today and Week tabs; actionable bullets get a compact "run agent" button. The detail pane offers "Draft reply" (agent), "Create Linear ticket", Snooze and Done (screenshot `08-dark-slack-detail.png`).

### 3.2 How it is built

**Authentication.** The org blocks creating Slack apps, so fldsmdpr authenticates exactly like the web client: an `xoxc-` workspace token as bearer plus the `d` cookie (`xoxd-`) on every request (`connectors/slack.rs`, `api()`). Guided sign-in (`src-tauri/src/slack.rs`, `slack_sign_in`):

- opens a webview with a pinned Safari user agent (Slack rejects the stock WKWebView UA);
- polls every 1.2 s for up to 10 min;
- reads the HttpOnly `d` cookie from the webview cookie store and the token from `localStorage.localConfig_v2.teams[*].token` via `eval_with_callback`;
- nudges the window to `app.slack.com/client` at most twice, because Slack parks signed-in users on a "Ready to launch" page that hands off to the desktop app;
- validates with `auth.test`, stores both values in the keychain, records "user @ team" in kv.

The sign-in window is deliberately absent from the Tauri capability files, so the Slack page cannot call any app command. Slack rotates these sessions; the card has a "Sign in again" button for that.

**Events listened to.** None. There is no Socket Mode, no Events API, no webhook. Everything is polling.

**Fast path fetch** (`connectors/slack.rs`, `fetch`):

- targets = opted-in channels + every `im`/`mpim` from `conversations.list` (best effort);
- `conversations.history` per target with `oldest` = last cursor minus 600 s overlap, first run 24 h back, `limit=100`, no pagination;
- skips messages with a `subtype` (joins, pins) or a `bot_id`;
- cursor `slack:last_ts` stored in kv as the newest `ts` seen.

**Classification:**

| Rule                                                                                                                    | Result                                                               | Priority |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| text contains `<@me>` or channel is a DM                                                                                | explicit `mention` item                                              | 82       |
| other channel message, Jev "relevant" probability at or above 0.6 (first 150 candidates)                                | `ai_inferred` item, reason "AI judged this N% likely to concern you" | 78       |
| user's own message, no replies, not in a thread, longer than 12 chars, Jev "awaiting reply" at or above 0.65 (first 40) | `follow_up` item "Waiting for a reply in #channel"                   | 70       |

Without a Jev key only the first rule applies. Author names are resolved with `users.info` and cached per run. The permalink is built as `{team_url}archives/{channel}/p{ts without dot}`.

**Claude round** (`fetch_via_claude`, optional): one `claude -p` call allowed only the Slack MCP tool, 420 s timeout, that returns JSON with three arrays: `items` (last 24 h, explicit or implicit), `daySummary` and `weekSummary` (bullets with channel and an `actionable` flag), and `tasks` (max 10, last 7 days, each with a stable kebab-case `key`, imperative title, detail, urgency). Incremental mode after a recent run: read only messages newer than last run minus 30 min and merge into the stored summaries. Summaries are cached in kv and rendered by `SlackOverview`.

**How messages become work items:**

- fast-path rows use id `slack:{channel_id}:{ts}`, so one message is one row forever;
- Claude-extracted tasks use id `slack:task:{key}`, so a re-analysis updates the same row instead of duplicating it, and a task the user marked done stays done;
- a user can turn any Slack item into a Linear ticket through `CreateTicketModal` (title prefilled, description = message text + source link + "Created from FLDSMDPR (slack)"); the new ticket identifier and URL are written back into the item's `meta.linked_ticket`;
- "Draft reply" launches an agent with the message as context.

**Posting back.** Nothing. The consent copy promises the app never posts, replies, reacts or changes anything in Slack, and the code has no write call. Replies drafted by the agent are pasted by the user.

### 3.3 What maps onto Dispatch, what does not

| fldsmdpr concept                      | Dispatch                                                                                   | Fit                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| notification row per message          | `Card` with `source: "slack"`, identifier `SLACK-n` from a local counter, landing in Inbox | clean; `createLocalCard` already does the counter and Inbox landing                                                                                                                  |
| `meta` string map                     | no equivalent; `Card` has typed fields only                                                | needs a small typed extension (channel, author, permalink, thread ts) or a JSON `sourceMeta` field                                                                                   |
| session-token auth                    | wrong for Dispatch                                                                         | Dispatch is a headless Node server without a webview; the honest path is a Slack app with a bot or user token stored in the Dispatch Vault (`SLACK_BOT_TOKEN` or `SLACK_USER_TOKEN`) |
| polling with cursor                   | `TicketSource.fetch()` + generic poller                                                    | the poller assumes a full snapshot per poll (reconcile removes missing issues); Slack needs an append-only source flag or its own poll loop                                          |
| explicit vs implicit relevance (Jev)  | none                                                                                       | skip in v1; mentions and DMs only                                                                                                                                                    |
| unread, read, snoozed, done           | columns                                                                                    | Inbox = unread, Todo = accepted, Done = handled; snooze has no column, skip                                                                                                          |
| "Create Linear ticket" from a message | existing `sync-linear` on local cards                                                      | already fits: a Slack card is a local card                                                                                                                                           |
| "Draft reply" agent                   | `run-claude` on a card                                                                     | fits; Dispatch sessions are per card                                                                                                                                                 |

**Effort:** **M** for a read-only Slack source (settings card with vault key, channel picker, mentions and DMs into Inbox, permalink and thread context on the card). **L** if Socket Mode, AI relevance and summaries are added.

## 4. Linear connection

### 4.1 What it does and the user flow

Settings: a standard connection card (numbered setup guide, scope list, link to `linear.app/settings/account/security`, a password input, Connect). The key is validated with `{ viewer { displayName email } }` and the display name becomes the account chip.

Inbox: assigned open issues appear as tickets titled `{identifier}: {title}` with a snippet like `High · Cycle 14 · Retry storm...`, a state chip colored with **Linear's own workflow state color**, an Urgent chip and the cycle label (screenshot `03-inbox-linear-detail.png`). The Tickets section supports grouping by status, priority, project, lead, cycle or team.

Detail pane (`LinearSections`, `LinearActions`): full description rendered as markdown, the last three comments collapsible, and an inline action bar: **Move to...** (workflow state select), **Assign to me**, and a comment box. After any action the app triggers a full sync so the chips refresh. Sentry and Slack items get a **Create Linear ticket** button that opens a modal with team, status, project, assignee, priority, due date and description, plus an optional "launch agent to fix this" that starts Claude with the new ticket reference appended to the prompt.

### 4.2 How it is built

**Auth:** personal API key, sent raw in the `Authorization` header (identical to Dispatch's `LinearSource`). Stored in the keychain as `token:linear`.

**Inbound** (`connectors/linear.rs`, `fetch`): one query, `viewer.assignedIssues(first: 50, orderBy: updatedAt, filter: state.type nin [completed, canceled])`, fetching `id identifier title description url updatedAt priority priorityLabel state{name type color} team{key name} cycle{number} project{name lead{displayName}} comments(last: 3){body createdAt user{displayName}}`. **No pagination**: more than 50 open assigned issues are silently cut. Runs every sync tick (60 s while focused).

**Field mapping:**

| Linear                                                                        | notification                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`                                                                          | `id = lin:{id}`                                                             |
| `identifier`, `title`                                                         | `title = "{identifier}: {title}"`                                           |
| `priorityLabel`, `state.name`, `cycle.number`, first 220 chars of description | `snippet`                                                                   |
| `priority` 1..4                                                               | base priority 84 / 76 / 70 / 64 (none 66), +4 when updated in the last 24 h |
| `state.name`, `state.type`, `state.color`                                     | `meta.state`, `meta.state_type`, `meta.state_color`                         |
| `description` (6000 chars), `comments` (3 x 600 chars, JSON)                  | `meta.description`, `meta.comments`                                         |
| `team.name`, `project.name`, `project.lead.displayName`, `cycle`              | `meta.team`, `meta.project`, `meta.lead`, `meta.cycle`                      |

**Status mapping:** there is none in the board sense. The Linear state is displayed, not mapped to a local state. The only local state transition driven by Linear is auto-resolve: an issue that leaves the "open and assigned to me" set disappears from the next fetch and `resolve_missing` marks the row done.

**Outbound** (`connectors/linear.rs`, exposed through `providers.rs`):

- `linear_meta`: `teams(first: 50) { states, projects(first: 50), members(first: 50) }` in one query, fetched when the create modal or the action bar mounts;
- `linear_create_issue`: `issueCreate(input)` with `teamId`, `title`, `description`, optional `projectId`, `assigneeId`, `stateId`, `priority`, `dueDate`; returns identifier, url, title (about 40 lines);
- `linear_update_issue`: `issueUpdate(id, {stateId?, assigneeId?})`; the literal `"me"` is resolved through `{ viewer { id } }`;
- `linear_add_comment`: `commentCreate({issueId, body})`.

**Conflict handling:** none, and none is needed by design. Local edits never touch Linear-owned fields; every mutation goes straight to Linear and the next poll overwrites the local copy. `upsert` protects only app-owned keys (read state, pinned, linked ticket, Jev scores). The one race is cosmetic: after "Move to", the chip shows the old state until the triggered sync returns.

### 4.3 What maps onto Dispatch, what does not

Dispatch's inbound Linear path is already **more** robust than fldsmdpr's: cursor pagination (250 per page, 20 pages), filter dimensions, `RateLimited` backoff, a partial-pull guard, and a reconcile that distinguishes remove, gone and reappeared. Nothing inbound needs to be copied.

What fldsmdpr has and Dispatch lacks:

| Capability                                                                  | fldsmdpr                                   | Dispatch today                                                                            | Fit                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push a state change to Linear                                               | `issueUpdate` from a select                | none; `Card.column` moves are local only                                                  | **the gap that matters**: map board columns to workflow state types (Todo = unstarted, In Progress and Needs Input = started, In Review = started or a named review state, Done = completed) and push on manual moves |
| Show comments, add a comment                                                | last 3 comments in `meta`, `commentCreate` | none                                                                                      | clean; extend `ISSUE_NODE_FIELDS` and the card panel                                                                                                                                                                  |
| Assign to me                                                                | `issueUpdate(assigneeId)`                  | none                                                                                      | clean, small                                                                                                                                                                                                          |
| State color, team, cycle, lead                                              | in `meta`                                  | `linearState {name, type}` only                                                           | clean; add `color` and `team`, `cycle` to `SourceIssue`                                                                                                                                                               |
| Create issue directly                                                       | direct `issueCreate`                       | `linear-sync.ts` drives Claude over the Linear MCP with a prompt-fenced idempotency token | direct GraphQL is simpler and deterministic; keep the token idea for idempotency                                                                                                                                      |
| Create-ticket modal with team, state, project, assignee, priority, due date | `CreateTicketModal`                        | `CreateTicketModal` takes title and description only                                      | borrow the field set                                                                                                                                                                                                  |

**Effort:** **S** for comments, assignee, color and metadata. **M** for two-way status mapping (needs a per-team state map in settings, an outbound queue that survives a poll race, and the reconcile rule "a local move wins over the next poll until Linear confirms").

## 5. Meetings connection

fldsmdpr has no single "meetings" module. Two sources cover it: calendar events (what is coming) and Granola action items (what was said).

### 5.1 What it does and the user flow

**Calendar.** Settings offers "Use macOS Calendar" (primary) with a checkbox list of local calendars, and an advanced fallback that takes a Google Calendar secret iCal URL. Events from one hour ago to 48 hours ahead appear in the Calendar section and in the Today view's agenda with a **Join** button (screenshot `06-today.png`). A meeting that starts within 15 min gets priority 92, within an hour 84, later today 64, otherwise 52.

**Granola.** Settings shows a "Granola (meetings), via Claude" card: an Enabled toggle (no token, the `claude` CLI already holds the connector), a review-window select (24 h, 48 h default, 3, 7 or 14 days), a status line and "Analyze now". Extracted action items appear in the Meetings section as `action_item` rows titled with the action text and a snippet `From "Meeting name"`. The detail pane lists every other action item from the same meeting, highlights the current one, and offers a **Load transcript** button that fetches and caches the transcript (about one minute the first time).

### 5.2 How it is built

**Calendar, macOS path** (`connectors/maccal.rs`): `osascript -l JavaScript` runs a JXA snippet against `Application("Calendar")`, filters events by start date, returns JSON (title, start, location, url, first 200 chars of notes, calendar). Ignores Birthdays, US Holidays and Siri Suggestions by default. The Automation permission error (-1743) is mapped to a human message. No Google API, no OAuth.

**Calendar, iCal path** (`connectors/gcal.rs`): fetch the `.ics`, unfold RFC 5545 continuation lines, parse `UID`, `SUMMARY`, `DESCRIPTION`, `LOCATION`, `X-GOOGLE-CONFERENCE`, `DTSTART` (UTC, floating and all-day forms), pick a join link from the conference field or the first https URL in location or description.

**Granola** (`connectors/ai_rounds.rs`): no public API, so one headless `claude -p` round with only the Granola MCP tool allowed, 300 s timeout, Sonnet. The prompt asks for the user's own action items (commitments made, questions directed at them, decisions requiring their action) from meetings in the window, as JSON `{items: [{meeting, text, when, url}]}`, max 15. Incremental after a recent run (last sync minus 30 min); a window change clears the cursor so a full pass runs again.

Each item becomes a notification with id `granola:{meeting}:{first 24 alphanumeric chars of text}`, priority 76, and `meta.meeting_items` holding every sibling action item from the same meeting as JSON. The transcript is a second round (360 s) that asks for the closest title match in the last 14 days and a transcript capped around 12k chars with speaker labels, cached in kv under `granola:transcript:{slug}` (20k cap).

**Extraction quality and limits observed in the code:**

- item identity depends on the model repeating the same first 24 characters; a rephrase creates a duplicate row;
- no dedupe against Linear tickets or GitHub items that already track the same action;
- one round per hour while focused, about a minute each, entirely dependent on the user having the Granola connector configured in their own `claude` login;
- nothing runs locally over the transcript; every extraction is a remote model call.

### 5.3 What maps onto Dispatch, what does not

| fldsmdpr concept                                    | Dispatch                                                                                                            | Fit                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| calendar events as inbox items                      | none                                                                                                                | does not fit a kanban board; skip                                                                             |
| Granola action item as an item                      | local `Card` in Inbox with `source: "meeting"`                                                                      | clean; the counter and Inbox landing exist                                                                    |
| headless `claude -p` round with one MCP tool        | `run-claude.ts`, `ticket-generate.ts` already spawn `claude -p` with fixed flags, a timeout and stream-json parsing | strong fit; Dispatch's runner is more hardened than fldsmdpr's                                                |
| per-meeting sibling list and transcript on the item | card description                                                                                                    | fold into the description: meeting name, date, sibling items, transcript excerpt                              |
| stable id from text prefix                          | none                                                                                                                | improve on it: ask the model for a kebab `key` like the Slack task prompt does, and dedupe on `meeting + key` |
| review window setting                               | `Config`                                                                                                            | small settings field                                                                                          |
| user has Granola in `claude mcp list`               | not checkable from the server except by running `claude mcp list`                                                   | copy the "Check connection" button idea                                                                       |

A cheaper first step exists that fldsmdpr does not have: **paste meeting notes or a transcript into a "New tickets from meeting" modal** and let Dispatch's existing ticket draft generator produce several cards at once. No connector, no scheduler, works with any meeting tool.

**Effort:** **S** for the paste flow. **M** for a scheduled Granola round through Claude MCP with stable keys and a settings card.

## 6. Design review

The design reads as "quiet, dense, keyboard-first". The values that make it work, with file references, and what Dispatch can borrow without changing its styling approach (`docs/standards/frontend-design-system.md` forbids new styling technology, so every borrowing below is a token, a layout rule or an interaction, not Tailwind).

### 6.1 Layout and navigation

- **Three panes with a fixed rhythm** (`src/App.tsx`, `NotificationList.tsx`, `NotificationDetail.tsx`): sidebar 240 px (56 px collapsed), a list pane the user can drag between 300 and 680 px (default 380, persisted per pane in `usePaneSize`), and a detail pane whose content is a single centered card capped at `max-w-2xl`. Every view shares the same 52 px header row, so switching views does not move the eye.
- **Sidebar active pill slides** between rows instead of re-rendering per row (`Sidebar.tsx`, one absolutely positioned div translated by row index with a spring easing). Unread badges pop when the count changes. Sections that are switched off disappear from the nav (Slack).
- **Frosted sticky list header** (`.glass` in `global.css`): title, count, icon toolbar, then a filter row (free text over every visible field, time range, group-by). Content scrolls under it.
- **View switch animation**: the main pane is keyed on the section id and rises in over 260 ms; list cards stagger by 22 ms up to 12 items. `prefers-reduced-motion` zeroes every animation.

Borrow for Dispatch: the pane-width persistence and the shared header height; the sliding active indicator in the top view toggle; staggered card entrance capped at 12.

### 6.2 Tokens and theming (`src/styles/global.css`)

- Four surface levels (`canvas`, `surface`, `surface-2`, `surface-3`), three ink levels, two line strengths, one accent with a soft tint and a foreground, three status colors, and **one color per source** (GitHub open, merged and closed match GitHub's own colors; Slack green; Linear indigo; Calendar amber; Sentry rose; agent teal).
- Six accent presets and a dark theme, both as attribute selectors on the root, with slightly brighter accents in dark mode. A `theme-switching` class crossfades colors for 300 ms on flip.
- Density as tokens: `card-pad`, `card-gap`, `row-h` change with `data-density=compact`.
- Motion as tokens: `ease-out`, `ease-spring`, 120, 180 and 260 ms durations.
- Font: Gabarito (variable) at 13.5 px base, JetBrains Mono for identifiers and diffs.

Borrow for Dispatch: per-source color tokens in `tokens.css` (Dispatch will soon show three sources side by side), density tokens, and a motion token set. Dark mode is a larger decision and out of scope here.

### 6.3 Board and list interactions

- **Cards** (`NotificationCard` in `NotificationList.tsx`): source badge, bold title while unread, two-line clamped snippet, a chip row (AI relevance, CI failing, Slack pills, Linear state chip with Linear's color, Urgent, Jev urgency), relative time right-aligned, and an inline agent status row when a run is active. Selected card gets an accent border plus a 15 percent accent ring; hover lifts by one pixel.
- **Context menu on right click or double click** with the full action set, and the same actions in the detail pane, the command palette and single-key shortcuts, all routed through one module (`src/lib/actions.ts`) so undo behaviour is identical everywhere.
- **Keyboard** (`useShortcuts.ts`): `j`/`k` move, `e` done, `s` snooze, `u` read toggle, `p` pin, `o` open, `a` ask, `Cmd+1..9` sections, `Cmd+K` palette, `Cmd+F` filter, `?` cheat sheet. The palette merges commands and an FTS5 search over every item ever received, including done ones.
- **Undo toasts** for done and snooze.
- **Empty states that sell the next step**: a section whose connector is missing shows "Connect X" with a button to Settings instead of "nothing here".

Borrow for Dispatch: the chip row with Linear state color, the single actions module, `j`/`k` plus single-key move-to-column, and the connect-nudging empty state for a source with no key.

### 6.4 Connection settings screens

This is the strongest part of the design and the one Dispatch should copy most closely (screenshots `02-onboarding-github.png`, `05-settings-connections.png`).

- **One card per provider** (`ConnectionCard.tsx`, data in `providerMeta.ts`): source badge, name, status chip (account name when connected), one-line token label, chevron. Expanded: a numbered **setup guide** with a connector line between steps, a **scopes** chip row in monospace, a deep link to the provider's token page, a password input plus Connect, a Disconnect button when connected, and a one-line privacy footer ("validated against the provider's API and stored only in your OS keychain").
- **Consent gate before a sign-in that grants access** (Slack card): three lists, "what it will do", "what it will never do", "how to undo", then a button that says "I understand".
- **Toggle cards for sources that ride on the `claude` CLI** (`AiSourceCard.tsx`): no token, an Enabled switch, a blurb, an optional window select, a status strip with spinner, last-analyzed time, last error and "Analyze now".
- **Onboarding wizard** (`Onboarding.tsx`, `OnboardingFlow.tsx`): one step per provider reusing the same cards, a progress bar, and a live map where each connected tool lights up and a chip rides into the inbox. Next is disabled until the connection validates, with an explicit "Skip this connection".
- **About you** card: name, email, handles, role and a free-text brief that every relevance judgment reads.

Borrow for Dispatch: the provider card anatomy (setup guide, scopes, status chip, privacy footer) for Linear, Slack and Meetings; the toggle-card variant for Claude-MCP sources; the Vault as the storage story in the footer text.

### 6.5 Two views Dispatch does not need but should know about

- **Flow** (`FlowView.tsx`, `FlowStage.tsx`, screenshot `07-flow.png`): a live pipeline diagram, sources to sync to triage to urgency trays, built with a fixed-coordinate stage scaled by `ResizeObserver`, one SVG of cubic edges and HTML nodes on top, and chips that travel along an edge with a pure CSS `offset-path` animation. No graph library. The same primitive draws the agent status flow and the related-items graph in the detail pane.
- **Today** (`TodayView.tsx`, `P0Section.tsx`): greeting, a P0 card with the top three to five items ranked by the Jev "attack now" score, per-source count chips that filter the list below, the agenda, and a paged "top of your list".

## 7. Other features worth considering, ranked

1. **Typed AI triage per item** (urgency, needs-action probability, attack score, suggested agent action) through a cheap decision model, with re-judging only on content change. Dispatch could rank Inbox by it.
2. **Single actions module** shared by panel, context menu, palette and shortcuts, with undo toasts.
3. **Command palette with full-text search over archived items** (FTS5 over title and snippet).
4. **Sentry connector with stack trace and breadcrumbs injected into the fix-agent prompt**, plus AI linking of an error to the PR or ticket that likely caused it.
5. **Ask view**: free-form questions answered by `claude -p` over a compact JSON dump of the local database, no tools, 10 to 30 s.
6. **Morning briefing** native notification after the daily refresh (PR count, ticket count, next meeting).
7. **Agent runner picker** with model choice and a "skip permissions" toggle remembered per user.
8. **One keychain blob for all secrets** to avoid repeated OS prompts (Dispatch's Vault already solves this differently).
9. **Auto-updater via GitHub Releases** with a one-line installer script.
10. **Copy as Markdown** for any item, and "Only items about me" filter driven by a deterministic profile match.

## 8. Recommended implementation order

**First integration to build: Linear two-way sync.**

Reasoning:

- Dispatch already owns a hardened inbound Linear source, a poller and a reconcile. The missing half is outbound state, comments and assignee, which fldsmdpr shows is a few short GraphQL mutations. Smallest gap, highest certainty, no new auth.
- It completes the promise "the board is the single place to act from": today a card moved to In Review on the board still reads Todo in Linear, so the user still opens Linear.
- Every later source ends in a Linear ticket anyway (fldsmdpr's own Slack and Sentry flows create Linear issues), so outbound Linear is a dependency of Slack and Meetings, not a peer.

**Second: Slack.** Highest new signal. Read-only, mentions and DMs into Inbox, a Vault-backed app token, channel picker. Do not port the session-token sign-in: Dispatch has no webview, and the mechanism is fragile and rotates. Do not port relevance AI in v1.

**Third: Meetings.** Start with the paste flow (notes or transcript to several draft cards through the existing generator), then the scheduled Granola round through Claude MCP once the source registry supports more than one source and its own cadence.

**Prerequisite for two and three:** generalize the source registry (one poller per source, per-source cadence, append-only sources that never remove cards, a source badge and filter in Inbox). Ticket 12 below.

## 9. Follow-up tickets

Created on the Dispatch board as LOCAL-23 to LOCAL-34, in the order below. One line each here; the ticket carries the scope and acceptance.

| #   | Ticket                                                                                   | Effort |
| --- | ---------------------------------------------------------------------------------------- | ------ |
| 1   | Linear: push board column changes to Linear workflow states (two-way status sync)        | M      |
| 2   | Linear: fetch comments and add a comment from the card panel                             | S      |
| 3   | Linear: Assign to me and a direct GraphQL create for Sync to Linear                      | S      |
| 4   | Linear: show workflow state color, team and cycle on cards                               | S      |
| 5   | Slack: connection settings card with Vault token and channel picker                      | M      |
| 6   | Slack: poll opted-in channels and DMs, land mentions and DMs in Inbox                    | M      |
| 7   | Slack: thread context on the card and a Draft reply agent action                         | S      |
| 8   | Meetings: New tickets from meeting notes paste flow                                      | S      |
| 9   | Meetings: scheduled Granola round through Claude MCP into Inbox                          | M      |
| 10  | Settings: connection card pattern shared by all sources                                  | S      |
| 11  | Board: command palette and keyboard navigation                                           | M      |
| 12  | Sources: multi-source registry, per-source poller cadence, Inbox source badge and filter | M      |

## 10. License and reuse limits

- The repository ships **no LICENSE file** and the GitHub API returns `license: null`. No license grant means the default applies: the author keeps all rights. There is also no CONTRIBUTING or NOTICE file that would grant anything.
- **Do not copy** any source code, CSS, prompt text, UI copy or setup-guide wording into Dispatch. Prompts and copy are creative text and are covered the same way as code.
- **Safe to reuse:** the ideas, data-flow decisions, API endpoints and field lists documented in this report (Slack Web API methods, Linear GraphQL fields and mutations, the JXA calendar approach, the headless `claude` invocation constraints). Facts about third-party APIs are not the author's work.
- The screenshots in `docs/research/assets/fldsmdpr/` are for internal design study only. Do not ship them or reuse the visuals in Dispatch marketing.
- If any of the twelve tickets ends up wanting more than the patterns above, ask the author for a license first (`edumntg` on GitHub).

## Appendix A. Files read

Rust core: `lib.rs`, `db.rs`, `secrets.rs`, `commands.rs`, `providers.rs`, `inbox.rs`, `slack.rs`, `jev.rs`, `ai_sources.rs`, `claude_cli.rs`, `agents.rs`, `ask.rs`, `calendar.rs`, `connectors/{mod,slack,linear,github,sentry,gcal,maccal,ai_rounds}.rs`.
Frontend: `App.tsx`, every store in `src/stores/`, `lib/{types,actions,involves,ipc}.ts`, `features/connections/*`, `features/inbox/{NotificationList,NotificationDetail,CreateTicketModal,SlackOverview,GranolaSections,mockData}.tsx`, `features/agents/{prompt,AgentRunButton,AgentFlow}.tsx`, `features/settings/SettingsView.tsx`, `features/onboarding/*`, `features/flow/*`, `components/flow/FlowStage.tsx`, `features/today/*`, `features/palette/CommandPalette.tsx`, `features/shortcuts/useShortcuts.ts`, `components/ui/{SourceBadge,SlackPills,LinearStateChip}.tsx`, `styles/global.css`.
Meta: `README.md`, `docs/ARCHITECTURE.md`, `package.json`, `Cargo.toml`, `tauri.conf.json`, `.github/workflows/ci.yml`.

## Appendix B. Dispatch touch points for the tickets

- Source contract: `src/server/sources/ticket.source.ts` (`TicketSource`, `RateLimited`), registry `src/server/sources/registry.ts` (single Linear source today), poller `src/server/adapters/poller.ts`.
- Linear inbound: `src/server/sources/linear/linear.source.ts` (`ISSUE_NODE_FIELDS`, `postGraphQL`), mapping `src/server/store/mapping.ts`, issue shape `SourceIssue` in `src/shared/types.ts`.
- Linear outbound today: `src/server/services/orchestration/linear-sync.ts` (Claude over Linear MCP with an idempotency token).
- Local cards: `POST /api/cards` in `src/server/routes/cards.route.ts`, `store.createLocalCard`, draft generator `src/server/services/orchestration/ticket-generate.ts` and `POST /api/cards/draft`.
- Claude subprocess runner: `src/server/services/orchestration/run-claude.ts`, `src/server/adapters/claude-cli.ts`.
- Vault: `src/server/routes/vault.route.ts`, runner `~/.dispatch/vault-run`.
- Settings UI: `src/web/features/settings/SettingsScreen.tsx`; Inbox UI: `src/web/features/inbox/*`; tokens: `src/web/styles/tokens.css`; primitives: `src/web/primitives/`.
