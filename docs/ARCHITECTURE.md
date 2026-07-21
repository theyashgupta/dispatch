# Dispatch — Architecture

This document is the durable home for Dispatch's **cross-module invariants**: the
protocols, traps, and do-not-change contracts that span more than one file.
Single-function rationale lives in JSDoc `@remarks` on the owning
declaration; this file owns the knowledge that no single function does. It **complements**
[docs/standards/backend-design.md](standards/backend-design.md) (which owns the layering
_rules_) and [docs/standards/comments.md](standards/comments.md) (which owns the comment
standard) — it links to them rather than restating them.

Each subsystem below has a stable anchor so a JSDoc `@see docs/ARCHITECTURE.md#anchor`
pointer can jump straight to the invariant it constrains. The two framing sections
(System Overview, Module Map) are written; the invariant, contract, security, and residual
sections are scaffolded here and filled by the later Phase 10 migration plans.

## Table of Contents

- [System Overview](#system-overview)
- [Module Map](#module-map)
- Cross-Module Invariants
  - [Single Writer Store](#single-writer-store)
  - [Marker Protocol](#marker-protocol)
  - [Watcher Discriminator](#watcher-discriminator)
  - [Attention Routing](#attention-routing)
  - [Resilience and Reconcile](#resilience-and-reconcile)
  - [In Review Lifecycle](#in-review-lifecycle)
  - [Terminal ttyd](#terminal-ttyd)
  - [Panel Iframe Identity](#panel-iframe-identity)
  - [Tmux Invocations](#tmux-invocations)
  - [Orchestration Saga](#orchestration-saga)
  - [Exec Chokepoint](#exec-chokepoint)
  - [Linear Sync](#linear-sync)
  - [SSE Transport](#sse-transport)
  - [Startup Preflight](#startup-preflight)
  - [Cleanup Lifecycle](#cleanup-lifecycle)
  - [Hooks Status Channel](#hooks-status-channel)
  - [Dev-Server Preview Detection](#dev-server-preview-detection)
- [Do Not Change Contracts](#do-not-change-contracts)
- [Security Threat Model](#security-threat-model)
- [Known Residuals](#known-residuals)

## System Overview

Dispatch is a single-user, localhost-only Kanban board that mirrors Linear tickets into
columns and turns a drag into a live Claude Code session. On the happy path data moves in one
direction: a Linear GraphQL poller samples the assigned-unstarted issue set on an interval and
hands the result to the single-writer board store, which is the sole owner of card state.
Every board mutation is enqueued on that store's serialized queue, and after each change the
store emits a snapshot that the hand-rolled SSE endpoint pushes to the React board over a
single `EventSource`. The board renders optimistically — a drag updates local state
immediately and reconciles against the next SSE snapshot, so board interactions never wait on
the server. Dragging a ticket into In Progress is the only asynchronous action: it runs the
start saga, which provisions an isolated workspace of git worktrees, launches a detached tmux
session running the Claude REPL, and spawns a per-session ttyd so the terminal can be embedded
in the detail-panel iframe. A pane watcher samples the tmux transcript every couple of
seconds, parses the `DISPATCH_STATUS` marker protocol, and writes at most one card decision per tick
back through the store — which is how a card reaches Needs Input or Done without human action.

The backend is restart-safe by design: tmux and ttyd, not the backend process, are the source
of truth for live sessions. On boot the store loads the persisted snapshot, then a reconcile
pass lists the surviving tmux sessions, marks any card whose session has vanished as
session-lost, and sweeps orphaned ttyd processes — so a `tsx watch` reload or a crash never
loses a running agent or ends up owning it twice. The watcher and poller re-attach to whatever
is already running rather than assuming a clean slate.

## Module Map

Condensed role-per-module map (full inventory and the old→new move table live in the planning
research). The backend is layered `bootstrap → routes → services → adapters → store`; the
**allowed import directions between those layers are the RULES owned by**
[docs/standards/backend-design.md](standards/backend-design.md) — this table names the layers
and roles only, it does not restate the layering policy.

| Layer               | Modules                                                                                                                                                        | Role                                                                                                                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap           | `bootstrap/index.ts`, `bootstrap/cli.ts`, `bootstrap/binary-check.ts`, `bootstrap/config.ts`, `bootstrap/reconcile.ts`                                         | CLI entry (`doctor`/`uninstall`/boot), informative startup preflight lines (via `services/infra/preflight.ts`), `StartupError` for config failures, config load/bootstrap, boot session reconcile, then wire routes + SSE and start poller/watcher. |
| Routes              | `routes/index.ts`, `routes/cards.route.ts`, `routes/board.route.ts`, `routes/sse.route.ts`, `routes/loopback.ts`                                               | Loopback-gated REST router, the hand-rolled SSE broadcast endpoint, and the loopback request guard.                                                                                                                                                 |
| Linear + mapping    | `adapters/poller.ts`, `store/mapping.ts`                                                                                                                       | GraphQL poll loop and the pure issue-versus-card reconcile mapping.                                                                                                                                                                                 |
| Store               | `store/board.store.ts`                                                                                                                                         | Single-writer card store: serialized mutation queue, atomic persist, snapshot ordering.                                                                                                                                                             |
| Services (start)    | `services/orchestration/start-session.ts`, `services/orchestration/steps.ts`, `services/domain/kickoff.ts`                                                     | Start-saga runner, its do/undo steps, and the pure kickoff-prompt builder.                                                                                                                                                                          |
| Services (sessions) | `services/orchestration/cleanup.ts`, `services/infra/config-holder.ts`, `services/domain/workspace-paths.ts`                                                   | Teardown saga, the orchestration-config holder (routes read config through it, value-free 400 when unset), and the canonical worktree-path builder.                                                                                                 |
| Markers             | `adapters/markers/parse.ts`, `adapters/markers/scan-decision.ts`, `adapters/markers/pane-view.ts`, `adapters/markers/watcher.ts`                               | Pure marker parser, the pure per-tick decision core, the pane-view helpers, and the I/O-shell pane watcher applying one card decision per tick.                                                                                                     |
| Adapters            | `adapters/exec.ts`, `adapters/git.ts`, `adapters/tmux.ts`, `adapters/ttyd.ts`, `adapters/claude-trust.ts`, `adapters/editors.ts`, `adapters/resolve-binary.ts` | The argv-only subprocess chokepoint, the git / tmux / ttyd / claude-trust adapters over it, editor launch, and binary-path resolution.                                                                                                              |
| Shared              | `shared/types.ts`                                                                                                                                              | Pure cross-half contracts; `BoardSnapshot` is both the SSE payload and the on-disk board file.                                                                                                                                                      |
| Frontend            | `web/App.tsx`, `web/features/board/Board.tsx`, `web/features/board/Card.tsx`, `web/features/detail/DetailPanel.tsx`, plus hooks, dialogs, and sync strip       | React board: optimistic drag-and-drop, the detail slide-over with the terminal iframe, SSE hooks.                                                                                                                                                   |

## Cross-Module Invariants

### Single Writer Store

The board store (`store/board.store.ts`) is the **one mutable source of truth** for the board: a
single in-memory `Map<id, Card>` is the SOLE mutable state, and there is exactly one writer
(`BOARD-03`). Every card mutation is funnelled through ONE serialized promise queue that runs
`mutate in-memory → persist the snapshot atomically → emit "change"` to completion before the
next mutation starts, so mutations never interleave. No call site ever read-modify-writes
`board.json` directly. `write-file-atomic` prevents _torn_ files but does NOT prevent
read-modify-write _races_ — the serialized queue is what does that. Adding a second writer, or
letting an upstream producer (the poller) mutate the Map or the file out of band, reintroduces
exactly the race the single writer exists to kill: a concurrent read-modify-write can revert a
user's drag or delete a card that had already left To Do. To Do ordering is applied ONCE, on the
read path in `snapshot()` via `compareTodoOrder`, so `GET /api/board` and every SSE frame share
one canonical order and no upstream writer has to pre-sort.

Two same-column mutations are deliberately fused into a single enqueue so the broadcast can never
carry a torn intermediate frame (`WR-01`): `applyMarker` sets `column` + `statusReason` +
`lastMarker` in one mutation — a split write would broadcast a frame with the column moved but the
reason/marker not yet applied. `flipBack`, `recordTtydExit`, and `markSessionLost` follow the same
one-mutation rule for the same reason.

Column-sensitive and existence-sensitive decisions are re-checked INSIDE the mutator against the
live Map, not against a snapshot read outside the queue (`WR-04`). `setTtydPortIfSession` records
the ttyd port ONLY if the card still names that `tmuxSession`, and it runs that check inside the
queue so a `markSessionLost` enqueued ahead of it is applied first and reliably suppresses the
write; a synchronous pre-check on the live Map cannot guarantee that ordering and would revive a
dead session's port on a card that was just marked lost. `applyMarker`/`flipBack` likewise
re-read `column` inside the mutator so a queued manual drag (e.g. to Done) is never silently
reverted by a concurrently-scanned marker. The same discipline extends to the start saga's
ordering, where the restart-idempotency check (`worktreeRegistered`) is performed BEFORE the
base-ref fetch (`WR-03`): an existing-worktree restart never needs `baseRef`, so fetching first
would let an offline `git fetch` fail a restart (or record a misleading "cut from local base"
warning) for a repo that gets skipped anyway.

The store also participates in the ttyd/watcher spawn-vs-lost race: the watcher includes ttyd's
own tracked and in-flight sessions when reconciling (`WR-02`), so a ttyd spawn racing a
`markSessionLost` cannot leave an orphaned terminal — that cross-module rule is enforced in
`adapters/ttyd.ts` + `adapters/markers/watcher.ts` and referenced here only so the single-writer
picture is complete. Finally, the store is content-free in its logging: a failed persist or a
failed mutation logs only the error, never card fields, marker reasons, or pane text.

### Marker Protocol

The agent tells the board its state out-of-band through the `DISPATCH_STATUS` marker protocol: it prints
a standalone `DISPATCH_STATUS: NEEDS_INPUT — <reason>` or `DISPATCH_STATUS: DONE — <summary>` line, the watcher
scrapes the visible tmux pane, and `adapters/markers/parse.ts` turns that text into at most one card
decision. The parser (`parse.ts`) is a pure, import-free module — no subprocess, no store — mirroring
`kickoff.ts`'s "pure string builder" discipline, so both ends of the protocol are trivially reasoned
about and side-effect-free (`MARK-01`).

**Parse regex (`MARKER_RE`).** Locked to probed `claude` v2.1.201 pane output with a deliberate
tolerance envelope for agents that deviate from the kickoff template:

- The **LINE-START anchor** (`^\s*`) is the primary false-positive guard. The pane echoes the user's
  typed input and the kickoff template itself, where `DISPATCH_STATUS:` appears MID-line (after `❯ … : ` or
  `- When blocked …: `); the anchor rejects those and matches ONLY the agent's own output line
  (`DISPATCH_STATUS:` at line start under the 2-space `⏺`-block indent).
- An **optional leading `⏺ ` glyph** is tolerated: when the marker is the first line of an agent
  message the TUI prefixes the bullet, so the marker starts `⏺ DISPATCH_STATUS: …`. Echoed copies stay
  mid-line and are still rejected by the anchor.
- The **separator** accepts an em-dash (**U+2014** `—`, the exact kickoff wording), an en-dash
  (U+2013 `–`, a common LLM substitution), OR a plain hyphen `-`. The separator + reason are OPTIONAL:
  a bare `DISPATCH_STATUS: DONE` still fires the column move with an empty summary.
- The **reason/summary is captured as an OPAQUE string** (trim only) — never eval'd, parsed as code,
  or template-executed (`T-04-02`, see [Security Threat Model](#security-threat-model)). Untrusted
  agent text stays inert.

`parseLastMarker` returns the LAST (lowest / most recent) matching marker in the pane — a transcript
may hold several markers over time and the bottom one is the current state — and skips ONLY the exact
kickoff-template placeholders (`<one-line reason>` / `<one-line summary>`) so an echoed unfilled
template never fires while a real angle-bracketed reason (e.g. `need the <API_KEY> value`) does.

**Dedup — the prefix rule (`MARK-04`, `BUG-1`).** The watcher stores a LAYOUT-INDEPENDENT dedup key
`markerKey(m) = kind + " " + reason` on `card.lastMarker` and dedups on THAT, never on the raw
physical line, so a tmux rewrap/re-indent of the SAME marker (a terminal attach resizes the pane and
the TUI repaints at the new width) can never re-fire an already-consumed marker. Because
`capture-pane -J` rejoins only tmux SOFT-wraps while the claude TUI HARD-wraps its own long marker
lines with real newlines at the current pane width, the parser only ever sees the FIRST physical line
of an overflowing reason — so the parsed reason, and hence `markerKey`, shrinks or grows with the
pane width. A plain `!==` therefore re-fired an already-consumed marker on every resize (panel
open/close), yanking a manually-dragged card back and clobbering `statusReason` between full and
truncated forms. The fix (`sameMarkerKey`) treats two keys as the SAME marker when either
whitespace-normalized key is a PREFIX of the other: any two wrap-widths of one logical marker produce
prefix-related keys (the kind is always fully present at line start; only the reason's tail is cut),
and cross-kind keys never collide (`NEEDS_INPUT` is never a prefix of `DONE`). Accepted rare tradeoff:
a genuinely new reason that EXTENDS the suppressed one (`need the key` → `need the key from vault`) is
treated as already-seen; manual drag / re-emission after scroll-off corrects it, and this is
single-user localhost. When a WIDER capture later reveals more of a truncated reason, the stored key
grows MONOTONICALLY (never shrinks) toward the full reason without re-firing the move.

**Dedup-key liveness — the two-tick clear (`MARK-04` re-emission, `BUG-2` / IN-06 hardening).**
`lastMarker` is retained ONLY while the consumed marker is still physically on the pane OR the card
still sits in an attention column. Once the card is back In Progress AND no marker is visible at all
(the consumed line scrolled off the alt screen or a new turn repainted), the key is cleared so a
genuinely RE-PRINTED identical marker (the agent re-blocked for the same reason) can re-fire.
Clearing requires TWO consecutive marker-free ticks, so a single transient full-screen repaint (a
recap overlay that slipped the guard, a one-off capture hiccup) that momentarily hides the marker can
never wipe the key and let it re-fire spuriously. The re-emission itself is probe-grounded: the agent
must produce enough output to push the old marker off the visible pane before re-blocking, which the
2s poll observes as a marker-free capture.

**Flip-back on new output (`MARK-03`).** A NEEDS_INPUT card returns to In Progress once the agent
produces new output after the human replied — the concrete divergence test lives in
[Watcher Discriminator](#watcher-discriminator).

**Byte-identical two-file contract (`NEW-07`, `NEW-08`).** The two status-marker lines emitted by
`services/domain/kickoff.ts` are byte-identical to what `parse.ts` `MARKER_RE` matches — the wording is
a CONTRACT BETWEEN THE TWO FILES (do-not-change contract 7). Their separator is an em-dash
(**U+2014**, `—`); paste fidelity for it was EXPLICITLY VERIFIED (02-RESEARCH § "Pattern 4" / Probe
1: the em-dash survives tmux capture byte-for-byte) and it must NOT be replaced with a plain hyphen —
`MARKER_RE` matches the em-dash and the kickoff wording is what the agent is instructed to echo. A
change to the tokens (`NEEDS_INPUT`/`DONE`), the placeholders (`<one-line reason>` /
`<one-line summary>`), or the em-dash on EITHER side silently breaks the protocol on the other side.

### Watcher Discriminator

The pane watcher (`adapters/markers/watcher.ts`) is one 2s self-rescheduling loop that scrapes every
active session's visible tmux pane, parses `DISPATCH_STATUS` markers, and applies AT MOST ONE atomic store
decision per card per tick (move to Needs Input / Agent Done, or flip a Needs-Input card back to In
Progress once the agent responds). The loop shape mirrors `adapters/poller.ts`: a self-rescheduling
`setTimeout` (never a fixed-interval timer, which could overlap if a tick's serial captures run
long), `timer.unref?.()` so it never pins the process, an immediate first run, and a per-tick
try/catch so one failure never kills the loop. Captures run SERIALLY per tick so one card's slow or
failed capture never parallel-fans the tmux load. This is the single most battle-scarred subsystem in
the project: the `⏺` structural discriminator below cost FOUR smoke reruns to converge, and a lossy
paraphrase of any rule here reintroduces the most expensive bug class in the project's history — so
each concrete failure mode is carried VERBATIM.

**Capture scope — visible pane only (`RATIFIED` amendment).** Claude Code runs on the tmux ALTERNATE
screen (`alternate_on=1`, `history_size=0`), so tmux accrues ZERO scrollback — `capture-pane -S`
returns nothing beyond the visible pane. The watcher therefore captures the VISIBLE PANE ONLY (no
`-S`). This is safe because NEEDS_INPUT/DONE fire when the agent stops and waits, parking the marker
on the visible pane where the 2s poll reliably catches it (probed to persist across idle). Captures
use `-J` so tmux-soft-wrapped lines are rejoined (keeping parse/diff text layout-independent) and
exact-name `=<session>:` session-qualified targeting.

**The `⏺`-anchored agent-output view — the structural discriminator (`MARK-03`).** `MARK-03`'s real
meaning is "the agent produced new output after the user replied". Instead of diffing the whole
stripped pane body, the flip-back compares only the AGENT-OUTPUT VIEW: the `⏺`-anchored lines of the
stripped body, joined (`agentOutputView`). Claude renders every assistant/tool block with a leading
`⏺` bullet (U+23FA), and a real reply ALWAYS begins a new `⏺` block in the visible pane's bottom
region. TUI CHROME — tips, notification rows (`View Observations Live @ …`), timed hints,
recap/suggestion variants, the ghost `❯` line, the context bar (`Fable N │ … ░░ N%`) and mode line
(`⏵⏵ …`, glyph U+23F5, NOT the `⏺` U+23FA bullet) — is NEVER `⏺`-prefixed. So no chrome repaint can
change this view, which STRUCTURALLY closes the open-ended false-flip class: three distinct chrome
classes were whack-a-moled before a fourth appeared, and anchoring on `⏺` ends that game (chrome
never emits a `⏺` block, so it can never flip a card). The one anatomically-impossible non-flip case
(an empty baseline whose reply also emits no visible `⏺`) cannot occur, because the reply's own block
appears at the pane bottom.

**Baseline volatility strip (`BUG-2` border match).** Before taking the view, `stripVolatile` cuts
the REPL input box's footer and filters spinner/timer lines (`✻ ✽ ✶ ·`) and `❯`-prefixed
prompt/input lines (typed-but-unsubmitted input, ghost suggestions, echoed prompts — never agent
OUTPUT). Anchoring the cut on the input-box BORDER (bottom-up scan) tracks the footer's real height,
which notification rows, tips, plan/permission-mode rows and auto-compact warnings vary across
versions; a fixed line count would leak volatile rows into the "stable" body (false flip-backs) or
drop real transcript tail. `BUG-2` fix: this claude version draws the box top border as a PLAIN
horizontal rule (`─────…`) with NO `╭`/`┌` corner glyph, so the original `/^\s*[╭┌]─/` anchor NEVER
matched and the drop-5 fallback was silently always in effect (leaking volatile footer rows → false
flip-backs); making the corner optional and requiring a run of box-drawing dashes (`[╭┌]?─{3,}`)
matches both forms. The bottom-up scan cuts at the SECOND-lowest border (the input box's TOP border)
so the input-box interior — where v2.1.201 paints a dim ghost "suggested reply" ~10s after every turn
— is not mistaken for agent output (smoke rerun case 8).

**Recap-overlay guard (`BUG-2`).** After a few minutes idle, claude v2.x repaints the WHOLE screen
with a `※ recap: … (disable recaps in /config)` block at CONSTANT width. That overlay hides the
marker and diverges from the flip-back baseline, so — untreated — it BOTH false-flips a still-blocked
card AND (next tick) wipes the dedup key. `isRecapOverlay` detects it tolerantly by the `※`
reference-mark glyph at line start (it appears in the recap header, not in normal transcript body or
the footer/spinner set `✻✽✶·`, so it never matches a live working pane). When detected, the tick is a
NO-OP for ALL decisions (skip the dedup-key clear AND flip-back), leaving `lastMarker`, baseline, and
the marker-free streak untouched so the next real transcript tick resumes cleanly.

**Geometry guard — fetch BOTH width AND height (`NEW-03`).** The flip-back snapshots the baseline
view alongside the pane geometry (`width`, `height`) it was captured at, and re-snapshots (never
flips) whenever geometry changes. Both dimensions are fetched in one `paneSize` display call because
BOTH a ttyd attach AND a ttyd detach resize the window and hard-rewrap the transcript, changing
`⏺`-line TEXT at the new size WITHOUT any agent activity. A WIDTH-ONLY guard missed the DETACH case:
the Phase-5 sweep-kill of an orphaned ttyd client shrinks the pane HEIGHT (14→12) at CONSTANT WIDTH,
which reflows the transcript → rewrap → false-flip of a still-blocked card. Tracking `height`
alongside `width` closes that case: any width OR height change invalidates the baseline and triggers
a re-snapshot at the new size instead of a flip.

**NaN pane-size must throw (`NEW-04`).** A NaN pane size must be treated as a capture failure and
THROW. If it silently returned NaN instead, the geometry comparison (`width !== cached.width ||
height !== cached.height`) would compare UNEQUAL FOREVER (`NaN !== NaN`), re-snapshot the flip-back
baseline every single tick, and thereby SILENTLY DISABLE flip-back — a needs_input card would never
return to In Progress even after the agent replied. Throwing routes it through the same
session-vanished-mid-tick path that skips the decision cleanly.

**Two-tick flip-back debounce.** Flip-back requires the agent-output divergence to PERSIST for TWO
consecutive ticks (`divergentTicks >= 2`) before flipping, mirroring the two-tick marker-free clear.
A baseline snapshotted while the reply was still settling can diverge for one tick then re-converge
with NO real reply; a single-tick flip would false-flip it. The debounce exists here — but
deliberately NOT for the unseen-activity dot below — because a false FLIP-BACK is DESTRUCTIVE (it
yanks a card out of the attention column) whereas a false dot is merely COSMETIC and self-heals on
the next panel open. Cost: ~2s extra latency before a genuine reply flips the card back.

**Unseen-activity dot baseline (`ATTN-02`).** The board lights an unseen-activity dot when a session
produces new output the user hasn't looked at. It diffs the SAME `⏺`-anchored, chrome-immune
agent-output view — but against a DEDICATED per-session baseline map (`agentViews`), deliberately NOT
the flip-back `sessions` map. The two maps must stay separate: the flip-back map is DELETED on
flip-back and Agent Done, and entangling the two would corrupt both state machines. The dot's first
observation SEEDS only (never fires) so a backend boot doesn't light a dot on every live session; a
later divergence re-baselines forward and stamps the card's `outputChangedAt`. It fires on the FIRST
divergence with NO debounce (the flip-back's 2-tick debounce exists only because a false flip-back is
destructive; a false dot is cosmetic). The dot works in ANY column (including Done) because it is
orthogonal to the marker/flip-back decision. The `.tsx` consumer sites (`Card.tsx`,
`DetailPanel.tsx`, `useUnseenActivity.ts`) are homed by this section, not by JSDoc; the panel-side
`lastOpened` stamping discipline (open/close stamps plus the deferred re-stamp that absorbs the ttyd
detach reflow) is homed in [Panel Iframe Identity](#panel-iframe-identity).

### Attention Routing

Genuine column transitions INTO an attention column (`needs_input` / `agent_done`) fire exactly
ONE OS desktop notification per card (`web/hooks/useTransitionNotifications.ts`, `ATTN-01`). The hook
compares each card's column against a per-card previous-column ref taken from the previous SSE
snapshot; a notification fires only when the column CHANGED into `needs_input` or `agent_done`.
**Seed-on-reconnect is the load-bearing discipline:** the FIRST snapshot after connect/reconnect
only SEEDS that previous-column ref — it never notifies — so a backend reboot or an SSE reconnect
(which re-broadcasts the full board, potentially with cards already sitting in an attention
column) can never spam notifications. The mechanics mirror `useBoardStream`'s ref +
connection-reset discipline: refs (not state) so firing never triggers a re-render, and the
`seeded` flag is RESET on every disconnect so the first frame after recovery re-seeds instead of
notifying. Permission is requested ONCE on first load; when denied or unsupported the feature is
silently absent (never re-prompted, never throws), and the `Notification` constructor is wrapped
in try/catch because it can throw even with permission granted (page-scoped notifications
disallowed on some webviews) — a cosmetic notification must never crash the board. Clicking a
notification focuses the window and opens that card's DetailPanel; the title uses the
human-readable column label and the card identifier, never the raw column key.

The related unseen-activity dot (the SAME attention surface, a different trigger) is homed in
[Watcher Discriminator](#watcher-discriminator) — `@see` that section for the dot's
seed-on-first-observation baseline and why it deliberately carries NO flip-back debounce.

### Resilience and Reconcile

The backend is restart-safe by design: tmux and ttyd, not the backend process, are the source of
truth for live sessions. Two mechanisms keep card state honest across a `tsx watch` reload, a crash,
or a full reboot — a boot-time reconcile pass (`bootstrap/reconcile.ts`) that runs ONCE at startup,
and a runtime dead-session detector inside the pane watcher — and both lean on the tmux adapter's
tolerant swallow-to-default behavior (`NEW-10`).

**Runtime dead-session detector — 3 consecutive capture failures (`RESIL-01`).** The watcher counts
consecutive `capture-pane` FAILURES per session; three in a row (~6s at the 2s tick) means the tmux
session is genuinely gone, so the card is marked session-lost (`store.markSessionLost` clears
`tmuxSession`, drops the card out of `cardsWithSession()`, and makes it Restart-able instead of
frozen in a silent warn-once state). The threshold of 3 is what makes it safe against the two BENIGN
transient cases and is why neither can false-trip it: a `tsx watch` reload kills the whole backend
process before three failures can accrue, and boot reconcile re-validates a still-live session at
startup — so only a REAL mid-run kill ever reaches 3. Any successful capture resets the streak to
zero. Accepted tradeoff: a session wedged (uncapturable) for >6s but eventually recoverable is
marked lost, which the user simply Restarts — never destructive to the workspace or branch. Done
cards get NO dead-session detection: a mid-cleanup kill must never be marked session-lost, because
the cleanup mutation clears `tmuxSession` moments later anyway.

**Boot reconcile — persisted-name comparison (`IN-01`).** For every card that still holds a session,
reconcile compares against the PERSISTED session name (`card.tmuxSession`), falling back to the
derived `dsp-<identifier>` ONLY when absent. Linear identifiers change when an issue moves teams: the
poller upserts the new identifier while `tmuxSession` still names the old, live session, so a
derived-name comparison would diverge and mark a running card lost. Comparing against the recorded
truth avoids that.

**Boot reconcile — skip To Do and Done (`IN-03`).** A card the user parked in Done, or an
interrupted-saga card still in To Do, must never receive the destructive "Session lost" + Restart
line: Restart's `completeStart`/`attachExistingSession` would promote it to `in_progress` — the only
path that yanks a card out of Done without a drag. The watcher's runtime detector never
dead-session-detects todo or done cards — todo is skipped outright at step 0, before any capture is
spent, while done cards still GET the step-1 capture so the ATTN-02 unseen-activity stamp works in
any column, but stay marker-ineligible and bail out of dead-session detection on capture failure (a
deliberate cleanup kills the session moments before clearing `tmuxSession`, and the detector must
not race that into a spurious session-lost). Reconcile mirrors the same column guard, protecting
BOTH columns symmetrically even though a todo card cannot hold a live session post-load.

**Empty-map baseline recovery (`IN-02`).** Two in-memory maps are empty after any backend restart,
and both recover by SEEDING on first observation rather than firing. `listSessions()` returns an
EMPTY Set on a dead/absent tmux server (see `NEW-10` below), so if the whole server is gone every
session card degrades cleanly to session-lost instead of crashing reconcile. Symmetrically, the
watcher's flip-back `sessions` map is empty after a restart, so a `needs_input` card flipped into
that column BEFORE the restart has no baseline to diverge from; the watcher snapshots the baseline
on the first tick and never flips on it, resuming flip-back only on the next real transcript
divergence.

**Two-tick hardening and orphan teardown (`IN-04`, `IN-06`).** Per-session map cleanup plus
orphaned-ttyd teardown runs at the END of each watcher tick, recomputing the live session set AFTER
the scan loop so any `markSessionLost` from this tick is already reflected; every tracked session key
no longer live is dropped from all of the watcher's per-session maps and its now-orphaned ttyd is torn down
(`killTtyd` wired in the watcher, not the store, so the import direction stays acyclic
`watcher → ttyd → store`). Two decisions are debounced across TWO consecutive ticks so a single
transient full-screen repaint (an idle recap overlay, a one-off capture hiccup) can never trip them:
the dedup-key clear (`IN-06`, detailed in [Marker Protocol](#marker-protocol)) and the flip-back
divergence (detailed in [Watcher Discriminator](#watcher-discriminator)).

**Tolerant swallow-to-default (`NEW-10`).** The three tmux query/teardown adapters never let a
dead/absent server crash a caller — they degrade to a safe default. `hasSession` returns `false` on
any error (a dead tmux server means "no session", and this is the idempotency probe: an existing
`dsp-<id>` session → reattach, never recreate). `listSessions` returns an EMPTY Set on BOTH no-server
conditions — `no server running on <sock>` (server dead) and `error connecting to <sock> (No such
file or directory)` (socket absent) — which IS the entire boot-reconcile tolerance requirement.
`killSession` swallows failure so the rollback/undo path is idempotent (killing an already-gone
session is a no-op success). The full teardown sequence and its delete-before-kill ordering live in
[Cleanup Lifecycle](#cleanup-lifecycle).

### In Review Lifecycle

`in_review` is a sixth column that sits between Agent Done and Done. Unlike Done, it is a LIVE
holding column, not a parked one, and the entire contract below falls out of the codebase's
exclusion-based column guards WITHOUT special-casing `in_review` in any of them.

**In Review is live, not parked (`REVIEW-01`).** Because every column guard excludes only `todo`
and/or `done`, `in_review` inherits the same treatment as `in_progress`/`agent_done` for free:
it is marker-ELIGIBLE (a fresh `NEEDS_INPUT`/`DONE` marker still moves the card OUT to
needs_input/agent_done — the `applyMarker` guard excludes only `todo`/`done`), runtime
dead-session detection stays ON (the watcher's 3-strike detector skips only `done`, so a killed
In Review session is marked session-lost like any live column — this is what powers the Resume
affordance), `/start` (Restart) is NOT blocked (only `done` 409s), and the past-To-Do reconcile
rules apply (the poller never re-upserts it and keeps + gone-flags it if the Linear issue
vanishes). Dragging a marker-carrying card INTO In Review consumes the marker: `moveCardManual`
leaves `lastMarker` untouched, so the still-visible marker is deduped against the persisted key
and the card never bounces straight back out (MARK-04 drag-wins). Any drop into In Review is a
plain optimistic move — To Do → In Progress remains the only orchestrating drop. Cleanup teardown
remains Done-ONLY: In Review inherits NONE of Done's parked semantics or teardown wiring, so its
session, terminal, and worktrees stay alive until an explicit drop into Done.

**Resume is column-preserving by construction (`REVIEW-01`).** When an In Review session dies, the
panel offers Resume, which relaunches `claude --continue` in the preserved `card.workspacePath`
cwd with NO kickoff prompt re-sent. Its store mutation sets `tmuxSession` and clears `sessionLost`
but DELIBERATELY never writes `column` — deliberately unlike `completeStart`/`attachExistingSession`,
which force `in_progress`. This is how Resume coexists with the [Resilience and Reconcile](#resilience-and-reconcile)
`IN-03` hazard: `IN-03` protects against a non-drag column promotion yanking a card out of a
parked column, and a column-preserving mutation performs no promotion at all — it is structurally
incapable of moving the card, which is exactly why it is safe to run on an In Review card.

### Terminal ttyd

The per-session ttyd manager (`adapters/ttyd.ts`) spawns, tracks, and reuses a writable,
loopback-only web terminal attached to an existing `dsp-<identifier>` tmux session, so the live
`claude` REPL can be embedded in the detail-panel iframe (`TERM-01`). Its invocation is fixed and
load-bearing: `ttyd -W -i 127.0.0.1 -p 0 -t disableLeaveAlert=true -t
fontFamily=<bundled Nerd Font family> -t fontSize=15 -t theme={...dark ITheme...} tmux attach -t
=<session>`. The `fontFamily`/`fontSize`/`theme` values are fixed, server-authored constants (never
Linear- or user-sourced) forwarded to xterm's `Terminal` constructor over ttyd's own
`SET_PREFERENCES` websocket frame post-connect (`TERM-02`); the theme's hex/rgba values are
hardcoded because the ttyd client is a separate origin/process that cannot read dispatch's
`tokens.css` custom properties.

**Writable + loopback are BOTH mandatory.** `-W` (writable) AND `-i 127.0.0.1` (loopback-only bind)
are each required and neither may be dropped: a missing `-W` yields a dead read-only terminal, and
an all-interfaces bind would expose an unauthenticated writable shell to the LAN. Never bind a
routable interface. This is the same control recorded as `T-03-01`/`T-03-02` in the
[Security Threat Model](#security-threat-model) — `@see` that table for the STRIDE home; this
section records the operational shape. The spawn is argv-array only (never a shell string): only
fixed strings plus the caller-validated `session` (`dsp-` + a route-checked identifier) enter argv,
which is the injection defense.

**Kernel-assigned port, parsed from stderr.** `-p 0` lets the kernel pick a free port (no
find-then-bind TOCTOU race). ttyd writes the chosen port to STDERR as `Listening on port: N`; the
manager pipes stderr, matches that line, then TCP-confirms the port is accepting connections before
reporting readiness (the port line appears slightly before the socket accepts, and the browser
cannot probe the cross-origin ttyd port itself). Both waits carry a tolerant 10s cap (cold
first-spawn-per-boot measured ~5s).

**Patched served index — named independent patches.** Boot provisioning (`provisionTtydIndex`,
`bootstrap/ttyd-index-setup.ts`, fire-and-forget after reconcileSessions) captures ttyd's stock
served index and applies a list of named independent patches, in order: `font-load-gate` (defers
`terminal.open()` behind a `Promise.race` of `document.fonts.load()` and a 1500ms timeout, so
glyph width/metrics measure against the bundled Nerd Font instead of a browser fallback — fixes
Nerd Font PUA icon tofu; `TERM-01`), `cmd-click-weblinks` (modifier-gates `WebLinksAddon`'s
plain-text URL click handler), `cmd-click-osc8` (sets `terminal.options.linkHandler` so OSC-8
hyperlinks from real Claude Code `⏺` output are Cmd/Ctrl-gated instead of xterm's stock ungated
confirm-and-open), `shift-enter` (`attachCustomKeyEventHandler` sends raw LF via the Dispatcher's
own `sendData` so Claude Code inserts a newline instead of submitting; keydown-only,
IME-composition-safe, exact Shift+Enter with no Ctrl/Alt/Meta), and `font-face-inject` (injects a
base64-inlined `@font-face` for the bundled Nerd Font woff2 at the served index's sole `</style>`
anchor; `TERM-01`). `font-load-gate` must stay FIRST and `font-face-inject` LAST — the load-gate's
target string is a superset of the two link/newline patches' own anchors, so it re-emits both
verbatim inside its wrapping `.then()` to keep their exact-count-1 matches intact downstream. Each
patch is anchored to an exact-count-1 literal in the captured bundle; a drifted anchor skips ONLY
that patch with a boot warning naming the disabled feature — the other patches still apply. The
artifact is written whenever at least one patch applied, so "artifact exists" (spawnTtyd's
conditional `-I` below) now means "at least one patch applied this boot", and artifact-absent means
every patch failed and the terminal serves fully stock ttyd/xterm.js behavior. Both link patches
keep the reverse-tabnabbing guard (`window.open()` then `opener=null` before navigating) from the
[Security Threat Model](#security-threat-model) — `@see` that table for the STRIDE home — and
nothing about this patch pipeline changes the loopback-only bind above.

**tmux must be granted the `hyperlinks` terminal-feature, or `cmd-click-osc8` has nothing to
resolve.** `cmd-click-osc8` patches the BROWSER side of link activation, but the OSC 8 bytes
themselves have to reach the browser first — and tmux's own default `terminal-features[0]` entry
for `xterm*` (`clipboard:ccolour:cstyle:focus:title`) omits `hyperlinks`. Without it, tmux's grid
tracks a real Claude Code `⏺` output's OSC 8 hyperlink internally (`capture-pane -e` proves the
escape exists server-side) but never forwards it to an attached client's byte stream — xterm.js's
`OscLinkProvider` then has zero cells with the extended `urlId` attribute to resolve, no matter how
correct the browser-side patch is (live-discovered defect, 59-02-SUMMARY.md). `ensureHyperlinksTerminalFeature`
(`adapters/tmux.ts`) grants `xterm-256color:hyperlinks` — the exact TERM string ttyd's spawn argv
above declares — idempotently (`tmux show -g terminal-features` checked before `set -ag`, since it
is a tmux SERVER-global option that would otherwise duplicate on every backend restart across the
tmux server's much longer lifetime) and never throws. It runs at boot AND after every successful
`newSession`: tmux does not auto-start a server for `show`/`set`, so with no server alive (the
normal post-reboot state) the boot-time call fails outright, and tmux's default `exit-empty on`
kills a sessionless server — server options do not persist — so a mid-run server restart loses
the grant too. Session creation is the one moment a live server is guaranteed, which is where the
grant self-heals; the no-server failure at boot is expected and silently skipped.

**Not through the exec chokepoint — ttyd is a long-lived daemon.** Unlike every git/tmux call, ttyd
does NOT route through `adapters/exec.ts` `run()`: `run()` (promisified `execFile`) resolves only on
process exit, so awaiting a daemon would hang forever. ttyd is spawned directly with piped stderr
and `detached` + `unref()` so a `tsx watch` reload cannot kill a live agent terminal. ttyd also does
NOT self-terminate when its tmux session dies, so this manager — never tmux-session liveness — owns
tracking and teardown.

**Single-flight spawn (`T-03-07`).** `ensureTtyd` records an in-flight promise SYNCHRONOUSLY (before
its first await) so a React StrictMode double-effect or two near-simultaneous POSTs share ONE spawn;
otherwise the loser leaks an orphan ttyd that later fires a FALSE `died` signal. The exit handler
reconciles only the currently-tracked child (a stale/replaced child exiting is a no-op), and it
records the exit in ONE atomic store mutation so no intermediate frame can trip the panel's
ensure-on-open auto-respawn. Deliberate teardown (`killTtyd`) deletes the tracked entry BEFORE
killing the child so the exit handler sees no tracked entry and does not flag a spurious `died`
error — a kill is teardown, not death (delete-before-kill teardown ordering lives in
[Cleanup Lifecycle](#cleanup-lifecycle)).

**Orphan-sweep fingerprint.** The boot-time sweep (`killAkTtydOrphans`, `RESIL-01`) kills every
untracked `ttyd … tmux attach` process — after any restart the in-memory maps are empty, ports were
cleared on load, and the panel re-ensures on open, so a fresh spawn always beats adopting a
possibly-broken ttyd. Because ttyd rewrites its own proctitle and STRIPS the `=dsp-<session>` target,
dsp-scoping is impossible; the fingerprint is deliberately `basename(argv[0]) === "ttyd"` AND argv
includes both `tmux` and `attach`, with own pid/ppid skipped. This is the app's unique signature on
this single-user host — a full-command-line substring match would self-match the backend, so the
sweep parses `ps` and inspects `argv[0]` instead. It logs only the killed COUNT (never PIDs or argv,
`T-04-04`) and tolerates a `ps` failure by returning 0 rather than crashing boot. Broadening this
fingerprint to over-match a non-dsp `ttyd`/user process is a denial-of-service hazard — keep it
exact.

### Panel Iframe Identity

The `DetailPanel` (`web/features/detail/DetailPanel.tsx`) embeds the live terminal as a ttyd `<iframe>` whose
identity across every panel interaction is load-bearing: any remount of that iframe drops its ttyd
WebSocket and detaches the tmux client, killing the visible terminal mid-session. The whole panel is
engineered around never remounting that one element. `DetailPanel.tsx` is one of the four
invariant-dense files; its rules live here so a Phase 12/13 restructure — and the docked-mode
re-derivation below — can preserve them without reading the original body comments.

**The ttyd iframe is a single, always-rendered, never-keyed element (`PANEL-03`).** For a live
session the terminal region is exactly one `<iframe src="http://127.0.0.1:${ttydPort}">` rendered at
a FIXED position in the JSX tree, and it must stay identity-stable across four separate mutations:

- **Conditional siblings render FIRST, at a stable index.** The expandable Details slot rides an
  INDEPENDENT conditional slot placed BEFORE the terminal region; when collapsed it evaluates falsy
  and the terminal reclaims full height, when expanded it caps at 40% and scrolls. The terminal
  region stays a byte-identical sibling at the SAME index regardless, so toggling Details never
  reorders the tree and never remounts the iframe. Any refactor that moves the iframe's position
  (or wraps it conditionally) reintroduces the remount.
- **Fullscreen is a STYLE-ONLY change, never a remount.** Fullscreen toggles ONLY the enclosing
  `<aside>`'s `width` (`480px`↔`100vw`) and `borderLeft`; `top`/`right`/`height`/`transform` and the
  `transition` list (which names transform ONLY) stay constant, so the width/border change snaps
  instantly and the iframe reflows exactly ONCE with no unmount and no WebSocket reconnect. Fullscreen
  is per-open React state, never persisted.
- **The iframe is NEVER keyed, and reset-on-open is done in render, not by remount.** A `key=` on
  the panel or a remount to reset per-open state (Details collapsed, fullscreen off) is deliberately
  NOT used — it would remount the ttyd iframe. Instead the panel tracks the previous card id in state
  and adjusts state DURING render (the React state-adjustment-on-prop-change pattern) so a new card
  opens in the default terminal-first view with no stale-styled frame ever painted — a post-paint
  effect would commit one frame of the new card in the old card's styling before snapping back. The
  same render-time guard drops fullscreen/details if a session dies while expanded, safe because the
  terminal subtree is already unmounted at that point.
- **Unmount is deferred ~200ms after close, then forced.** On close the last shown card is RETAINED
  so its content stays visible through the ~150ms close slide instead of blanking; a timer then
  CLEARS it at 200ms (200 > 150). Without that clear a closed session card's ttyd iframe would stay
  mounted off-screen forever with its WebSocket open and a tmux client attached. This is the one
  place the iframe is intentionally unmounted — and only after it has left the viewport.
- **The `sandbox` attribute is fixed at the iframe's last navigation (WHATWG spec), so changing its
  value in code is forward-only.** A session already open when the sandbox value changes (e.g. the
  `52-01` cmd+click patch adding `allow-popups allow-popups-to-escape-sandbox`) keeps its OLD sandbox
  flags for the rest of its lifetime — no reload logic exists or is needed, because `src` never
  changes for a live session either (the same PANEL-03 no-remount guarantee). Any NEW session opened
  after the code ships gets the current value at first mount, identically to any other prop.
- **The left-edge resize handle's drag shields the iframe with a drag-duration overlay, not
  `setPointerCapture` alone.** `setPointerCapture` only overrides hit-testing within the SAME
  top-level browsing context; a cross-origin `<iframe>` is a separate browsing context, and a
  live, 5/5-reproduced defect (headless and headed Chrome) showed `pointerup` never reaching
  `window` at all when the release happened to land over the iframe's rendered area — the drag
  would silently abandon mid-resize, leaving `document.body.style.cursor` stuck and the orphaned
  listeners hijacking the next unrelated click with stale coordinates. `handleResizePointerDown`
  now appends a transparent, full-viewport `position: fixed` div at `document.body` (max `zIndex`,
  `cursor: col-resize`) for the drag's duration only — mounted imperatively on `pointerdown`,
  always removed by a single idempotent `teardown()` shared across `pointerup`, `pointercancel`,
  mid-drag Escape (which cancels the drag and restores the pre-drag width instead of closing the
  panel underneath an active drag), and unmount — so the pointer's hit-test target never leaves
  the top document, regardless of
  where over the panel the release occurs. The overlay is a `document.body` sibling, never nested
  inside the `<aside>` or the iframe subtree, and never persists once the drag ends (PANEL-03
  untouched: no key/re-parent/position change on the panel itself). Because the overlay is only
  ever removed by a delivered end event, the drag must NEVER start for a non-primary button
  (`e.button !== 0` guard, first statement): a secondary click opens the native context menu,
  Chrome then delivers neither `pointerup` nor `pointercancel` for that pointer, and the max-z
  overlay would strand permanently — shielding every element in the app until a full reload. The
  handle itself is not rendered in fullscreen (mirroring the board's `resizeDisabled` guard): a
  fullscreen drag would visibly shrink the `100vw` panel then snap back while persisting an
  invisible width, and its absence means a drag can never span a fullscreen transition — the
  pointerup width write is always the plain `clamp()` form.

**Docked (Orca) mode is a SECOND style-only derivation of the same `<aside>`, re-deriving `PANEL-03`
for a second surface.** `position` stays `fixed` in BOTH modes — only `top`/`left`/`width`/`height`/
`borderLeft`/`transform`/`transition` branch on the `docked` prop, the exact same category of change
the fullscreen precedent above already proved remount-free; a `position` mode switch was deliberately
rejected as a larger reflow than adjusting `top`/`left`/`width` in place. The backdrop `<div>`, the
close `X`, and the fullscreen toggle are conditionally UNMOUNTED when docked — safe because all three
are stateless, decorative siblings outside the iframe subtree, never the terminal itself; the
docked-and-empty-selection state (centered "Select a ticket" copy) renders only when
`docked && card == null`, so the card-present subtree — and the terminal's position in it — is
identical in both modes. The Orca side nav (`web/features/orca/`) never renders a terminal: it holds
zero imports of `TerminalRegion` or `<iframe>` (grep-enforced), is pure navigation chrome, and drives
the SAME `selectedCardId` the board/inbox views already write to. The ensure-terminal spawn guard
below stays a single ref BY CONSTRUCTION: one `selectedCardId`, one hoisted panel, means "the same
card open in both views at once" is structurally impossible, so no per-card guard `Map` is needed — a
future genuinely-second terminal-rendering surface (not this phase) would be the trigger to revisit.

**ATTN-02 `lastOpened` stamping — open, close, and ONE deferred re-stamp.** The panel stamps
`lastOpened` for a live-session card when its panel OPENS and again when it CLOSES (the effect
cleanup runs on close or when switching cards). Opening clears the unseen dot; the close-stamp masks
any `outputChangedAt` accrued while the panel was open — including pane geometry-rewrap noise the
backend deliberately does NOT guard against — so the dot stays clear until genuinely new output. The
stamping is keyed on card id + session presence so it fires once per open, not on every SSE frame;
non-session cards never stamp. The close ALSO schedules ONE deferred re-stamp ~5s later: unmounting
the ttyd iframe detaches the tmux client, which reflows the pane AFTER the close-stamp — the next
watcher tick (≤2s) would see the rewrapped `⏺`-view and stamp `outputChangedAt` past `lastOpened`,
painting a false unseen dot on the card the user just finished reading. Re-stamping once ~5s later
absorbs that detach reflow. The timer is deliberately NOT cancelled on re-open: an extra stamp only
re-clears the dot, and the stamp is crash-safe (localStorage fully try/catch-wrapped), so a stale
timer can never throw or mis-flag. The dot's watcher-side baseline is homed in
[Watcher Discriminator](#watcher-discriminator).

**Ensure-terminal spawn guard — set synchronously, released on port-confirm, reset on failure and on
close.** Lazily ensuring a ttyd terminal when a session card is opened is a pure side-effect
(`POST /terminal`) with no natural idempotency, so it is gated on a ref that records which card the
spawn already fired for — React StrictMode double-invokes effects in dev, and without the guard the
panel would double-POST the same spawn. The POST fires at most once per card open; the outcome
(`ttydPort` / `terminalError`) arrives over SSE. The guard's lifecycle is load-bearing:

- **Released on port-confirm.** A confirmed `ttydPort` means the spawn episode is complete, so the
  guard is RELEASED. This is what lets the terminal re-ensure after an SSE reconnect: a backend
  restart clears the stale `ttydPort` on load and re-broadcasts `ttydPort=null` over the reconnected
  stream — without releasing the guard, the ref would still equal the card id, the id-mismatch gate
  would stay shut, and the panel would strand on a dead iframe until a full page reload. Releasing on
  port-confirm is safe: the port-present branch never spawns, so it cannot double-POST.
- **Reset on a failed POST.** A failed POST (e.g. backend mid-restart under `tsx watch`) produces no
  SSE outcome, so keeping the guard set would strand the panel on "Connecting to terminal…" forever;
  it is reset (only if still owned by that card) so the next frame retries.
- **Reset on close.** Closing the panel (card → null) resets the guard so re-opening re-triggers a
  fresh spawn; switching directly to a different card re-fires because the id no longer matches.

**Two-stage Esc, and Esc-inside-terminal reaches claude (`PANEL-03`).** A `keydown` listener bound on
`window` (no trap, no capture, so it never intercepts other keystrokes) implements two-stage Esc: in
fullscreen the first Esc exits fullscreen and the panel STAYS open, otherwise Esc closes the panel;
`fullscreen` is in the effect deps so the handler always reads the current value. Because the ttyd
iframe is a SEPARATE browsing context, an Esc typed while focus is inside the terminal reaches claude
and never fires this window handler — the two-stage close only responds to Esc pressed outside the
terminal.

**Open-editor path (`PANEL-04`).** Live-session cards additionally offer "Code"/"Cursor" buttons that
open the card's workspace folder in VS Code or Cursor. Availability is detected ONCE at boot:
`adapters/editors.ts` resolves the absolute `code`/`cursor` paths via `resolveBinaryPath` (`adapters/resolve-binary.ts`), holds
them module-private, and exposes ONLY availability booleans on the board snapshot — the absolute
paths never leave the module. The buttons render only when the editor is available AND the card has a
`workspacePath`; clicking fires `openEditor(card.id, editor)` fire-and-forget. The backend launch
(`POST` open-editor route → `launchEditor`) validates synchronously (400 before any async work, no
path ever echoed in a body, `T-06-02`/`T-06-03`) then spawns through the argv-array chokepoint
(`exec.run`) with the SERVER-owned `card.workspacePath` as a SINGLE argv element — never a shell
string, never a client-supplied path. The launch is a fast GUI hand-off (do NOT hand-spawn a detached
process); on a stale boot-resolved path (Homebrew relink, editor moved) it re-resolves ONCE, refreshes
the module cache, and retries a single time before rethrowing to the fire-and-forget `.catch`.

### Tmux Invocations

The tmux adapter (`adapters/tmux.ts`) is argv-only — every call routes through `run()`
(`adapters/exec.ts`) as an `execFile` argv array, never a shell string, and only fixed
server-generated strings enter argv (session names are `dsp-` + a route-validated identifier; ticket
text reaches tmux ONLY as the load-buffer FILE, never as a command-line element, `T-04-01`). The
exact command shapes are machine-verified against tmux 3.6a and pinned as do-not-change contract 5;
three of them carry traps that a refactor must not paraphrase away.

**Geometry `200×50` is MANDATORY (`NEW-01`).** `newSession` runs
`tmux new-session -d -s <name> -c <cwd> -x 200 -y 50 <...commandArgv>`. The explicit `-x 200 -y 50`
geometry is required for sane `capture-pane` output BEFORE any client attaches: without it the
detached pane has a tiny default size, the claude TUI paints into that cramped geometry, and both
readiness detection and `DISPATCH_STATUS` marker parsing become unreliable. It is load-bearing, not
cosmetic.

**Submit Enter is a SEPARATE send-keys AFTER the paste settles (`NEW-06`).** The kickoff prompt is
delivered by loading it into a named tmux buffer and bracket-pasting it (`paste-buffer -p`), then
submitting with an INDEPENDENT `send-keys <target> Enter`. The newline must NEVER be folded into the
paste: bracketed paste arrives as one message, and a folded-in Enter fires the prompt before the
full text has landed in the input box, submitting a truncated kickoff. The separate Enter, sent
after the paste settles, is the only reliable submit.

**The `=<name>:` exact-name trap (`NEW-13`).** Every pane target that names a specific session uses
the `=<name>:` form (e.g. `capture-pane -t =<session>:`, `ttyd … attach -t =<session>`). The leading
`=` forces EXACT-name matching — tmux target resolution otherwise falls back to PREFIX/fuzzy
matching, so with `dsp-ABC-1` gone and `dsp-ABC-10` alive, a bare `-t dsp-ABC-1` would silently attach
the WRONG ticket's session. The trailing `:` makes it a session-qualified pane target. Commands that
take NO target (`list-sessions`) carry no `=` prefix. Dropping either the `=` or the `:` is a
correctness bug, not a style choice.

Two further tmux invariants have their durable home in the adapter's JSDoc rather than here, because
each is scoped to a single function: `capturePane`'s `-J` soft-wrap rejoin (`NEW-02`),
`pasteBuffer`'s `-p`/`-d` bracketed-paste-and-delete (`NEW-05`), and `loadBuffer`'s per-session
NAMED buffers (`NEW-09`). `paneSize`'s dual width+height fetch (`NEW-03`/`NEW-04`) is the
false-flip guard homed in [Watcher Discriminator](#watcher-discriminator).

### Orchestration Saga

Dragging a ticket into In Progress runs the start saga (`services/orchestration/start-session.ts` +
`services/orchestration/steps.ts`), which turns a validated start request into a live `dsp-<identifier>`
claude session by driving four do/undo steps **forward** through the single-writer store —
`preparing workspace → creating worktrees → starting claude → sending kickoff` — and, on ANY
failure, compensating in **reverse** so the card is left exactly where it started, still in To Do
(`ORCH-01`, `ORCH-03`). Each step is `{ name, statusText, run(ctx), undo(ctx) }`; `run` records
exactly what it created onto the mutable `SagaContext` (`createdWorkspaceDir`, `createdWorktrees`,
`createdBranches`, `tmuxSessionCreated`), and `undo` compensates against THAT bookkeeping only —
it never re-derives targets from the identifier at undo time, because a reused pre-existing branch
or an already-registered worktree must survive rollback. Every `undo` is idempotent and swallows
its own errors so reverse compensation always runs to completion; the runner compensates the
failed step first (it holds the partial-creation bookkeeping) and then the completed steps in
reverse order.

At most one saga may run per card id at a time. The guard is a synchronous check-then-set on the
store (`store.isStarting` / `beginStart`, no await between) — the drag-Start + Retry race can
otherwise launch two sagas whose rollbacks tear down each other's resources. The guard lives in
the store rather than a module-local `Set` specifically so the poller's `reconcile` can see it and
refuse to remove an actively-provisioning card whose Linear issue vanished mid-saga (`CR-01`),
which would otherwise orphan a live session. A live `dsp-<identifier>` session that already exists
at start time is authoritative: the runner reattaches idempotently and never kills-and-recreates
(tmux is the source of truth). On the error path the card stays in To Do —
`setProvisioning`/`setStartError` never promote it — so no forward promotion happens when a start
fails.

Failure surfaces as a real error the card renders: a failed adapter call rejects with the child
process's `stderr` attached (see [Exec Chokepoint](#exec-chokepoint)), the step wraps it in a
`StartStepError` carrying that stderr, and the runner maps it to the structured `StartError` the
card shows — that captured stderr IS the card's error payload (`ORCH-04`). `setStartError` keeps
the card's `column` untouched so the user can Retry, and never logs the stderr contents. Ticket
text never reaches a command line during any of this: it is written to a kickoff temp file and
loaded into a per-session tmux buffer (Step 4), never passed as an argv element or shell string.

### Exec Chokepoint

`adapters/exec.ts` `run()` is the **sole subprocess chokepoint** for the session layer: every
git and tmux invocation in `src/server/adapters/` routes through it (`ORCH-02`); ttyd is the ONE
documented exception — `run()` (promisified `execFile`) resolves only on process exit, so routing
the long-lived ttyd daemon through it would hang every terminal spawn, which is why ttyd is spawned
directly with piped stderr (see [Terminal ttyd](#terminal-ttyd)). Read
[docs/standards/backend-design.md](standards/backend-design.md) rule 2's blanket "every
tmux/ttyd/git/claude call routes through the single argv-array exec adapter" wording with that
carve-out: the ttyd spawn is still argv-array only, it just cannot be an awaited `execFile`. It uses
argv **arrays** only — no shell strings, no template literals assembling command lines, and no
synchronous spawns — because command injection is the top threat for this phase: ticket
identifiers and titles are Linear-sourced, so no untrusted value may ever reach a command line.
Ticket text is delivered to the agent only as a kickoff FILE loaded into a tmux buffer, never as
argv. This is the argv-only control recorded as `T-04-01` in the
[Security Threat Model](#security-threat-model) — that table is the authoritative home for the
threat; this section records the mechanism.

The chokepoint is Node's built-in `execFile`, **NOT execa** (`NEW-11`): execa is not installed
and none is added. On Node 22 the promisified `execFile` rejects with `.stderr`/`.stdout`
populated (verified), so on a non-zero exit or spawn failure `run()` re-throws an `Error` with the
child's `stderr` and `stdout` attached (both always strings). That attached `stderr` IS the card's
error payload: the start saga reads it off the thrown error, wraps it in a `StartStepError`, and
the runner renders it on the card (`ORCH-04`) — swapping in a library whose rejection shape omits
`.stderr` would silently blank every card error message.

See also [Security Threat Model](#security-threat-model) for the `T-04-01` argv-only injection
control and the inert-stdout property (captured pane text is data, never a command).

### Linear Sync

Linear is mirrored into the board by a two-halves split kept deliberately apart: an I/O poll loop
(`adapters/poller.ts`) that only fetches, and a PURE reconcile mapping (`store/mapping.ts`) that
only decides. The poller hands the raw issue list to the single-writer store
(`store.applyIssues`), which runs `reconcile()` INSIDE its mutation queue against LIVE state —
never against a snapshot the poller read earlier.

**The poll loop — I/O only (`SYNC-01`).** `startPoller` fetches the assigned-unstarted issue set
from Linear's GraphQL API and feeds it to the store; it is the ONLY I/O half of the sync. It never
computes column-sensitive decisions from a snapshot (a queued-but-unapplied user move could
otherwise be reverted), never sorts (To Do ordering is owned by `store.snapshot()` in `store/board.store.ts`), and
never touches cards past To Do (that rule lives in `reconcile()`). The set is filtered by
workflow-state TYPE `"unstarted"`, NOT by name — state names are workspace-customizable. The loop
self-reschedules with a `setTimeout` (never `setInterval`, which could overlap) that is `unref()`'d
so it never pins the process, runs one poll immediately on startup, and is fire-and-forget.
Resilience: Linear signals rate limiting as HTTP 400 with `errors[].extensions.code ===
"RATELIMITED"` (NOT 429), detected in the body; the loop then backs off exponentially (capped at
15 minutes) and keeps the last-known-good board (store untouched). Any other network/parse/GraphQL
error is likewise logged and swallowed — the poller must never crash or spin. Cursor pagination is
walked defensively (assigned-unstarted sets rarely exceed one page); a page that still reports
`hasNextPage` after the safety cap OR with a missing cursor makes the list PARTIAL, so that cycle
applies UPSERTS ONLY and SKIPS removals/gone-flags — otherwise every issue beyond the cap would be
treated as disappeared and mass-removed. A no-errors response whose `assignedIssues` connection is
missing/malformed FAILS CLOSED (throws, keeping last-known-good) rather than coalescing to an empty
"complete" page that would remove every To Do card. The raw `Authorization` key is never logged
(`@see` [Do Not Change Contracts](#do-not-change-contracts) #10 and
[Security Threat Model](#security-threat-model)).

**Upsert rules — pure, column-scoped (`SYNC-02`).** `reconcile(issues, current, inFlightStartIds)`
is deterministic: no network, no wall-clock, no filesystem. Keyed by Linear issue id: a returned
issue with NO existing card upserts a fresh Inbox card — new tickets land in Inbox, never directly
in To Do, so To Do stays 100% user-curated; a returned issue whose card is in `todo` OR `inbox`
upserts an in-place refresh of title/url/description/priority/updatedAt/project and CLEARS
`goneFromLinear` (ONE widened rule, not a separate branch — promoting a card to To Do simply moves
it into the other half of the same refresh scope); a returned issue whose card is PAST that point is
NOT upserted — the poller never touches cards past To Do/Inbox. Exception: a card past that point
currently flagged `goneFromLinear` whose issue REAPPEARS emits a flag-only correction via
`reappearedIds` (nothing else on the card is touched), because `goneFromLinear` is poller-owned
derived state, not user board state. `reconcile` does NOT sort; it carries
`priority`/`updatedAt`/`project` faithfully so the store orders the To Do column on read.

**Removal / gone rules (`SYNC-03`).** A current card whose issue is ABSENT from the result is
handled by column: in `todo` OR `inbox` → `removeIds` (an issue that vanished is removed
IMMEDIATELY while in To Do or Inbox — Inbox does NOT inherit vanish-handling the way cards past To
Do do; it is treated exactly like a vanished To Do ticket, never `goneFromLinear`-flagged and kept
forever); past that point → `goneIds` (the card is KEPT and flagged `goneFromLinear`). CR-01
carve-out: a To Do card with a start saga IN FLIGHT (or already carrying provisioning/session state
from one) is treated like a card past To Do — never removed, only flagged — because removing it
mid-saga would orphan a live `claude` session and its worktrees with no card to reach them; an
Inbox card is structurally never mid-saga (no session can start from Inbox), so the carve-out is a
harmless no-op there. The muted "Gone from Linear" badge (`web/features/badges/GoneBadge.tsx`, shown
only on cards past To Do/Inbox) is INFORMATIONAL, not destructive: the issue disappearing from
Linear on a card past that point is EXPECTED, so it uses muted text/border, never red.

**Sync-strip precedence (`SYNC-04`).** The slim top strip (`web/features/sync/SyncStrip.tsx`) reports sync
freshness + connection health as TEXT only (no spinner — the board must feel instant), and its
status copy follows a fixed precedence chain: `Disconnected` (red — a dropped SSE connection, the
only destructive state) OUTRANKS the muted `stale` banner (last successful sync older than 2× the
poll interval), which outranks the muted truncation `syncWarning` (an incomplete pull — cursor cap
— last-known-good data is still fully on the board), which falls through to the plain relative-time
`Synced` copy. Stale and truncation are MUTED, not destructive, precisely because last-known-good
data remains fully on the board; only a dropped connection is red. An unparseable `syncedAt`
degrades to the plain `Synced` label rather than computing a relative age or a stale banner from
`NaN` (the least-lying option). The badge and strip `.tsx` sites are homed by this section, not by
JSDoc (the comment standard's tsx carve-out — [comments.md](standards/comments.md) rule 2 — forbids
JSDoc in `src/web/**/*.tsx`, enforced by the `allowJsdoc: false` lint scoping in `eslint.config.ts`).

**Sync out — promoting a local card to Linear (`PUSH-01/02/03`).** The inbound half above mirrors
Linear INTO the board; this half pushes a `source:"local"` card OUT to a real Linear issue on
explicit user action (`POST /cards/:id/sync-linear`, `services/orchestration/linear-sync.ts`).
MCP-only writes: the stored Linear API key is READ-ONLY toward Linear everywhere in this app — the
sync path never uses it to create or update anything, instead spawning a headless `claude -p` that
reuses the CLI's own user-scope Linear MCP OAuth session, restricted via `--allowedTools` to five
read/write tools (`list_issues`, `save_issue`, `list_teams`, `list_users`, `list_issue_statuses`).
The sole sanctioned exceptions to "API key never writes" are (1) GraphQL `issueDelete` for
TEST-cleanup only (user decision 2026-07-20), and (2) a single READ-ONLY `issue(id:...) { id }`
lookup the sync service makes with the stored key AFTER the MCP create/find succeeds — 62-03 live
smoke found that no Linear MCP tool in this allowlist (nor `get_issue`, checked live) ever exposes
the issue's internal GraphQL `id` to the model, only its short `identifier` under the confusingly
reused field name `id`; `resolveIssueId` in `linear-sync.ts` resolves the identifier to the true
internal id the exact way `linear.source.ts`'s poller already does, since that is the ONLY value
`Card.issueId` may ever hold. Idempotency: the sync prompt embeds
`dispatch-sync:<card.id>` as the final line of the created issue's description and searches for that
exact token via `list_issues` BEFORE ever calling `save_issue` to create — `save_issue` is
upsert-shaped (an `id` field means UPDATE), so the create branch is instructed to omit `id` entirely.
A retry after an ambiguous prior attempt (created-but-unparsed) therefore always finds the token and
reuses the existing issue instead of duplicating it. Atomic adoption: on success, `store.adoptLinearIdentity`
performs ONE fused mutation — `source: "linear"`, identifier/url/issueId/title/description swapped to
the canonical Linear values, `syncError`/`syncing` cleared — with a `sync_out` activity event inserted
in the SAME transaction (the standard `enqueue` persist+broadcast chokepoint, `SINGLE-WRITER` above).
`Card.id` NEVER changes, which is exactly what lets the NEXT Linear poll refresh the card in place: the
card now carries `source: "linear"` and the real `issueId`, so `applyIssues`'s per-source `current` map
(keyed by `issueId`) picks it up and `reconcile()`'s existing in-place-refresh branch (`SYNC-02` above)
applies — no separate poller code path exists for a freshly-synced card. Because a sync can legitimately
take longer than one poll interval, a poll cycle can complete WHILE the sync is still in flight: the
issue already exists on Linear but the card hasn't adopted yet, so the poller doesn't recognize it and
upserts its own new card for the same issue. `adoptLinearIdentity` removes any other card already
holding the adopted `issueId` as part of the same fused mutation, so the sync-triggered card (stable
`Card.id`) ends up the sole owner even when this race is hit (62-03 live-smoke finding). Per-card single-flight:
`store.isSyncing`/`beginSync`/`endSync` mirror the start saga's `isStarting` guard exactly (a
synchronous `Set<string>` keyed by card id, checked and set with no `await` between), so two DIFFERENT
local cards may sync concurrently while the SAME card is single-flighted; failure records a fixed,
non-stdout `card.syncError` string (never raw claude output — mirrors `startError`'s discipline) and
the card stays fully local, retryable via the same idempotency token. **Operator prerequisite:**
Sync-to-Linear requires a one-time interactive Linear MCP OAuth authorization on the machine running
`claude` — `claude mcp add --transport http linear -s user https://mcp.linear.app/mcp`, then run
`claude`, type `/mcp`, choose `linear`, and authenticate in the browser. The workspace selected during
that OAuth flow is the write target for every subsequent headless sync (done for Yash-Test 2026-07-20).

### SSE Transport

The board receives state over a single hand-rolled Server-Sent-Events stream — no SSE library —
and pushes state back only through fire-and-forget REST, so the SSE channel is strictly
server→client.

**Hand-rolled SSE endpoint (`BOARD-04`).** `GET /api/stream` (`routes/sse.route.ts`) keeps a module-level
`Set<Response>` of active clients and, on every store `"change"`, broadcasts the FULL current
`BoardSnapshot` to each — a single-user board does no event merging, the client replaces its state
wholesale. Each durably-inserted event also rides the SAME connection as a distinct NAMED
`event: activity\ndata: <ActivityEvent JSON>\n\n` frame (on every store `"activity"`), alongside the
unnamed board `data:` frame and the named `ping` heartbeat. The stream is un-buffered (`X-Accel-Buffering: no`, `Cache-Control: no-cache`, and NO
compression on this route — compression would buffer and break liveness) and resync-on-connect (the
full snapshot is written the instant a client connects). The payload is a `BoardSnapshot` only
(cards + syncedAt) — it NEVER carries the Linear API key or any secret: `store.snapshot()` is the
single outbound chokepoint and redacts `card.hookToken` from every wire copy (SSE frames and REST
reads alike), so the persisted per-session hook secret never leaves the server. The `KEEPALIVE_MS` (15s)
heartbeat is written as a NAMED `event: ping\ndata: 1\n\n`, NOT a `:comment`: an `EventSource`
never surfaces comment lines to JS, so a comment heartbeat gives the client no way to tell a healthy
idle stream from a dead-but-open socket (a backend death behind the Vite proxy leaves the socket
open and silent — `es.onerror` never fires). A named event dispatches to the client's
`addEventListener("ping")`, letting its liveness watchdog observe the beat; `data:` is mandatory
because the SSE spec drops an event with an empty data buffer. This 15s cadence MUST stay in
lockstep with `useBoardStream`'s `HEARTBEAT_MS` — the client trips its watchdog when no frame
(snapshot OR ping) arrives for 3× the window (3× tolerates jitter and one dropped ping). That
KEEPALIVE↔HEARTBEAT lockstep is do-not-change contract #2 — `@see`
[Do Not Change Contracts](#do-not-change-contracts). Every write goes through a `safeWrite` guard
(skip if `res.destroyed`/`writableEnded`) because the socket can be torn down a tick BEFORE the
`close` handler runs, and an unguarded write in that window emits `ERR_STREAM_DESTROYED` that would
crash the process; dead clients are pruned from the `Set` on both the broadcast path and the
per-connection `close`/`error` handlers.

**Client optimistic-move layer (`BOARD-02`).** `web/features/board/Board.tsx` layers a local `cards` state over
the SSE snapshot and replaces it WHOLESALE whenever a new snapshot arrives — this is the client
contract of the SSE transport, which is why it homes here rather than as a standalone frontend
concern. Only a To-Do→In-Progress drop kicks off async orchestration: that card is NOT moved
optimistically; the server promotes it via the next SSE snapshot only after a successful start
saga (a Start modal opens instead). EVERY OTHER move is a synchronous local state change — local
state updates IMMEDIATELY on drop (no spinner, no pending flag) and `moveCard` fires
fire-and-forget; the next full-snapshot broadcast reconciles the authoritative state. Because the
board is single-user, the optimistic move converges with the snapshot and never visibly reverts.
The board iterates `COLUMNS` in fixed order and MUST NOT re-sort To Do (it arrives pre-ordered from
`store.snapshot()`). The `.tsx` site is homed here, not in JSDoc.

### Startup Preflight

Preflight is INFORMATIVE, never a gate (`BOARD-05`, `PRE-01`/`PRE-02`/`PRE-03`). `services/infra/preflight.ts` is
the single source of truth for prerequisite / Node-version / storage-health status and per-platform
install commands, and it is consumed identically by three surfaces: `dispatch doctor` and ordinary
boot (`bootstrap/cli.ts`, `bootstrap/index.ts`) and the web first-run setup screen
(`routes/setup.route.ts` → `web/lib/api.ts` → `features/setup/FirstRunSetup.tsx`). `probePreflight()`
probes EVERY required binary — `tmux`, `ttyd`, `claude`, `git` — with no short-circuit, and returns
each one's presence plus its exact platform-appropriate install command, alongside the running Node
version compared against the `engines.node` floor and a read-only storage-health line.

The backend BOOTS REGARDLESS: a missing binary, a below-floor Node, or unhealthy storage renders a
line and the server still listens, so the browser always reaches a live setup screen with current
status. (Sessions that actually need a missing binary still fail at use-time, on the card.) `dispatch
doctor` is likewise a diagnostic, not a gate — it ALWAYS exits 0. The only fail-fast path left is a
missing/incomplete config, which throws `StartupError` (the class still homed in
`bootstrap/binary-check.ts`, now its sole remaining export, raised from `bootstrap/config.ts`).

A missing binary is one guided command away on either surface: in an interactive terminal preflight
offers `[Y/n]` and runs the install on confirm; under a pipe/CI it prints the command and never
prompts or spawns (`INST-02`/`INST-03`). `claude` is print-only guidance on both surfaces — it has no
package-manager install. After an attempt the re-check probes known install prefixes rather than the
stale process `PATH` (`INST-04`), because `process.env.PATH` is snapshotted at launch and a good
install would otherwise re-read as "still missing". The storage line reuses the store's read-only
`probeStorageHealth()` and NEVER `connect()` — a health probe must not quarantine or mutate
`board.db`.

`resolveBinaryPath` — in `adapters/resolve-binary.ts` — stays PATH-only (via `which`) and resolves the
absolute `claude` path the orchestrator passes to tmux, immunizing the session against tmux-server
env/PATH drift; it never rejects. Its sibling `resolveWithPrefixes` unions the known install prefixes
and is used ONLY by the post-install re-probe. The formerly built-but-unwired degraded-serving surface
(`StartupErrorScreen`) has since been DELETED; its disposition is recorded under
[Known Residuals](#known-residuals).

### Cleanup Lifecycle

When a card reaches Done its isolated workspace (per-repo git worktrees + the ttyd/tmux session) is
torn down. The teardown is an async saga composed from EXISTING adapters over server-derived paths; it
is scoped to `services/orchestration/cleanup.ts` (`cleanupWorkspace`) with cross-module touchpoints in the
store (`recordCleanupWarning`/`finishCleanup`), the `/cleanup` route, and the `.tsx` cards/modal that
offer it. Its home is written once here.

**Done-card teardown saga, fire-and-forget and quiet (`LIFE-01`).** Cleanup runs fire-and-forget off
the `/cleanup` route AFTER the optimistic Done move and NEVER blocks the board; the route returns an
immediate 202. The outcome reaches the UI ONLY over SSE: a clean run calls `finishCleanup` (a quiet
state clear, no banner), a partial failure calls `recordCleanupWarning` which surfaces a MUTED,
never-destructive card warning (mirroring the Start warning; UI-SPEC lock). Every path and session is
derived from `card.*` + configured `repoPaths` — NOTHING from the request body (the route passes only
the validated card id, `T-08b-01` EoP defense). Server-side guards are defense-in-depth (the client
confirm alone is not a gate): the card MUST be in Done (a stray POST must never tear down a live
in-progress session) and NO start saga may be in flight — cleanup racing a (re)start would delete
worktrees the saga is creating, so `/start` 409s a Done card and cleanup 409s a starting one. Done
cards are parked with no Restart affordance; the cleanup offer owns workspace reclamation there.

**Delete-before-kill teardown ordering (`NEW-14`).** The steps run in a LOCKED order, each idempotent
and no-op tolerant so a re-run after a partial failure is safe:

1. **`killTtyd`** — kills the ttyd process for the session via the deliberate-teardown path that
   DELETES the tracked entry BEFORE killing. Deleting first is the point: it stops the ttyd
   orphan-sweep from re-adopting the process mid-teardown, and it makes the process's `onExit` a no-op
   so no spurious `terminalError` is broadcast. Idempotent no-op if the session is untracked.
2. **`killSession`** — kills the tmux session by EXACT-name target (`=<name>`, mirroring the
   attach/capture argv); swallows if already gone.
3. **Per-repo `worktreeRemove`, fanned out ACROSS repos (`PERF-01`)** — every configured repo's
   removal runs CONCURRENTLY via `Promise.allSettled` (never `Promise.all`, which would abort every
   sibling repo's teardown on the first rejection), never within a single repo (each repo's own
   kill → remove → fs.rm → prune order is unchanged). The worktree path is built BYTE-IDENTICALLY to
   the start saga's construction in `steps.ts` (a wrong path would remove the wrong directory); an
   already-removed worktree is treated as SUCCESS, not a failure. One failing repo never aborts its
   siblings' teardown — the settled results are reduced by positional index into the same
   `failures[]` array the old sequential loop built, so the outcome's SHAPE (per-repo basenames,
   count-gated warning) is unchanged, only the SCHEDULING is concurrent. The preflight
   `worktreeStatus` probe (above this ordered list) fans out the same way, across the same repos, for
   the same reason.
4. **`fs.rm` the workspace folder** — `recursive: true, force: true` so absence is tolerated. Stays a
   SINGLE call spanning every repo's worktree directory (not split per-repo): measured evidence in
   `docs/BASELINES.md`'s `## Cleanup` section showed the three per-repo git loops dominating this
   step by ~294x at this project's worktree sizes, so PERF-01's fan-out scope excludes `fs.rm`.
5. **`worktreePrune`** per repo, ALSO fanned out via `Promise.allSettled` — run LAST, after the
   directories are gone, so prune actually deregisters any `.git/worktrees/<name>` registration whose
   `worktreeRemove` failed in step 3 (`git worktree prune` only drops registrations whose directories
   no longer exist). Skipping it would leave a dangling registration marking a branch as checked out
   in a phantom deleted path, breaking manual `git checkout` in the main repo until the next start
   saga's boot prune. Prune is failure-tolerant per repo because `Promise.allSettled` collects every
   rejection without throwing, and never masks the earlier outcome.

**Branches are NEVER deleted (`NEW-14`).** No step in this saga touches branches — worktrees and the
workspace folder are removed, but the underlying git branches ALWAYS survive so the work is never
lost (`T-08b-05`). Any partial failure across the steps records the muted `cleanupWarning`; a fully
clean run calls `finishCleanup`.

**Concurrent fan-out across repos, not within a repo (`PERF-01`).** All three per-repo loops above
(preflight `worktreeStatus`, teardown `worktreeRemove`, `worktreePrune`) run their per-repo work
CONCURRENTLY across a card's `card.workspace.repos` via `Promise.allSettled`, measured in
`docs/BASELINES.md`'s `## Cleanup` section at a 2.4x mean-latency reduction for a 3-repo card. No
same-repo guard exists or is needed: every entry in `card.workspace.repos` is, by construction, a
distinct `.git` directory (folder-discovery mints one entry per discovered root), so two concurrently
running repos never contend on the same git lock. Every store mutation
(`recordCleanupBlocked`/`noteCleanupWarning`/`recordCleanupWarning`/`finishCleanup`) stays OUTSIDE the
fan-out, called exactly once after the results settle — one card-level outcome still produces exactly
one SSE-visible mutation, unchanged from the pre-concurrency saga.

### Hooks Status Channel

Claude Code hook events are a SECOND transport into the same marker protocol: a per-session hook
script POSTs `Stop` and `UserPromptSubmit` payloads to the loopback-only `/api/hook/claude` route
(`routes/hooks.route.ts`), which resolves the per-session token and delegates to
`services/domain/hook-events.ts`. The channel changes the transport, never the contract — the kickoff
wording, `MARKER_RE`, and the markers replay corpus stay frozen.

**Edge-triggered vs level-triggered — how the two channels compose.** The hook channel is
EDGE-triggered: one `Stop` = one event, delivered once, never re-observed. The pane watcher is
LEVEL-triggered: it re-scans the visible pane every 2s and needs `lastMarker` dedup precisely
because it re-observes the same text. The two compose safely through `lastMarker`: whichever
channel applies a marker first writes the dedup key, and the other channel's view of the same
logical marker resolves to the same or a prefix-related key (the prefix rule in
[Marker Protocol](#marker-protocol)) and is treated as already consumed. Because the hook path is
edge-triggered, NO dedup heuristics live on it — the dedup burden stays wholly on the
level-triggered watcher, which already carries it.

**The markerKey symmetry rule.** The hook path MUST write
`markerKey(parseLastMarker(last_assistant_message))` — the exact `kind + " " + reason` format from
`adapters/markers/parse.ts` — as `applyMarker`'s dedup key. Any hooks-specific key format (a
re-rolled regex, a different separator, a truncated reason) breaks `sameMarkerKey`'s prefix
comparison and the untouched watcher re-fires every hook-applied marker on its next 2s tick.
Reusing `parseLastMarker` also inherits the kickoff-placeholder guard and last-match-wins for
free; the hook payload's message is untruncated, so the hook-side key is always the fullest form
the prefix rule can meet.

**Token is the auth; identity derives only from the token.** Any local process can reach the
loopback port, so the route's mandatory `x-dispatch-token` header — resolved against the in-memory
token→card registry (`services/domain/hook-tokens.ts`) — is the real authentication; the shared loopback
gate stays in front as free defense-in-depth against DNS rebinding. A missing or unknown token is
a 401 with ZERO store calls. Card identity comes EXCLUSIVELY from the token lookup: any card or
session id claimed in the request body is ignored, so a valid token for one card can never move
another. The registry is rebuilt at boot from persisted `card.hookToken` for cards whose session
is still live (`bootstrap/reconcile.ts`), because sessions deliberately outlive backend restarts
and a memory-only map would silently 401 every live session's POSTs. Registry entries die with
their session: every store mutation that clears `card.hookToken` (session lost, resume failure,
both cleanup outcomes) also unregisters it through a bootstrap-injected releaser (the boundaries
DAG forbids store → services), and BOTH reattach branches — resume's and the start saga's
already-running adoption — re-register the persisted token, so a live session reattached after a
backend restart keeps authenticating. Tokens are never logged; the
hook path's logging is content-free end to end.

**Manual drag precedence is the SAME mechanism on both channels.** Hook events mutate the board
ONLY through `applyMarker` and `flipBack`, whose column checks run INSIDE the single-writer queue;
`moveCardManual` leaves `lastMarker` in place so a drag consumes the current marker. Nothing
hook-specific exists to make drags win — the precedence the pane channel already had holds for
hooks by construction, and any divergence from those shared primitives is where a double-apply
bug would enter.

**Channel routing — which transport drives status.** The `statusChannel` config key
(`hooks | pane | auto`, default `auto`) selects the status source. It is BOOT-STATIC: loaded and
validated once (an invalid value is a StartupError naming the three literals), distributed via
`HooksRuntime` to services and as a plain `startMarkerWatcher(statusChannel)` parameter to the
watcher (adapters must not import services), so changing it requires a backend restart and every
reader is race-free.

**The `hookRoutedAt` latch.** Under `auto`, routing is PER SESSION on the persisted
`card.hookRoutedAt` latch: stamped by `applyHookEvent` on the session's first authenticated hook
event of ANY type (in practice the kickoff paste's UserPromptSubmit, seconds after launch), one-way
within a session, and cleared ONLY via the store's `clearHookToken` chokepoint — every
session-death path (session lost, resume failure, both cleanup outcomes) flows through it, so a
relaunch/resume starts hook-silent and re-proves traffic. LATCH ⇒ TOKEN: `markHookRouted` refuses
to stamp a card holding no `hookToken`, so a race with a queued session-clearing mutation can
never latch a dead session. And because a card killed mid-saga can carry a persisted latch that
no death path ever clears (it never got a `tmuxSession`, so reconcile cannot see it), BOTH
hook-silent launch branches (`startClaude`/`resumeSession`) reset the card's hook-channel state
through `store.clearHookChannel` — the same chokepoint, as one queued mutation — before spawning,
making "a hook-silent launch starts unlatched" true by construction rather than by path
enumeration. A hook-silent session (below-floor CLI → no injection → no token → nothing can
authenticate) never latches and keeps full pane routing forever. The field is explicitly
NON-SECRET: an ISO timestamp that rides `snapshot()` unredacted, unlike `hookToken`.

**The watcher gate seam.** The demotion is one early return in `scanSession`'s I/O shell —
`paneRouted` is `pane`-mode always, `hooks`-mode never, `auto` per session on the latch — placed
AFTER the capture try/catch and BEFORE the recap-overlay guard. Everything above the gate is
unconditional on every channel: capture IS the RESIL-01 dead-session probe (3 failed captures
~6s → Session lost), and `reapDeadSessions`' orphaned-ttyd teardown runs outside the gate
entirely. The pure decision core (`scan-decision.ts`, `pane-view.ts`, `parse.ts`) and the replay
corpus are untouched — the replay harness imports only the pure core, so replay 16/16 is a
structural property of this seam.

**Two-layer pane suppression.** `statusChannel: "pane"` restores today's scraping exactly through
two independent guards: (1) the injection gate in `steps.ts`/`resume-session.ts`
(`runtime?.capable && runtime.statusChannel !== "pane"`) launches sessions byte-identical to the
pre-hooks argv — no settings, no token, no env — so no hook traffic exists at the source; (2) the
`applyHookEvent` top guard no-ops straggler sessions injected under `auto`/`hooks` before a config
flip — zero board mutations, no latch, no stamp. The route still authenticates in pane mode (401
invalid token, 204 valid): a 401 for a valid token would be a lie and per-turn log noise; HTTP
status codes are not board behavior.

**The 2s activity throttle.** PostToolUse/Stop events stamp `outputChangedAt` through the
existing `setOutputChanged` mutator (the dot pipeline is inherited end-to-end; UserPromptSubmit
never stamps — the user's own typing is not agent output). PostToolUse is throttled per card to
one stamp per 2000ms in `hook-events.ts`; Stop is EXEMPT — it fires once per turn (inherently
rate-limited) and is the turn's FINAL event, so throttling it would permanently drop the stamp
for the turn's actual final output with no later event to self-heal it (worst case per turn is
one PostToolUse stamp + one Stop stamp inside the same 2s — still bounded, still far below a
per-tool-call burst). The throttle is channel policy and lives in the SERVICE — the store stays
policy-free (`setOutputChanged`'s JSDoc forbids coalescing there). 2s matches the pane watcher's
tick, so hook-path dot latency is never worse than the pane path's. The throttle map's entries
are reaped through the store's token-release chokepoint (the bootstrap-wired releaser composes
the registry unregister with `reapActivityThrottle`), matching the reaping discipline of the
watcher's per-session maps.

**Tool-mediated pause routing (HOOK-03).** `AskUserQuestion` (and the same class of tool,
`ExitPlanMode`) pauses the CURRENT turn to wait on the user WITHOUT ending it — no `Stop` event
fires at the pause, so `applyStopEvent`'s marker-text parsing (the mechanism every other pause
class relies on) never runs for it, and answering the question delivers the reply as a tool
result, not a fresh prompt, so `UserPromptSubmit` never fires either. Both gaps were confirmed
live (not inferred from docs) against the installed CLI before any fix landed. The fix is two
layers, ordered lowest-risk first:

1. `kickoff.ts`'s `STATUS_PROTOCOL` carries a fourth instruction line asking the agent to print
   the `NEEDS_INPUT` marker as a standalone reply before calling a pausing tool. Live-measured
   INSUFFICIENT ALONE, even when followed: the printed text still lands mid-turn, so it is never
   carried by a `Stop` event and the hook channel never sees it (0/3 flips across live runs with
   only this layer present).
2. A permanent `PreToolUse` hook is registered (`bootstrap/hook-setup.ts`, its matcher derived
   from hook-events' exported `PAUSE_TOOL_NAMES` — the single source of truth for the pause-tool
   set, so registration, enter, and flip-back can never drift apart) as the structural safety
   net: `applyHookEvent` synthesizes a marker with `kind: "NEEDS_INPUT"` and
   `` reason: `waiting on ${toolName} (${discriminator})` `` and applies it through the SAME
   `markerKey()`/`applyMarker` path `applyStopEvent` uses (never a hand-rolled key), so this
   is additive to — not a fork of — the shared marker/dedup core; `parse.ts`/`scan-decision.ts`/
   the replay corpus are untouched. The discriminator is the payload's validated `tool_use_id`
   when present, else a per-card fallback counter seeded from `Date.now()` on first use and
   reaped at the token-release chokepoint. Folding it into `reason` — the sole input `markerKey`
   reads — makes each pause's key distinct BOTH within a session (a second same-session pause
   never dedups against the first's still-standing `lastMarker`, which `flipBack` deliberately
   never clears) AND across channel lifetimes (`lastMarker` survives every session-clearing
   mutator while the counter is reaped, so a fixed-seed counter would reproduce a dead channel's
   key on the new channel's first fallback pause — the `Date.now()` seed forbids that), while a
   retried event carrying the SAME `tool_use_id` still yields the SAME key and stays deduped. Flip-back mirrors it: the existing `PostToolUse` branch (today
   only stamping `outputChangedAt`) additionally calls `store.flipBack(cardId)` when the event's
   validated `tool_name` is in the same pause-tool set; `flipBack`'s own column guard
   (`c.column !== "needs_input"` → no-op) makes this safe to call unconditionally on every such
   event. Both new branches sit AFTER the pane-mode no-op guard described above, so they inherit
   the "no pane fallback under explicit `hooks` mode" contract automatically and can never fire
   under `statusChannel: "pane"` — a pane-mode session never even carries `--settings`, so the CLI
   never emits the `PreToolUse`/`PostToolUse` events in the first place. Live-verified 3/3: the
   pause flips the card to Needs Input, answering flips it back, a plain `pane`-mode session stays
   structurally unable to detect the pause (unregressed, pre-existing, out of this fix's scope),
   and a manual drag still wins over any marker.

**Accepted residuals.** Under `auto` the seconds-wide [launch → kickoff] window can double-stamp
the same activity via both channels (two SSE frames, same semantic — cosmetic, self-heals on
view). Under `hooks`, a hook-silent session gets NO status routing at all — the user's explicit
mode choice; dead-session detection still covers it. A pathological >1mb PostToolUse payload is
rejected by the body limit and drops one cosmetic stamp, self-healing on the next event.

### Dev-Server Preview Detection

Detecting a dev server running inside a session's process tree is a three-call chain, all
batched: `tmux list-panes -a` returns every live pane's PID grouped by session in ONE call, then
one system-wide `ps -axo pid=,ppid=` builds a ppid→children index, then one PID-scoped
`lsof -a -p <pids> -iTCP -sTCP:LISTEN -Fpn` resolves every discovered pid's listening ports in
ONE call. Regardless of how many sessions are live or how deep their process trees run, this is
exactly three subprocess calls per detection tick — never a per-session or per-pid loop.

**`-a` is mandatory.** `lsof` ORs `-p` against `-i`/`-s` by default; omitting `-a` returns every
listening socket on the machine from any process, attributing a foreign process's port to a
session that never opened it.

**`lsof` exit 1 is not failure.** A pid can exit between the `ps` scan and the `lsof` call, so
the ordinary "no listeners" case and the "one stale pid in the list" case both exit non-zero
while `stdout` still carries every other pid's valid records. The rejection's error shape is the
discriminator: `typeof err.code === "number"` with a populated `err.stdout` is a usable result to
parse; `typeof err.code === "string"` (e.g. `ENOENT`) is the only genuine failure.

**`null` vs `[]` is the entire staleness contract.** `null` means detection failed this tick —
the caller leaves every card's previous `previews` value untouched, exactly the tolerant-swallow
discipline `listSessions`/`pidsListeningOnPorts` already established. An empty array means
detection succeeded and genuinely found nothing — the caller clears the field. Collapsing these
two into one signal would either wipe a live card's badges on a transient tool hiccup, or wedge a
dead port's badge on the board forever.

**The card's own `ttydPort` is excluded** from the ports attributed to its session before the
write — the writable terminal iframe's own port must never be offered back as a one-click
"preview" link.

**`previews` rides both wire and disk exactly like `prs`.** No `buildMeta`-style per-card disk
filter exists (`board-db.ts` `JSON.stringify(card)`s the whole card unfiltered), so there is
nothing to build: a stale disk value after a crash mid-session either gets overwritten by the
next tick (session still alive) or cleared by whichever teardown mutator runs (session died) —
self-healing, with no special-casing in `hydrateFromParsed`.

**Detection is a passenger, never a second timer.** The scan runs inside the existing 60s poller
tick, behind the existing single-flight guard — never its own `setInterval`/`setTimeout` and
never a second in-flight guard variable.

## Do Not Change Contracts

These are seams that refactors must hold **byte/shape-identical**. A change to any of them
is a behavior change, not a refactor.

1. **`shared/types.ts` shape.** `Card`, `BoardSnapshot`, `Config`, `StartError`, `TerminalError`,
   `SessionFields`, `ReconcileResult`, `Column`/`COLUMNS`. Consumed by both halves; **`BoardSnapshot`
   IS the SSE payload AND the on-disk `board.json`** — same shape both places, but wire copies are
   redacted at `store.snapshot()` (`card.hookToken` is stripped; only the persisted file carries
   it). Keep the file location and every field name.
2. **SSE frame format.** `data: ${JSON.stringify(BoardSnapshot)}\n\n`; named heartbeat
   `event: ping\ndata: 1\n\n`; headers incl. `X-Accel-Buffering: no`; **server `KEEPALIVE_MS` (15s)
   must stay in lockstep with client `HEARTBEAT_MS`** (watchdog trips at 3×). No compression on
   `/stream`.
3. **REST route paths + status codes.** `GET /api/board`, `GET /api/stream` (SSE),
   `GET /api/events` (REST event log — `{ events: ActivityEvent[] }`, newest-first, default limit 200,
   `?cardId=` scoped),
   `POST /api/cards/:id/{move,start,resume,terminal,open-editor,cleanup,sync-linear}`; the
   `202/400/409/204` codes and the `{ error, variant? }` 400 body. `sync-linear` deliberately deviates
   with a `404` (not `400`) for an unknown card id — see the Sync-out contract above. Vite proxy
   matches `^/api/` only (regex, deliberately not `/api`).
4. **Persistence format + location.** `~/.dispatch/{board.json,config.json}`; `board.json` ===
   `BoardSnapshot` JSON; atomic writes via `write-file-atomic`; config at mode `0600`; the `"//"`-keyed
   config template.
5. **tmux invocations (argv-exact).** Session name `dsp-<identifier>`;
   `new-session -d -s <name> -c <cwd> -x 200 -y 50 <argv>`; `capture-pane -p -J -t =<name>:`; exact-name
   `=` targeting; `load-buffer -b`/`paste-buffer -b -p -d`; separate `send-keys Enter`. Geometry `200×50`
   is load-bearing for readiness/marker parsing.
6. **ttyd invocation + tracking.** `ttyd -W -i 127.0.0.1 -p 0 -t disableLeaveAlert=true -t
fontFamily=<Nerd Font family> -t fontSize=15 -t theme={...dark ITheme...} tmux attach -t
=<session>`; port parsed from stderr `Listening on port: N`; loopback bind mandatory; orphan-sweep
   fingerprint (`basename(argv0)==="ttyd"` AND argv includes `tmux`+`attach`); iframe src
   `http://127.0.0.1:${ttydPort}`.
7. **DISPATCH_STATUS marker protocol.** `parse.ts` `MARKER_RE` and the kickoff wording in `kickoff.ts` must
   stay byte-identical to each other (em-dash **U+2014**, the `NEEDS_INPUT`/`DONE` tokens, the
   `<one-line reason>`/`<one-line summary>` placeholders). Dedup semantics (`markerKey`,
   `sameMarkerKey` prefix rule) unchanged.
8. **Worktree path construction (`NEW-12`).** `path.join(workspacePath, path.basename(repoPath))`
   was once duplicated **byte-identically** in `steps.ts` and `cleanup.ts`; it is now the single
   canonical builder `worktreePath()` in `services/domain/workspace-paths.ts` (inventory ID `NEW-12`, see
   [Worktree Path](#worktree-path)) — both former sites call it, and the produced string must
   remain identical.
9. **Single-writer store discipline.** All card mutations flow through the board store's enqueue (`store` in `store/board.store.ts`); `snapshot()`
   is the sole ordering point (`compareTodoOrder`: promotion recency first — the by-design primary
   tier now that Inbox is the sole entry path and `promotedAt` is never cleared — then priority
   `0`→+∞ with `updatedAt` desc tiebreak for never-promoted cards only). Do not
   split the queue, do not add a second writer, do not pre-sort upstream.
10. **Linear GraphQL contract.** Query shape (unstarted `state.type`, `first:100`, cursor pagination),
    `RATELIMITED`-in-400-body detection, raw `Authorization` key (never logged), fail-closed on missing
    connection.
11. **Client-side persisted keys.** localStorage `dsp.unseen.lastOpened`; the `isUnseen` ISO-string
    comparison; the seed-on-reconnect discipline in the notification + unseen-dot logic.
12. **Preserved import edges (no cycles).** `watcher → ttyd → store` (via `trackedTtydSessions()` export,
    `killTtyd` wired in watcher); everything → pure `shared/types.ts`. Relocation must not introduce a
    `store → adapters` or `adapters → services` back-edge.

## Security Threat Model

One STRIDE row per threat ID, each stating the concrete control, not just the threat. This table
is the **authoritative home** for every `T-*` invariant — the enforcing sites keep an `@see` back
to this section rather than scattering the threat model across the ~15 files that enforce it. The
layering rule that keeps every subprocess behind one argv-only chokepoint is owned by
[docs/standards/backend-design.md](standards/backend-design.md) rule 2 (exec chokepoint); this
table records the security invariants that ride on it, not the rule itself.

| T-ID    | STRIDE                                  | Component / site                                                                                                                                       | Mitigation (concrete control)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01-03 | Information Disclosure                  | `adapters/poller.ts`                                                                                                                                   | `config.linearApiKey` is sent only as the raw `Authorization` header value (T-01-03a) — it is never logged, never echoed into any error body, and never reaches the routes layer.                                                                                                                                                                                                                                                                                                                                                               |
| T-01-04 | Tampering (XSS) / DoS                   | `web/features/board/Card.tsx`, `web/hooks/useBoardStream.ts`                                                                                           | Linear title/identifier are rendered as plain React children (React auto-escapes) — never injected as raw inner HTML (XSS mitigation T-01-04a); and the SSE hook disposes EVERYTHING (EventSource, pending reconnect, watchdog) on unmount so a StrictMode double-mount never leaves two live connections or an orphan timer (DoS mitigation T-01-04c).                                                                                                                                                                                         |
| T-01-05 | Tampering (XSS) / Elevation             | `web/features/detail/DetailPanel.tsx`                                                                                                                  | The Linear-sourced description renders as plain React children (auto-escaped), never as raw inner HTML (T-01-05a); the panel is a PLAIN element with NO focus trap so keystrokes pass through to the live `claude` session — EoP accepted on a single-user loopback-only host with no adversarial keystroke concern (T-01-05c).                                                                                                                                                                                                                 |
| T-02-04 | Tampering                               | `adapters/claude-trust.ts`                                                                                                                             | `~/.claude.json` is concurrently rewritten by every live Claude session; all `preSeedTrust` calls serialize through a single in-process async lock, keep the re-read→merge-one-entry→write span tight (no awaits between), and parse in try/catch — never writing a file that could not be parsed.                                                                                                                                                                                                                                              |
| T-02-05 | Tampering                               | `adapters/claude-trust.ts`                                                                                                                             | Same lost-update defense as T-02-04: `write-file-atomic` prevents torn files but not a stale snapshot clobbering a concurrent writer's live auth state, so the in-process lock + tight RMW span + parse-guard is the mitigation an in-process actor can offer.                                                                                                                                                                                                                                                                                  |
| T-02-12 | Tampering (XSS)                         | `web/features/modals/StartModal.tsx`                                                                                                                   | The Linear-sourced identifier renders as a plain React child (auto-escaped) — never injected as raw inner HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| T-02-15 | Spoofing / Elevation                    | `routes/cards.route.ts` (`/start`)                                                                                                                     | The start route lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — it is NOT mounted anywhere else, so there is no ungated path to the saga.                                                                                                                                                                                                                                                                                                                                                                      |
| T-02-16 | Tampering / Elevation                   | `routes/cards.route.ts` (`/start`)                                                                                                                     | Defense-in-depth identifier gate: the Linear-sourced identifier is re-validated against `^[A-Za-z0-9]+-\d+$` at the route before it enters filesystem paths, branch names, and tmux session names in the saga (the saga re-checks too).                                                                                                                                                                                                                                                                                                         |
| T-02-17 | Information Disclosure                  | `bootstrap/config.ts`, `services/infra/config-holder.ts`                                                                                               | Config validation happens at boot: `loadConfig` throws `StartupError` naming the offending field or config-file path and NEVER echoes the Linear API key; routes read config only through the holder and return a value-free 400 when it is unset, so configured values never reach a response body.                                                                                                                                                                                                                                            |
| T-03-01 | Spoofing / Elevation                    | `adapters/ttyd.ts`                                                                                                                                     | `-W` (writable) AND `-i 127.0.0.1` (loopback-only bind) are BOTH mandatory — a missing `-W` is a dead terminal, and an all-interfaces bind would expose an unauthenticated writable shell to the LAN. Never bind a routable interface.                                                                                                                                                                                                                                                                                                          |
| T-03-02 | Tampering / Elevation                   | `adapters/ttyd.ts`, `routes/cards.route.ts` (`/terminal`)                                                                                              | argv-array spawn only (never a shell string): only fixed strings + the caller-validated `session` (`dsp-` + a route-checked identifier) enter argv; the terminal route additionally re-validates the identifier before it enters the ttyd attach argv.                                                                                                                                                                                                                                                                                          |
| T-03-03 | Spoofing                                | `routes/cards.route.ts` (`/terminal`)                                                                                                                  | `/terminal` lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — no new mount, no second gate.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| T-03-07 | Denial of Service                       | `adapters/ttyd.ts`                                                                                                                                     | Single-flight spawn: `ensureTtyd` records the in-flight promise SYNCHRONOUSLY (before its first await) so a StrictMode double-effect or two near-simultaneous POSTs share ONE spawn — otherwise the loser leaks an orphan ttyd that later fires a FALSE `died` signal; the exit handler reconciles only the tracked child.                                                                                                                                                                                                                      |
| T-04-01 | Tampering / Elevation                   | `adapters/markers/watcher.ts`, `adapters/exec.ts`, `adapters/gh.ts`                                                                                    | Session names entering `capture-pane -t =<name>` are `dsp-` + a route-validated identifier and travel argv-only via `run()`; captured pane text is inert stdout, never a command. The `gh pr list` PR probe travels argv-only through the same `run()` chokepoint, with only the server-derived `card.branch` and the registered `card.workspace.repos[].path` entering argv — never a client-supplied value.                                                                                                                                   |
| T-04-02 | Tampering                               | `adapters/markers/parse.ts`                                                                                                                            | The marker reason/summary is captured as an OPAQUE string (trim only) — never eval'd, parsed as code, or template-executed; untrusted agent text stays inert.                                                                                                                                                                                                                                                                                                                                                                                   |
| T-04-04 | Information Disclosure                  | `adapters/markers/watcher.ts`, `adapters/ttyd.ts`, `adapters/gh.ts`                                                                                    | Content-free logging: logs only counts / error messages — NEVER pane text, card fields, the reason/summary, PIDs, argv, or session contents. The one-time `gh` failure log names a fixed CATEGORY only ("gh unavailable" / "gh not authenticated" / "gh pr list failed") — never raw `gh` stderr, the repo path, or the branch name.                                                                                                                                                                                                            |
| T-06-01 | Tampering                               | `adapters/editors.ts`                                                                                                                                  | `launchEditor` hands the server-owned `workspacePath` to the argv-array chokepoint (`exec.run`) as a SINGLE argv element — never interpolated, never a shell string, never a client path.                                                                                                                                                                                                                                                                                                                                                       |
| T-06-02 | Elevation                               | `routes/cards.route.ts` (`/open-editor`)                                                                                                               | The launch path comes ONLY from `card.workspacePath` (created by the saga); the client sends only the `editor` discriminant (`code`/`cursor`), never a filesystem path.                                                                                                                                                                                                                                                                                                                                                                         |
| T-06-03 | Information Disclosure                  | `adapters/editors.ts`, `routes/cards.route.ts` (`/open-editor`)                                                                                        | Absolute editor paths never leave the `editors` module (only availability booleans + the spawn side-effect escape); no 400 body ever echoes a path — messages name the editor id / "workspace".                                                                                                                                                                                                                                                                                                                                                 |
| T-06-04 | Denial of Service                       | `adapters/editors.ts`, `routes/cards.route.ts` (`/open-editor`)                                                                                        | A final launch failure (after one re-resolve-and-retry) is logged server-side, never thrown into the request or the process — it reaches the caller's fire-and-forget `.catch`, which logs it.                                                                                                                                                                                                                                                                                                                                                  |
| T-06-05 | Spoofing                                | `routes/cards.route.ts` (`/open-editor`)                                                                                                               | `/open-editor` lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — no new mount, no second gate.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T-08    | Spoofing / Elevation / Info. Disclosure | `web/hooks/useTransitionNotifications.ts`, `web/hooks/useUnseenActivity.ts`, `routes/cards.route.ts` (`/cleanup`), `services/orchestration/cleanup.ts` | Notification/localStorage + cleanup safety: the first snapshot after connect/reconnect only SEEDS the previous-column ref (never notifies), so a reboot/reconnect can't spam notifications (T-08a-02); all localStorage access is try/catch-wrapped, degrading cosmetically and self-healing on next open (T-08a-03); cleanup derives every path/session from `card.*` + configured `repoPaths`, never the request body (T-08b-01 EoP), inherits the loopback gate (T-08b-03), and NEVER deletes a branch — branches always survive (T-08b-05). |

## Known Residuals

### Worktree Path

The worktree path builder `path.join(workspacePath, path.basename(repoPath))` was once duplicated
**byte-identically** across `services/orchestration/steps.ts` and `services/orchestration/cleanup.ts` (inventory ID `NEW-12`,
do-not-change contract #8). A wrong path removes the wrong worktree, so the two sites had to agree
exactly — the restructure resolved that hazard by extracting the single canonical builder
`worktreePath()` to `services/domain/workspace-paths.ts`, which both former sites now call. The CONTRACT
is unchanged and this section is its do-not-change home (cited by the `workspace-paths.ts`
header): the worktree for a repo lives under the ticket workspace, named by the repo's final path
segment, and the produced string must remain identical to the construction above.

### Unwired `StartupErrorScreen` (`BOARD-05`)

The `StartupErrorScreen` component was BUILT but never WIRED to any data source. The Phase 12
frontend restructure resolved the deferred wire-or-delete decision to DELETE it (dead code — no
importers). The invariant home for `BOARD-05` remains [Startup Preflight](#startup-preflight): the
backend fails fast and EXITS on a missing binary or missing/incomplete config — it never serves a
degraded state — so there is no backend signal for a mirrored error screen; a total connection
failure surfaces as the SyncStrip "Disconnected" state instead. The component file and its
knip-ignore entry are both gone. The `board === null` / disconnected pre-board state now renders a
PRESENTATIONAL Dispatch brand lockup in `App.tsx` (a routing `Glyph`, the `DISPATCH` wordmark, and
the current connection-status text) — this is purely cosmetic startup chrome, not a revived error
screen: there is still no backend degraded-serving signal and nothing mirrors a preflight failure
back to the browser.

### Primitive Interaction-State Normalization (`FE-02`)

The Phase 13 primitive extraction consolidated hover/focus treatment into the shared `Button` and
`IconButton` primitives: every consumer now gets the uniform hover lift and the keyboard-only
(`:focus-visible`-gated) accent focus ring. This ACCEPTS a small interaction-state normalization
relative to the pre-primitive UI — the X-close icon buttons (panel header, modals) and
CleanupModal's "Keep workspace" button previously had no hover background/lift and now share the
uniform one. Resting-state pixels are identical everywhere. Deliberately NOT made opt-out: a
`plain`/no-hover variant would fragment the primitive API for three call sites whose divergence
was historical accident, not design intent.
