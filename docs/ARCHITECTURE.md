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
  - [Column Transition Specification](#column-transition-specification)
  - [Group Card Titles](#group-card-titles)
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
  - [Design System Invariants](#design-system-invariants)
  - [App Shell Zones](#app-shell-zones)
- [Do Not Change Contracts](#do-not-change-contracts)
- [Security Threat Model](#security-threat-model)
- [Known Residuals](#known-residuals)
- [Verification Gates](#verification-gates)

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

### Column Transition Specification

`BOARD-06` is the executable FLOW-01 answer to "every column transition has exactly one owner and
one intended outcome": a code table (`shared/column-transitions.ts`) plus this hand-maintained
prose table, both carrying the invariant id so the gate can verify presence in both homes without
requiring the two to be mechanically generated from one another. Fifteen triggers, against their
legal source column(s), target, and owning code path:

| Trigger                                                      | Source column(s)                                                                 | Target                               | Owner                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Hook `Stop` + `DISPATCH_STATUS: DONE`                        | any except `APPLY_MARKER_EXCLUDED_SOURCES`                                       | `agent_done`                         | `hook-events.ts#applyStopEvent` → `board.store.ts#applyMarker`                            |
| Hook `Stop` + `DISPATCH_STATUS: NEEDS_INPUT`                 | any except `APPLY_MARKER_EXCLUDED_SOURCES`                                       | `needs_input`                        | same as above                                                                             |
| Hook `UserPromptSubmit`                                      | `FLIP_BACK_SOURCES` (`needs_input`, `agent_done`, `in_review`)                   | `in_progress`                        | `hook-events.ts#applyPromptSubmit` → `board.store.ts#flipBack`                            |
| Hook `PreToolUse` (pause-class tool)                         | any except `APPLY_MARKER_EXCLUDED_SOURCES`                                       | `needs_input`                        | `hook-events.ts#applyPreToolUseEvent` → `applyMarker`                                     |
| Hook `PostToolUse` (pause-class tool)                        | `FLIP_BACK_SOURCES`                                                              | `in_progress`                        | `applyHookEvent`'s `PostToolUse` branch → `flipBack`                                      |
| Watcher marker decision (pane-parsed)                        | any except `APPLY_MARKER_EXCLUDED_SOURCES`                                       | `needs_input` / `agent_done`         | `watcher.ts#scanSession` reading pure `scan-decision.ts#decideScan` → `applyMarker`       |
| Watcher flip-back decision                                   | `needs_input` ONLY                                                               | `in_progress`                        | same path → `flipBack`                                                                    |
| Manual drag / `POST /cards/:id/move`                         | any except `agent_done` as a target, and never `todo → in_progress` (`BOARD-07`) | any allowed pair                     | `board.store.ts#moveCardManual`, gated by `routes/cards.route.ts`                         |
| Group member mirroring (fan-out, not an independent trigger) | mirrors the writer that triggered it                                             | mirrors the writer that triggered it | `board.store.ts#mirrorMemberColumn`, called from exactly 5 writers                        |
| Session-lost (3-strike detector, boot reconcile)             | column-preserving                                                                | column-preserving                    | `board.store.ts#markSessionLost`                                                          |
| Resume / resume-failed                                       | column-preserving                                                                | column-preserving                    | `board.store.ts#resumeSession` / `#recordResumeFailure`                                   |
| Cleanup (Done teardown)                                      | column-preserving (already `done`)                                               | column-preserving                    | `services/orchestration/cleanup.ts` + store cleanup mutators                              |
| Card creation                                                | — (new card)                                                                     | `todo` or `inbox`                    | `createLocalCard` / `createGroupCard` / `newInboxCard` via `store/mapping.ts#applyIssues` |
| Boot hydration legacy migration                              | `in_planning` (retired)                                                          | `todo` / `in_progress`               | `board.store.ts#hydrateFromParsed`, one-way, skips `mirrorMemberColumn`                   |
| Start-saga success                                           | any                                                                              | `in_progress`                        | `board.store.ts#completeStart` / `#attachExistingSession`                                 |

Every conflict this spec was written to name is now closed and reflected in the table above:
`flipBack`'s guard is `FLIP_BACK_SOURCES` rather than `needs_input` alone; the Inbox marker-guard
hole is closed store-side via `APPLY_MARKER_EXCLUDED_SOURCES`; `moveCardManual`'s blind set into
`agent_done` and `todo → in_progress` is closed by `isManualMoveAllowed` (`BOARD-07`); and
`applyMarker` takes its activity-event type from the caller rather than deriving it from the
target column (`WR-05`). One deliberate residual remains and is NOT a conflict: under
`statusChannel: "auto"` both channels are live until a session's first authenticated hook event,
because that latch is evidence, not a prediction — see
[Hooks Status Channel](#hooks-status-channel).

`BOARD-07` is the executable answer to FLOW-03/04: `moveCardManual` (`board.store.ts`) now
consults `isManualMoveAllowed(from, to)` — exported from `shared/column-transitions.ts` alongside
its two named predicates, `blocksAgentDoneManualEntry` and `blocksTodoToInProgressManualMove` —
inside its `enqueue` callback against the live Map, the TRUE single-writer authority. Agent Done
can never be a manual target from any source (only a real `applyMarker` completion signal may
enter it), and `todo → in_progress` is reserved for the start saga, which provisions a session a
manual move would not. `routes/cards.route.ts#manualMoveTransitionError` reads the SAME predicates
to return a legible `409` before `moveCardManual` is ever called, so the route's message and the
store's silent guard can never drift apart. Every other `(from, to)` pair the pre-Phase-77 blind
set allowed stays allowed unchanged.

Agent Done and In Review carry OPPOSITE asymmetries. Agent Done has an automatic in-edge (a
marker) and, before Plan 77-01, no automatic out-edge except an already-intentional
`agent_done → needs_input` on a new distinct marker (`applyMarker`'s own guard, unchanged). In
Review has NO automatic in-edge (deliberately deferred, out of this phase's scope, see
[In Review Lifecycle](#in-review-lifecycle)) but DOES have automatic out-edges (marker to
needs_input / agent_done, and, after Plan 77-01, prompt-driven flip-back to in_progress).

The watcher never drives the `agent_done`/`in_review` flip-back edges: `decideScan` only ever
emits a `flipBack` decision when its input column is `needs_input`, so only the hook channel
(`UserPromptSubmit`, the `PostToolUse` pause-resume branch) drives those two edges. This asymmetry
is a named fact, not a bug — see [Watcher Discriminator](#watcher-discriminator) for the pure
decision function this table's watcher rows read.

`BOARD-06` — see also [Attention Routing](#attention-routing) and
[In Review Lifecycle](#in-review-lifecycle), which both cross-reference this section for the full
transition spec behind the attention/lifecycle behavior they describe.

### Group Card Titles

A group card's title now describes the grouped tickets' common thread, replacing the old
unbounded identifier-join default (`PROP-1 + PROP-2 + ...`). The title is write-once at
group-creation time: there is no rename route, and none is added, because the title is baked into
the agent's kickoff at start time (`kickoff.ts`) and never re-sent — a rename after start would
desync the card's visible label from what the running agent was already told it is working on.

`ORCH-05` is the background generation contract: a headless `claude -p` subprocess
(`group-title-generate.ts#generateGroupTitlePhrase`), modelled on
`ticket-generate.ts#generateTicketDraft` with the same fixed-literal argv (only the prompt is
request-derived), reads each member's `identifier`/`title`/`project` — never `description`, the
largest attacker-influenced surface on a Linear-sourced card — and proposes a short phrase. Its
20s timeout is deliberately far shorter than `ticket-generate.ts`'s 150s, since this is a
background prefill on a modal the user may Start within seconds, not an explicit user-initiated
wait. Output is double-screened (`DISPATCH_STATUS` marker rejection plus a hard length clamp) the
same way `ticket-generate.ts` screens its own output. `POST /cards/group-title`
(`cards.route.ts`) single-flights the route with its own `groupTitleInFlight` boolean, deliberately
separate from `draftInFlight`, returning 409 on a concurrent call rather than fanning out parallel
subprocesses. Abort is wired to `res.on("close")`, NOT `req.on("close")` — the latter fires the
instant the request body is fully read, well before any response is sent, which is the exact bug
`draftInFlight`'s own history records (`/cards/draft` silently aborted every real invocation until
fixed); this route was written correctly from its first commit.

`MODAL-01` is the client-side no-visible-wait gate: the deterministic default
(`deterministicGroupTitle`, see Plan 78-01) fills the title field INSTANTLY on modal open — zero
network round trip — so the field is never empty. The background generation call races the user
in a mount-time effect, and its result (`shouldAcceptGeneratedPhrase`) is applied ONLY if the user
has not typed since the field was set; any keystroke wins permanently for the life of the modal.
Start is gated on nothing but a non-empty trimmed title, exactly as before this phase — generation
is a pure enhancement that lands or does not, never a barrier, and a generation that times out or
fails is abandoned silently with the deterministic fallback left in place.

`SEC-01` is the kickoff-seam fencing contract: **every** title interpolated into a kickoff prompt
is fenced by `kickoff.ts#fenceTitle` — `buildKickoff`'s head-line `card.title`, and each group
member's `m.title` in `groupTicketSection`, on both the Linear bullet line and the local-member
`## <identifier>: <title>` header. Fencing is two steps, and both are load-bearing:

1. **Flatten every line break to a single space.** The break class is deliberately wider than
   `\n` — a lone `\r`, NEL (U+0085), LS (U+2028) and PS (U+2029) each start a new rendered line in
   a terminal, and JavaScript's `\s` never covers U+0085. `linear-sync.ts#buildPrompt` carries the
   same class for its own title copy; the two are deliberate copies and are widened together.
2. **Defuse any embedded status-marker token**, by breaking the colon that `MARKER_RE` anchors on.
   Flattening alone does NOT close the marker-spoof path: the kickoff is pasted into the live pane
   and the TUI hard-wraps its echo, so a flattened title merely moves the token mid-line, and a
   wrap landing just before it puts the token back at line start. Measured against the real parser,
   a flattened `- PROP-123: Fix login flow <token> DONE — shipped` re-parsed as a DONE marker at
   every word-wrap width from 26 to 42 columns — well inside split-pane range. The
   `STATUS_PROTOCOL` block is the one sanctioned source of that token in a kickoff, and never
   passes through the fence.

Fencing member titles is not optional hardening. Linear provenance is a statement about where a
value came from, never a statement that it is trusted: every member of a Linear workspace, and
every integration holding a write-scoped key, can set an issue's title, and nothing on the ingest
path (`store/mapping.ts`, `sources/*`) flattens or screens one. An unfenced multi-line title emits
its tail as a STANDALONE line inside the agent's own operator prompt — the highest-trust register
the agent has — and that line is also seen by `adapters/markers/parse.ts`, whose `MARKER_RE` is
line-anchored and scans the whole pane, so a title tail shaped like a status marker forges a
column transition on a session that is still running. For a Linear-sourced group member the title
is in fact the ONLY attacker-influenced text in the kickoff, since such a member contributes no
inlined description, only the batched MCP-read instruction.

A group member's `description` is deliberately NOT fenced: inlined description content is
multi-line by design (it is content, not a single-line field), and only local-source members carry
one.

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

The same transition batch also drives the gentle chime (`web/lib/chime.ts#playChime`, synthesized
via Web Audio oscillators — no bundled audio asset): gated independently of the Notification
permission by `soundEnabled` (Settings ▸ Notifications, a per-browser `localStorage` preference —
`dsp.sound` — lifted into `App.tsx` state and threaded into the hook as a parameter, never into
`~/.dispatch/config.json`, since it is a per-device preference, not shared server config). It plays
at most ONCE per effect run regardless of how many cards transition in that snapshot, so a burst of
simultaneous arrivals stays one ding rather than an overlapping barrage; each transitioned card
still gets its own desktop Notification independently.

The related unseen-activity dot (the SAME attention surface, a different trigger) is homed in
[Watcher Discriminator](#watcher-discriminator) — `@see` that section for the dot's
seed-on-first-observation baseline and why it deliberately carries NO flip-back debounce.

The full column-by-column transition spec behind which triggers move a card INTO an attention
column lives in [Column Transition Specification](#column-transition-specification) (`BOARD-06`).

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

**Bounded consecutive probe-failure ceiling — 3 consecutive detection-tool failures (`RESIL-02`).**
The same shape as `RESIL-01`, applied to the artifact-detection probes (`adapters/artifact-detect.ts`):
a per-card counter increments ONLY on a genuine detection-tool failure — an `{ ok: false }` result
from `listPrsForBranch` for the PR probe, or a `null` return from
`panePidsBySession`/`listeningPortsBySession` for the preview probe — never on a
`confirmReachable`-rejected candidate, which is a successful tick that confirmed zero previews and
resets the counter instead. The unknown status (`prsUnknown`/`previewsUnknown`) is set on the FIRST
failure so a silent tooling failure is visible immediately; the underlying data (`prs`/`previews`)
is left alone below the ceiling — the existing `null`-vs-`[]` staleness contract stays intact for a
single blip — and is only forced to `[]` once three consecutive failures accrue, so a permanently
dead probe cannot leave a stale PR or port sitting on the board forever. Both counter maps are
pruned every tick to `probedCards()`'s current ids (`cardsWithSession()` minus Done — see
[Dev-Server Preview Detection](#dev-server-preview-detection)) so a torn-down card's streak can
never resurrect against a reused id, and a card that leaves Done for a live column starts fresh
rather than carrying over a stale streak from before it was excluded.

**The ceiling governs stale data only, never data fetched in the same tick.** A multi-repo card's PR
probe fans out per repo, and the counter advances when ANY repo fails — so a single permanently
unresolvable repo (a sibling owned by an inactive `gh` account is the everyday case) drives the
counter up without bound while its neighbours keep answering. Forcing `prs` to `[]` on that counter
deleted the neighbour's freshly-fetched, live PR and, because the write-skip diff then matched every
subsequent tick, it stayed deleted until the failing repo recovered. Repos that answered `ok: true`
this tick are therefore always written through; the ceiling applies only when NO repo answered,
where it is genuinely choosing between stale data and nothing. Below the ceiling in that
total-failure case the write is suppressed outright rather than writing an empty list, which is what
makes "left alone below the ceiling" true of the PR path and not just the preview path.

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
not race that into a spurious session-lost). Reconcile mirrors this guard NARROWLY: it skips only
the session-lost-marking/Restart-promotion branch for To Do and Done, protecting both columns
symmetrically even though a todo card cannot hold a live session post-load. A Done card awaiting
deferred cleanup (`LIFE-02`) now legitimately holds a live session for days, so it still has its
ttyd adopted and its hook token re-registered on every restart — skipping those too would sweep a
live terminal as an orphan on every boot.

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
and the card never bounces straight back out (MARK-04 drag-wins). That holds until the first
prompt: `BOARD-06` made `in_review` a `flipBack` source, and flipping out of it CLEARS
`lastMarker`, so a `UserPromptSubmit` (or a pause-tool `PostToolUse`) both moves the card to In
Progress and re-arms the marker it had consumed. The consumed-marker guarantee is therefore scoped
to the card's stay in In Review, not to the marker's lifetime. Any drop into In Review is a
plain optimistic move — To Do → In Progress remains the only orchestrating drop. Cleanup teardown
remains Done-ONLY: In Review inherits NONE of Done's parked semantics or teardown wiring, so its
session, terminal, and worktrees stay alive until an explicit drop into Done.

**Resume is column-independent and column-preserving by construction (`REVIEW-01`).** When any
session dies but its `card.workspacePath` survives, the card and panel offer Resume. Resume
relaunches `claude --continue` in the preserved cwd with NO kickoff prompt re-sent. Its store
mutation sets `tmuxSession` and clears `sessionLost` but DELIBERATELY never writes `column`, unlike
`completeStart`/`attachExistingSession`, which force `in_progress`. This is how Resume coexists with
the [Resilience and Reconcile](#resilience-and-reconcile) `IN-03` hazard: a column-preserving
mutation performs no promotion and is therefore safe in every column.

In Review's opposite in-edge/out-edge asymmetry versus Agent Done, and the full trigger-by-trigger
spec, are homed in [Column Transition Specification](#column-transition-specification) (`BOARD-06`).

### Terminal ttyd

**ttyd is a headless PTY backend only; dispatch never serves its index.** The per-session ttyd
manager (`adapters/ttyd.ts`) spawns, tracks, and reuses a writable, loopback-only ttyd attached to
an existing `dsp-<identifier>` tmux session so the live `claude` REPL can be embedded in the
detail-panel iframe (`TERM-01`). Its invocation is ONE fixed, unconditional shape — no environment
variable selects an alternate form: `ttyd -W -i 127.0.0.1 -p 0 -b /sessions/<cardId>/terminal -t
disableLeaveAlert=true -t DISPATCH_TTYD_REVISION_<revision>=1 tmux -u attach -t =<session>`. The two
`-t` tokens are `disableLeaveAlert` and the inert retained-key revision token — there is no
`-I <index>`, no `-t theme=`/`fontFamily`/`fontSize`: look, font, and every interaction pattern are
entirely client-owned (below), and the retained-key token is now the SOLE re-adoption fingerprint
(the old flag-OFF JSON theme marker this token used to coexist with is retired — a ttyd spawned by
an older, pre-retirement dispatch build no longer matches `compatible` and is swept rather than
adopted on the first restart after this ships, a deliberate one-time degradation, never a
regression).

**A pre-2.7.0 ttyd is only sweepable because of the base-path arm (`TERM-05`).** The paragraph
above understated the problem when it shipped: ttyd rewrites its own argv buffer at startup
(rendering `-t key=value` as `-t key value`), and when an earlier token is large enough to fill
that fixed buffer the **trailing command is dropped from `ps` outright** — empirically confirmed
against ttyd 1.7.7 with a ~140KB `-t`. A pre-2.7.0 ttyd carries exactly such a token (the retired
theme JSON), so it shows no `tmux attach` at all, and its revision marker is by definition not the
current one. It therefore matched NEITHER sweep arm and could never be adopted: it leaked across
every restart and upgrade, holding its port and serving its session from the retired patched index
indefinitely, while a second ttyd was spawned alongside it for the same card. Ownership must
therefore never depend on trailing argv surviving. `-b /sessions/<cardId>/terminal` is early enough
to always survive the rewrite and specific enough to be dispatch's own, and is matched as a third
SWEEP arm. Re-adoption (`compatible`) is unchanged and still demands the exact current revision
key — a re-adoption fingerprint may only ever narrow.

**`tmux -u` is load-bearing, not decorative (`TERM-04`).** The attaching tmux client inherits the
backend's environment, and tmux otherwise derives its UTF-8 mode from `LANG`/`LC_ALL`/`LC_CTYPE`. A
launchd-started dispatch service is handed a minimal environment with no locale at all, and a
non-UTF-8 tmux client substitutes `_` for every non-ASCII cell **as it writes to the pty** — so
`⏺`, em dashes, arrows, and box drawing reach ttyd, the WebSocket, xterm.js, and the bundled font
already destroyed. The pane behind them stays correct, which is why `capture-pane` and every
pane-content probe report clean while the terminal renders garbage; the bundled font's cmap is
never involved. `-u` states the client's UTF-8 mode outright. It is preferred over injecting a
synthetic `LANG` into the spawn environment because it scopes the assertion to the attaching client
and leaves the environment the `claude` process itself sees untouched.

**Every GET on `/sessions/:id/terminal/*` is answered by dispatch's own built bundle.**
`terminalProxyRouter` (`routes/terminal-proxy.route.ts`) resolves the card's live ttyd port and
404s on an unknown card FIRST, exactly as before; a GET past that check is served from
`WEB_DIST_DIR` via `res.sendFile(relPath, { root: WEB_DIST_DIR })` (the `{ root }` form confines
send's dotfile/`..` traversal policy to the relative segment). Non-GET requests still forward to
ttyd via `httpForward` — unchanged, so nothing about the route's non-GET behavior is disturbed by
retiring the served-index patch system. Only the WebSocket upgrade ever reaches ttyd, through the
unchanged `terminalProxyUpgrade`/`upgradeForward` path: `server.on("upgrade")` intercepts it before
Express ever sees it, headers/rawHeaders and the buffered `head` chunk forward verbatim, `agent:
false` on the HTTP leg, and the `writableFinished` premature-disconnect guard all stay exactly as
they were.

**The client owns theme, font, links, and scroll — none of it is a string patch anymore.**
`GET /api/terminal-theme` (`services/infra/terminal-theme.ts`) resolves the user's real Ghostty
config live (`ghostty +show-config`, parsed into an xterm `ITheme` plus font block) and falls back
to a bundled Catppuccin Mocha constant on any failure — the resolver never throws, so the terminal
always opens themed rather than in raw xterm defaults. The bundled Nerd Font is self-hosted from a
base64 data-URI `@font-face` with `font-feature-settings: "ss01" 1, "calt" 1, "liga" 1` on `.xterm`
under the DOM renderer (no WebGL addon needed — the DOM renderer shapes font features natively).
Cmd-click (plain-text via `WebLinksAddon` AND OSC-8 via `linkHandler`, both sharing one
reverse-tabnabbing-safe `activateLink`) and Shift+Enter newline insertion (raw LF on `keydown`,
both `keydown`/`keypress` swallowed for the same keystroke, IME-composition-safe) are first-class
client functions in `web/terminal-main.ts`, not anchor-matched string patches into ttyd's own
bundle. Mobile gets a kinetic (momentum) scroller and a persisted pinch/stepped zoom control that
raises the effective column count — see `TERM-03` below for the contract that makes both safe.

**`TERM-03`: the native client's load-bearing scroll/theme contract.** `term.scrollLines()` is a
verified no-op in the alternate buffer (100% of the real Claude/tmux workload), so the kinetic
scroller never calls it — it dispatches synthetic `WheelEvent`s with `deltaMode: 1` at
`term.element` instead, one tick per mouse report. The wheel path is gated on
`mouseTrackingMode` being neither `"none"` NOR `"x10"`: X10's event mask is `DOWN`-only, so an
engaged wheel there would be re-encoded by xterm as `ESC[A`/`ESC[B` and typed straight into the
live `claude` prompt — engaging in that state is strictly worse than not scrolling. One synthetic
tick equals one mouse report. A live `claude` REPL pane carries `alternate_on=1` and
`mouse_any_flag=1` (measured), so tmux's default root `WheelUpPane` `if-shell` takes its
`send-keys -M` branch and forwards the report to the pane app — not to tmux itself. Claude Code,
not tmux, is therefore the report's consumer, and it scrolls exactly one line per report (measured
1→1, 5→5, 6→6). The kinetic accumulator scales by `rowHeight * 1`: one report per one row of finger
travel. Calibrating to tmux's `copy-mode` `send-keys -X -N 5 scroll-up` binding instead — as v2.7
originally did — is what caused a 5x under-scroll, because that binding is never reached in this
workload (`history_size=0` proves copy-mode has nothing to show to scroll). At one line per report,
`drain`'s `perTick` is a single row (~17px), so a `drain` call that hits `maxTicksPerDrain` is
handling ordinary finger travel, not an outlier — its remainder MUST carry into the next call rather
than be discarded, or a fast drag silently loses distance. The one accepted exception: a pane at a
bare shell prompt (`mouse_any_flag=0`, `alternate_on=0`) with tmux `mouse on` falls through to
`copy-mode -e` and genuinely is 5 lines per report, so that case over-scrolls 5x. The browser cannot
observe the pane app's mouse mode, so this is knowingly accepted rather than mis-calibrating the
~100% case that actually runs Claude Code.
`#terminal, #terminal .xterm { touch-action: none }` — NOT `pan-y` — is deliberate: the
client dispatches the wheel events itself, so granting the browser vertical panning double-scrolls,
and `none` additionally removes Chrome's "scroll already started, preventDefault ignored" race.
`html, body { -webkit-text-size-adjust: 100% }` is load-bearing for the same reason: without it,
iOS text inflation breaks the `charWidth ∝ fontSize` relationship the zoom / effective-column-width
feature's math depends on. The theme resolver's never-throws contract (above) is part of the same
invariant — a themed terminal must open even when Ghostty is absent or its config fails to parse.

**Adoption is runtime-revision gated on the retained key alone.** ttyd rewrites its process title
but retains the direct tmux command, so an inert `DISPATCH_TTYD_REVISION_<revision>` argv token
keeps both the exact compatibility marker and existing ownership fingerprint visible in `ps`. The
legacy ownership fingerprint remains exactly `basename(argv0) === "ttyd"` plus `tmux` and `attach`.
macOS ttyd's rewritten process title has a fixed buffer that can truncate the trailing command; for
revised processes, `basename(argv0) === "ttyd"` plus the exact Dispatch-only revision literal is the
stronger ownership proof. Every legacy fingerprint match and every exact-marker match is still an
orphan-sweep candidate, but only a PID carrying the exact current retained-key revision marker may
be adopted and spared. Legacy or otherwise incompatible ttyd processes are declined, their persisted
ports clear through reconcile, and the sweep terminates them; the tmux session survives for a fresh
ttyd. Bump the revision whenever an upgrade changes the argv shape, font contract, client
preferences, or other in-memory ttyd behavior that cannot be repaired in an already-running process.
A failed `ps` or `lsof` scan remains fail-closed for adoption and never crashes boot.

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

**tmux must be granted the `hyperlinks` terminal-feature, or the client's `linkHandler` has nothing
to resolve.** OSC-8 link activation is now the client's own `linkHandler` (`web/terminal-main.ts`),
but the OSC 8 bytes themselves have to reach the browser first — and tmux's own default
`terminal-features[0]` entry for `xterm*` (`clipboard:ccolour:cstyle:focus:title`) omits
`hyperlinks`. Without it, tmux's grid tracks a real Claude Code `⏺` output's OSC 8 hyperlink
internally (`capture-pane -e` proves the escape exists server-side) but never forwards it to an
attached client's byte stream — xterm.js's `OscLinkProvider` then has zero cells with the extended
`urlId` attribute to resolve, no matter how correct the client's own link handling is
(live-discovered defect, 59-02-SUMMARY.md). `ensureHyperlinksTerminalFeature` (`adapters/tmux.ts`)
grants `xterm-256color:hyperlinks` — the exact TERM string ttyd's spawn argv above declares —
idempotently (`tmux show -g terminal-features` checked before `set -ag`, since it is a tmux
SERVER-global option that would otherwise duplicate on every backend restart across the tmux
server's much longer lifetime) and never throws. It runs at boot AND after every successful
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
session the terminal region is exactly one `<iframe src="/sessions/${card.id}/terminal/">` (a
relative path, resolved same-origin against the app's own origin via the reverse-proxy described in
[Terminal (ttyd)](#terminal-ttyd)) rendered at a FIXED position in the JSX tree, and it must stay
identity-stable across four separate mutations:

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
  top-level browsing context; an `<iframe>` is always a separate browsing context regardless of
  origin (the terminal iframe is same-origin as of Phase 72's reverse-proxy, `src` is a relative
  `/sessions/${card.id}/terminal/` path — `@see` [Terminal (ttyd)](#terminal-ttyd) — but that does
  not change the browsing-context boundary), and a
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

  Touch drags on this handle have two distinct, separately-diagnosed root causes, not one. The
  handle renders only under `!docked && !effectiveFullscreen`. First, below the `CAROUSEL_QUERY`
  breakpoint (`max-width: 1023px`) in the UNDOCKED panel, the handle deliberately does not exist:
  that query makes `takeover` true, which makes `effectiveFullscreen` true, so the guard fails via
  its `!effectiveFullscreen` term. The panel is `100vw` there, so there is no width to trade — this
  is intended behavior, not a defect, and the
  breakpoint was deliberately not lowered to add one. In DOCKED (Orca) mode the handle is absent
  at every width instead, via the guard's `!docked` term — `takeover` is `false` in docked mode
  regardless of viewport, so `effectiveFullscreen`/`CAROUSEL_QUERY` play no part there. Second, at
  `>=1024px` in the undocked panel the handle DID render but declared no
  `touch-action`, which was the actual bug: with the default `auto`, the browser is free to decide
  mid-gesture that a finger's perpendicular jitter on an 8px target is an attempted page pan, take
  the gesture over, and fire `pointercancel` on the handle — which `handlePointerCancel` correctly
  treats as an abort and restores `preDragStyleWidth`, producing a silent snap-back that reads as
  "touch just does not work here." The fix is `touch-action: none` on the handle — that is the
  load-bearing declaration, because the browser resolves a pointer's effective touch-action once,
  at contact, from the hit-tested element's ancestor chain; the overlay does not exist yet at that
  moment (it is created inside the `pointerdown` handler) and is not an ancestor of the handle in
  any case, so its own `touch-action: none` cannot affect the in-flight drag — that pointer's
  events stay addressed to the handle via `setPointerCapture` regardless of where the finger
  travels. The overlay's `touch-action: none` is defence for a SECOND pointer landing on it
  mid-drag; `handleResizePointerDown`'s re-entrancy guard (`cleanupDragRef.current != null`, first
  statement) now rejects that second pointer outright, so this is belt-and-braces, not
  load-bearing. It is deliberately NOT `touchstart`/`touchmove` plus `preventDefault()`, which
  would run a second event pipeline competing with the existing Pointer Events one for the same
  physical gesture. Once `touch-action: none` is declared, `pointercancel` reverts to meaning a
  genuine cancellation, so its abort-and-restore semantics above are correct as written and
  unchanged.

  The handle's STYLING coarse-pointer branches (24px hit width, persistent grip icon) gate on
  `(pointer: coarse)`, which reflects device capability, not the live input: on a touchscreen
  laptop it stays true while a mouse is in use, and on an iPad it stays true with a Magic Keyboard
  trackpad attached (WebKit deliberately scoped its `any-pointer`/`any-hover` fix to the
  `any-`-prefixed queries only, leaving the primary `pointer`/`hover` queries touch-sticky — bug
  209292). This is deliberately over-broad but harmless: the wider hit area and the grip icon are
  a strict superset of the fine-pointer rendering, painted before any pointer exists, so there is
  nothing for a live `pointerType` to gate. Do not read a coarse render as proof the user is
  touching the screen.

  The TAP-THRESHOLD branch does NOT use `(pointer: coarse)` — unlike the styling above, an
  8px-vs-3px threshold that fires on the wrong pointer type is not harmless (it would silently
  raise the threshold for a mouse drag on the same hybrid hardware), so
  `handleResizePointerDown` reads `e.pointerType` once at `pointerdown` and captures it as
  `coarseGesture` for that drag's closures. This is per-drag capture, not the per-`pointermove`
  `pointerType` sniffing this section warns against elsewhere — the value is fixed for the whole
  gesture, exactly like `isCoarsePointer` is fixed for the whole render.

**The handle is also a keyboard-operable `role="separator"`.** It declares
`aria-orientation="vertical"`, is focusable (`tabIndex={0}`), and reports
`aria-valuenow`/`aria-valuemin`/`aria-valuemax` tracking the live rendered width. `ArrowLeft`
widens the panel and `ArrowRight` narrows it — reversed from an intuitive left-to-right slider
because the panel is anchored to the right edge, so leftward growth is what a pointer drag in
that direction already produces. Both input modes read one pair of module constants
(`PANEL_MIN_WIDTH_PX`, `PANEL_MAX_WIDTH_RATIO`) so the pointer and keyboard paths can never
disagree about the resizable range, and both commit through the same `setPanelWidth` call so a
keyboard resize persists identically to a pointer one. The `aria-valuenow`/`aria-valuemax`
values are fed by a `ResizeObserver` watching both the panel `<aside>` and
`document.documentElement`, gated off (`resizing` state) for the duration of a pointer drag so
the observer never fires mid-drag and never re-renders the panel while the pointerup write is
still imperative — preserving the drag's instant-feel, remount-free contract. The handle does
not render below `CAROUSEL_QUERY`, for the same reason the touch discussion above gives: takeover
forces the panel to `100vw`, so there is no width left to trade — a deliberate non-fix, not a gap
to close.

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

**The embedded terminal client this iframe loads is fenced out of Phase 87's diff (`NEW-20`, see
[Design System Invariants](#design-system-invariants)).** This section covers the panel CONTAINER
around the terminal — the `<iframe>`'s identity, mount lifecycle, and sizing; `NEW-20` covers the
terminal client itself (`src/web/terminal-main.ts`, `src/web/terminal.html`), which this phase may
not touch.

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

**Claude launch arguments (Settings ▸ Models).** The "starting claude" step's argv is not
hardcoded: it is `[claudePath, ...(hook flags), ...parseClaudeArgs(config.claudeArgs)]`, where
`config.claudeArgs` is a free-text string persisted at `~/.dispatch/config.json`'s top-level
`claudeArgs` key (default `--dangerously-skip-permissions` — Dispatch's original hardcoded
behavior, so an un-migrated config is unchanged). `services/domain/claude-args.ts#parseClaudeArgs`
tokenizes the string on whitespace, honoring single/double-quoted segments so a flag value
containing spaces survives as one token; no shell is ever involved (`tmux new-session` execs the
argv array directly), so this is quote-aware tokenizing only, never shell interpretation — no
globbing, no `$VAR` expansion, no chaining. Both session-start (`services/orchestration/steps.ts`)
and Resume/Restart (`services/orchestration/resume-session.ts`) read the same
`getOrchestrationConfig()?.claudeArgs`, so a change in Settings applies to the very next
start/resume/restart with no backend restart. `PUT /config/claude-args` accepts any string up to
4000 characters — including empty, which means no extra arguments (Claude's normal permission
prompts) rather than falling back to the default; the boot loader tolerates the same range with no
upper bound to reject, matching `lastUsedPlaybook`'s tolerant-string posture rather than
`cleanupDelayDays`'s reject-on-invalid one, because any string is a valid argv source once
tokenized.

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
synchronous spawns — because command injection is the top threat for this phase.

The guarantee is **argv-array-only invocation**, and that is the whole of it. It is NOT that
untrusted values stay out of argv, and no code should be written on that assumption. Two prompt
builders pass ticket titles to `claude` as the `-p` argv element today:
`linear-sync.ts#buildPrompt` (a card's title and description) and
`group-title-generate.ts#buildPrompt` (every group member's title). What makes those safe is that
each prompt is ONE element of an argv array handed to `execFile` — no shell parses it, so no
metacharacter in it can mean anything. A helper that shell-quoted a value, or an `sh -c`
carve-out, would break the guarantee no matter how well the value was screened.

The distinct claims worth keeping separate: a ticket **identifier** is the only per-ticket value
that reaches a SESSION-layer argv (tmux session name, branch, worktree path), and it is
Linear-sourced or route-revalidated for local/group cards (see `T-02-16`); a **title** never
reaches the agent's session through argv — it travels in the kickoff file loaded into a tmux
buffer, fenced on the way in (`SEC-01`, see [Group Card Titles](#group-card-titles)). This is the
argv-only control recorded as `T-04-01` in the
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
`Map<Response, ClientWindow>` of active clients — each entry carrying that connection's own
Done-page window (`BOARD-08`) — and, on every store `"change"`, broadcasts a `BoardSnapshot` built
for each connection's CURRENT window, not one shared frame for all: a single-user board does no
event merging, the client replaces its state wholesale, but two connections at different Done
depths (e.g. desktop + a tunneled phone) now legitimately see different card sets. Each
durably-inserted event also rides the SAME connection as a distinct NAMED
`event: activity\ndata: <ActivityEvent JSON>\n\n` frame (on every store `"activity"`), alongside the
unnamed board `data:` frame and the named `ping` heartbeat. The stream is un-buffered (`X-Accel-Buffering: no`, `Cache-Control: no-cache`, and NO
compression on this route — compression would buffer and break liveness) and resync-on-connect (a
windowed snapshot is written the instant a client connects, at the `doneLimit` it requested). The
payload is a `BoardSnapshot` only (cards + syncedAt) — it NEVER carries the Linear API key or any
secret: `store.snapshot()` is the single outbound chokepoint and redacts `card.hookToken` from
every wire copy (SSE frames and REST reads alike), so the persisted per-session hook secret never
leaves the server. The `KEEPALIVE_MS` (15s)
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
crash the process; dead clients are pruned from the `Map` on both the broadcast path and the
per-connection `close`/`error` handlers.

**Windowed wire snapshot (`BOARD-08`).** `store.snapshot(opts?: { doneLimit })` is the single
read-path chokepoint for ordering, redaction, AND windowing — Plan 82-02 added the third
responsibility to the same function rather than forking a second builder, so the canonical order
and redaction guarantees can never drift out of sync with the windowed one.
`persistSnapshot()`/`board.json` stay FULL and un-windowed always; only the returned wire `cards`
array is ever sliced. The window applies to TOP-LEVEL Done cards only (`column === "done" &&
groupId == null`) — every other column (and every card outside Done) rides the wire in full, since
Done is the only column Phase 81 made grow without bound. Within Done, `compareDoneOrder` sorts
awaiting-cleanup cards first, then newest-updated, then `id` as a total-order tiebreak — the
tiebreak is what makes a larger `doneLimit` a strict superset of a smaller one, so growing the
window can never skip or repeat a row. A Done GROUP MEMBER rides the wire whenever its parent
does, dropped only when its parent is a top-level Done card sitting outside the page, so
`membersOf()` never sees a half-populated group. `doneCounts: { awaiting, cleaned, total }` is
computed from the FULL in-memory set on every call regardless of the window, so the Done column
badge and the Phase 81 awaiting/cleaned split stay truthful even when only a page of Done cards is
on the wire. `GET /api/board` and `GET /api/stream` carry the identical `doneLimit` query
parameter and MUST NOT diverge in shape — the REST fallback (v2.6's tunnel path) rejects an
invalid value with 400 (`T-82-01`), while the SSE connect path falls back to `DONE_PAGE_SIZE`
instead of rejecting the connection, since an `EventSource` retries a failed connect forever and a
400 there would be an infinite reconnect loop rather than an actionable error.

Plan 82-03 named and live-verified the one failure mode this design exists to rule out:
**load-more amnesia**. A per-connection window that is read only at connect time and never
re-applied inside the broadcast path makes "Load more" appear to work — the resync frame on
connect correctly carries the wider page — and then silently prune the very next unrelated
mutation anywhere on the board, because that broadcast reuses one shared, default-windowed frame
for every client regardless of what each one already loaded. The structural defense is that
`board.store.ts#enqueue` no longer pre-builds a snapshot to pass to its `"change"` emitter at all
(`store.on("change", broadcastChange)` receives no argument) — there is no shared frame left for
`broadcastChange` to accidentally reuse; `sse.route.ts`'s `byLimit` memo is the ONLY place a
`BoardSnapshot` is built for the broadcast path, once per distinct `doneLimit` among connected
clients. A live isolated-sandbox exercise (500 seeded Done cards, one connection grown to 150 via
reconnect, a second held at 50, three unrelated mutations in between) confirmed the grown window
survives every subsequent mutation and the two connections receive distinct per-window frames in
the same broadcast; a negative control that temporarily reverted `broadcastChange` to build one
shared `store.snapshot({ doneLimit: DONE_PAGE_SIZE })` frame for every client reproduced the exact
prune (a 150-card window collapsing to 50) on the same exercise, confirming the exercise can
actually detect the bug it rules out, not just fail to trigger it.

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
`store.snapshot()`). The `.tsx` site is homed here, not in JSDoc. Since `BOARD-08`, a Done card
"not present in `board.cards`" no longer means "does not exist" — it may simply sit outside the
current `doneLimit` window; `doneCounts` (not `cards.length`) is the truthful count source for the
Done column, and growing the window (Plan 82-03) is done by reconnect, never a client-side merge,
so this wholesale-replace contract needs no change to stay correct under windowing. The client-side
half of this consequence — the open detail panel, not just `doneCounts` — is handled in
`web/App.tsx`: every selection path (`selectCard`, `selectSearchResult`, the notification-click
handler) pins the currently-live card into `pinned` (`features/board/pinned-card.ts`'s
`PinnedCard`), and `useBoardStream`'s `onBoardUpdate` callback re-pins it on every subsequent
snapshot for as long as it stays live, so a card that later pages out of the window keeps showing
its last-known data instead of the panel silently closing.

`PinnedCard` carries a `kind: "stub" | "hydrated"` tag alongside the card (milestone-integration-
audit, closing a cross-phase blocker between this pinning and Phase 82-05's cleanup affordance):
`selectSearchResult` pins a `"stub"` (`stubToCard`'s filler-value placeholder for a card outside
the window, paired with `hydrating: true`) immediately for instant open, then replaces it with a
`"hydrated"` real card once `GET /api/cards/:id` resolves; `selectCard` and `onBoardUpdate` always
pin `"hydrated"`, since both source from a live snapshot. DISPLAY (`selectedCard`,
`selectedCardMembers`) reads through either kind unconditionally — a stub is exactly what
`hydrating: true` exists to gate in the UI. ACTIONS do not: `startCard` and `cleanupCard` fall back
to the pinned card via `features/board/pinned-card.ts`'s `actionablePinnedCard`, which returns it
ONLY when `kind === "hydrated"`. Before this fix both derivations fell back to a bare
`board?.cards.find(...) ?? null` with no pinned-card fallback at all, so "Clean up now" on an
awaiting-cleanup card found only via search (outside the `doneLimit` window — plausible once the
awaiting population exceeds 50, the default `DONE_PAGE_SIZE`) was a fully-enabled, silent dead
click: the button rendered from `selectedCard` (which DID include the pinned card), but
`cleanupCard` never found it, so `CleanupModal` never mounted. `requestStart`'s own validation gate
(inside the `requestStart` closure, not the `startCard` render derivation) deliberately stays pure
— `board?.cards.find(...)` only, no pinned fallback — because a To Do card is never windowed away
(only Done is `doneLimit`-capped), so the gap this fix closes cannot occur there, and re-validating
column/`groupId` from the live board rather than a moments-old hydrated snapshot is the safer
freshness guarantee for the point where a start actually gets requested.

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
NOT torn down on arrival — arrival SCHEDULES teardown for a future time (`LIFE-02`), and the
workspace, worktrees, and tmux/ttyd session stay alive and promptable until that time elapses. The
teardown itself, once dispatched, is an async saga composed from EXISTING adapters over
server-derived paths; it is scoped to `services/orchestration/cleanup.ts` (`cleanupWorkspace`) with
cross-module touchpoints in the store (`recordCleanupWarning`/`finishCleanup`), the `/cleanup`
route, and the `.tsx` cards/modal that offer it. Its home is written once here.

**Done-card teardown saga, fire-and-forget and quiet (`LIFE-01`).** Cleanup has two callers — the
`/cleanup` route (manual) and the automatic due-cleanup scheduler (`LIFE-03`) — both fire-and-forget
and both share the same never-block, report-over-SSE contract; the scheduler has no route at all.
Cleanup runs fire-and-forget off the `/cleanup` route AFTER the optimistic Done move and NEVER blocks
the board; the route returns an immediate 202. The outcome reaches the UI ONLY over SSE: a clean run calls `finishCleanup` (a quiet
state clear, no banner), a partial failure calls `recordCleanupWarning` which surfaces a MUTED,
never-destructive card warning (mirroring the Start warning; UI-SPEC lock). Every path and session is
derived from `card.*` + configured `repoPaths` — NOTHING from the request body (the route passes only
the validated card id, `T-08b-01` EoP defense). Server-side guards are defense-in-depth (the client
confirm alone is not a gate): the card MUST be in Done (a stray POST must never tear down a live
in-progress session) and NO start saga may be in flight — cleanup racing a (re)start would delete
worktrees the saga is creating, so `/start` 409s a Done card and cleanup 409s a starting one. The
two callers also share ONE store-level in-flight guard (`isCleaningUp`/`beginCleanup`/`endCleanup`,
mirroring `isStarting`) — the route 409s a card whose teardown is already dispatched, and the
scheduler skips it — so a manual click can never race the automatic sweep's `worktreeRemove`/`fs.rm`
steps for the same card. Done cards are parked with no Restart affordance; the cleanup offer owns
workspace reclamation there.

**Deferred teardown schedule (`LIFE-02`).** `moveCardManual` is the sole writer of
`card.cleanupDueAt`: it stamps a future epoch-ms due time only on a genuine Done arrival
(`from !== "done"`) of a card that still holds a session or workspace, so a redundant done→done
move (a retried `POST /cards/:id/move`) can never extend an already-set schedule. Leaving Done
clears the field, as do `finishCleanup` and `recordCleanupWarning` (both terminal outcomes of a
teardown that already ran). `cleanupDueAt` is NEVER read from a request body — it is written only
from a server clock inside a store mutator, matching `LIFE-01`'s own `T-08b-01` server-derived
posture. The due countdown rendered on a card is derived at render time from this field with no
client timer (`format-cleanup-countdown.ts` mirrors `format-age.ts`'s pure render-time-clock-read
idiom). A card with an outstanding `cleanupBlocked` refusal keeps its `cleanupDueAt` unless an
automatic run cleared it before dispatching — the two fields CAN coexist on the manual-cleanup
path, and the blocked notice always takes precedence over the countdown when both are present.

**Automatic due-cleanup runner (`LIFE-03`).** A services-tier, self-rescheduling `setTimeout` +
`unref` loop (never `setInterval`) — `services/orchestration/cleanup-scheduler.ts#startCleanupScheduler`
— starts immediately after `reconcileSessions()` at boot. Its first tick doubles as the boot sweep
for any schedule that elapsed while the process was stopped, so no separate catch-up path exists.
`cardsDueForCleanup` snapshots cards outside Done or with a start saga in flight OUT of the due list,
but dispatch is sequential and each card's own turn is separated from the snapshot by real
wall-clock time (a queue hop plus, for cards behind it, other cards' disk/subprocess-bound
teardowns) — a legal Done → In Progress drag or a column-preserving Resume can make a snapshotted
card live again before its turn arrives. The loop therefore re-validates with a FRESH store read
immediately before the destructive `cleanupWorkspace` call: a card that left Done is abandoned
silently (`moveCardManual` already cleared its schedule as part of that move), and a card that is
still Done but has a start/resume saga in flight is abandoned for this tick with its schedule
restored (`restoreCleanupDue`) so it is retried next tick rather than stranded with no schedule.
Double-run is prevented in two layers: the due date is cleared BEFORE dispatch, and a store-level
in-flight card-id set — shared with the manual `/cleanup` route (`LIFE-01`) — blocks re-entry
against a still-running teardown, whether from a previous tick or a concurrent manual dispatch.
Every automatic run is `force: false`, so the existing dirty-worktree preflight still refuses it
(CLEAN-07); a blocked automatic run is terminal — surfaced via `cleanupBlocked`, never retried or
backed off.

**Cleanup delay setting (`LIFE-04`).** The delay is whole days in `~/.dispatch/config.json` under
`cleanupDelayDays`, default 7, `0` meaning immediate cleanup on Done. Two different validation
postures apply and must not be conflated: the boot loader (`readCleanupDelayDays`) tolerantly
defaults a malformed or out-of-range hand-edited value rather than blocking boot, while the write
route (`PUT /config/cleanup-delay`) REJECTS an invalid value with 400 — a live user action gets
visible feedback, never a silent clamp. The accepted range is 0-90 days in both places. A
successful write updates the config file (`updateCleanupDelayDays`) and the in-memory store
(`BoardStore#setCleanupDelayDays`) together, config file first, so a write failure can never leave
the running store ahead of what is persisted — the new value applies without a restart. Changing
the setting never reschedules an already-stamped card: `setCleanupDelayDays` only changes the delay
`moveCardManual` reads for a FUTURE Done arrival; a card already awaiting cleanup keeps the due date
it was given.

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

**The `hookRoutedAt` latch (`WR-05`).** Under `auto`, routing is PER SESSION on the persisted
`card.hookRoutedAt` latch, stamped by `applyHookEvent` → `markHookRouted` on the session's FIRST
authenticated hook event of any type — in practice the kickoff paste's UserPromptSubmit, seconds
after launch. `mintHookChannel` persists the session's `hookToken` at launch
(`steps.ts#startClaude` / `resume-session.ts#resumeSession`) and deliberately stamps nothing else.

**The latch is EVIDENCE, never a PREDICTION — arbitration fails toward having a channel.** This is
the load-bearing half of the invariant. `runtime.capable` is only a parse of `claude --version`; it
says nothing about whether a hook POST can ever arrive. The generated hook script shells out to
`curl` and inherits the tmux session's PATH, and it ends in `|| true; exit 0` by design so a failed
hook can never block a turn — so on a host where `curl` is not on that PATH (dispatch under
launchd's minimal environment is the documented case), every hook invocation fails in total
silence. Because the watcher's `auto` gate returns early when the latch is set, and everything
below that gate — marker scan, flip-back, AND the unseen-activity dot — is that session's only
remaining status channel, latching on capability alone would leave such a card with ZERO channels:
stuck in In Progress forever, with only the 3-strike dead-session probe (which sits above the gate)
still running. Stamping on proof instead means the worst case is the opposite error — a brief
window after launch where both channels are live, which is cosmetic, since both converge on the
same `applyMarker`/`flipBack` primitives behind `lastMarker` dedup and the single-writer queue.
That ordering (a double-write is an annoyance, no channel is a dead card) is the rule any future
change to this arbitration must preserve. A launch-time latch was tried and withdrawn for exactly
this reason; the window it closed is in any case not reachable through the start saga, because
`completeStart` sets `tmuxSession` only after the whole saga — including the kickoff — has
finished, so `cardsWithSession()` cannot even see the card while the saga runs.

The latch is one-way within a session, and cleared ONLY via
the store's `clearHookToken` chokepoint — every session-death path (session lost, resume failure,
both cleanup outcomes) flows through it, so a relaunch/resume starts hook-silent and re-proves
traffic. LATCH ⇒ TOKEN still holds: `markHookRouted` only ever stamps
`hookRoutedAt` alongside a live `hookToken`, so a race with a queued session-clearing mutation can
never latch a dead session, and clearing always removes both fields together. And because a card
killed mid-saga can carry a persisted token/latch pair that no death path ever clears (it never got
a `tmuxSession`, so reconcile cannot see it), BOTH hook-silent launch branches
(`startClaude`/`resumeSession`) reset the card's hook-channel state through `store.clearHookChannel`
— the same chokepoint, as one queued mutation — before spawning, making "a hook-silent launch
starts unlatched" true by construction rather than by path enumeration. A hook-silent session
(below-floor CLI → no injection → no token → nothing can authenticate) never latches and keeps
full pane routing forever — and so, now, does a version-capable session whose hook script cannot
reach the port. The field is explicitly NON-SECRET: an ISO timestamp that rides
`snapshot()` unredacted, unlike `hookToken`. `WR-05` also covers `applyMarker`'s explicit
`eventType` parameter (see the Column Transition Specification above): the caller now supplies
the literal `status_needs_input`/`status_agent_done` directly rather than the store deriving it
from the target column, so a future third target can never silently mislabel.

**The watcher gate seam.** The demotion is one early return in `scanSession`'s I/O shell —
`paneRouted` is `pane`-mode always, `hooks`-mode never, `auto` per session on the latch — placed
AFTER the capture try/catch and BEFORE the recap-overlay guard. Everything above the gate is
unconditional on every channel: capture IS the RESIL-01 dead-session probe (3 failed captures
~6s → Session lost), and `reapDeadSessions`' orphaned-ttyd teardown runs outside the gate
entirely. The pure decision core (`scan-decision.ts`, `pane-view.ts`, `parse.ts`) and the replay
corpus are untouched — the replay harness imports only the pure core, so replay 16/16 is a
structural property of this seam.

The gate is a routing decision, NOT a concurrency guard. A tick spans several awaits and reads the
store's live card entry, so the hooks channel can mutate the card between the decision and its
dispatch — and a hook `flipBack` out of `agent_done`/`in_review` clears `lastMarker`, removing the
level-triggered scan's only defence against a marker still sitting on the pane. `scanSession`
therefore re-compares the card's `column` and `lastMarker` against the values the decision was
computed from, immediately before applying it, and skips the tick when either moved; the
per-session pane baselines are still written back because they describe the pane, not the card.
That check is independent of the gate and must stay so: under `auto` a session is pane-routed until
its first hook event, so both channels really can be live at once.

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
   validated `tool_name` is in the same pause-tool set; `flipBack`'s own column guard — since
   `BOARD-06` widened it, membership in `FLIP_BACK_SOURCES` (`needs_input`, `agent_done`,
   `in_review`) rather than the original `needs_input`-only test — makes this safe to call
   unconditionally on every such event. Note what widening changed: a pause-tool `PostToolUse` now
   also flips a card OUT of `agent_done`/`in_review`, and on those two edges (and only those)
   `flipBack` additionally clears `lastMarker`, so a card parked on a completion can be pulled back
   into In Progress by a tool result and can later re-enter Agent Done on a repeat of the identical
   DONE text. Both new branches sit AFTER the pane-mode no-op guard described above, so they inherit
   the "no pane fallback under explicit `hooks` mode" contract automatically and can never fire
   under `statusChannel: "pane"` — a pane-mode session never even carries `--settings`, so the CLI
   never emits the `PreToolUse`/`PostToolUse` events in the first place. Live-verified 3/3: the
   pause flips the card to Needs Input, answering flips it back, a plain `pane`-mode session stays
   structurally unable to detect the pause (unregressed, pre-existing, out of this fix's scope),
   and a manual drag still wins over any marker.

**Accepted residuals.** Under `auto`, the window between a card becoming watcher-visible and its
first authenticated hook event has BOTH channels live and can double-stamp the same activity (two
SSE frames, same semantic — cosmetic, self-heals on view). This is the deliberate direction of the
`WR-05` trade above and must not be "fixed" by predicting the latch. On the start path the window
is empty anyway (`completeStart` publishes `tmuxSession` only after the kickoff); on the resume
path it lasts until the user's first prompt, because a resume sends no kickoff. The latch is also
one-way within a session, so a hook transport that delivers once and then breaks keeps the pane
channel demoted for the rest of that session — bounded by the fact that the transport is fixed at
launch, and the 3-strike dead-session probe still runs above the gate either way. Under `hooks`, a
hook-silent session gets NO status routing at all — the user's explicit mode choice; dead-session
detection still covers it. A pathological >1mb PostToolUse payload is rejected by the body limit
and drops one cosmetic stamp, self-healing on the next event.

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

**`null` vs `[]` is the entire staleness contract, now with a bounded ceiling (`RESIL-02`).** `null`
means detection failed this tick — the caller leaves every card's previous `previews` value
untouched, exactly the tolerant-swallow discipline `listSessions`/`pidsListeningOnPorts` already
established. An empty array means detection succeeded and genuinely found nothing — the caller
clears the field. Collapsing these two into one signal would either wipe a live card's badges on a
transient tool hiccup, or wedge a dead port's badge on the board forever. A single `null` tick still
leaves `previews` alone and immediately raises `previewsUnknown`; only after three CONSECUTIVE
`null` ticks does `previews` itself get forced to `[]`, so a probe that is genuinely, persistently
failing cannot leave a dead port advertised indefinitely — see [Resilience and
Reconcile](#resilience-and-reconcile) for the counter mechanics shared with `RESIL-01`.

**A discovered port is advertised only after a short bare-TCP-connect confirmation (F-07).**
`confirmReachable` (`adapters/artifact-detect.ts`, mirroring `ttyd.ts`'s `probeAdoption`) opens a
bare `net.connect` with a 500ms timeout and accepts on TCP handshake completion alone — never an
HTTP request or status code, since an HTTP-status probe would wrongly reject a real dev server whose
`/` returns 404 (common for an API-only or SPA dev server) and would fail a TLS-only dev server
outright.

**What that confirmation does and does not claim.** It confirms only that SOMETHING still accepts a
connection at probe time; it deliberately does not assert that the application answers. This is a
measured limit, not a hypothesis: the three bogus-preview shapes reproduced under F-07 —
destroy-on-connect, TCP-accept-but-never-respond, and a real HTTP server 404ing at `/` — all
complete the handshake and are therefore all still advertised. What the probe does remove is a port
that stopped listening in the window since the `lsof` scan. The TCP-only ceiling is the deliberate
trade: variant C (404 at `/`) is a perfectly healthy dev server, so any probe strict enough to reject
variants A and B would also reject it. Do not build on this line as if LISTEN-versus-answers were
now settled — closing the remaining gap needs a different mechanism than a connect probe.

**The probe dials the address family `lsof` reported, never a hardcoded `127.0.0.1`.** Discovery
accepts an IPv6-loopback bind, and a `::1`-only listener refuses an IPv4 connect outright — so an
IPv4-only probe rejected a live dev server and, because a rejected candidate takes the SUCCESSFUL
zero-preview path, published a confident "nothing is listening" for a server the user could open in
the same browser. `listeningPortsBySession` therefore returns a `DiscoveredPort` carrying the
loopback host(s) its bind address maps to (`dev-server.ts`'s `PROBE_HOSTS_FOR_BIND`), and
`confirmReachable` dials exactly those. This matters on macOS specifically: since Node 17's
`verbatim: true` DNS default, `listen(port, "localhost")` — the most common host argument a dev
server is given — binds `::1` first. Mapping per bind rather than probing both families
unconditionally also keeps the confirmation narrow: a card's port can never be confirmed by a socket
some unrelated process holds on the other family.

**The exclusion set now covers every Dispatch-owned port, not just the card's own `ttydPort`
(F-09).** Built ONCE per tick — the backend's own resolved listen port plus every live card's
`ttydPort` — rather than checking only the current card's own field, so a stale, freed ttyd port
picked up moments later by an unrelated card's real dev server can no longer leak into that
DIFFERENT card's previews. See [Known Residuals](#known-residuals) for the one gap this exclusion
set does not cover (the Vite dev port).

**`previews` rides both wire and disk exactly like `prs`.** No `buildMeta`-style per-card disk
filter exists (`board-db.ts` `JSON.stringify(card)`s the whole card unfiltered), so there is
nothing to build: a stale disk value after a crash mid-session either gets overwritten by the
next tick (session still alive) or cleared by whichever teardown mutator runs (session died) —
self-healing, with no special-casing in `hydrateFromParsed`.

**Detection owns its own timer, decoupled from Linear.** `adapters/artifact-detect.ts` runs a
dedicated self-rescheduling `setTimeout` loop on a ~10s cadence (`startArtifactDetectionLoop`,
started unconditionally at boot from `bootstrap/index.ts` regardless of whether a Linear API key
is configured), mirroring `startMarkerWatcher`'s tick/scheduleNext/unref/immediate-first-run shape
— never `setInterval`, and `timer.unref()` so it never pins the process. This reverses the prior
"passenger on the 60s poller tick" model, which piggybacked detection on `pollOnce()`'s success
path: that coupling made both probes structurally unreachable on any install with no Linear key
configured (F-01) and skipped an entire detection tick on any Linear fetch failure — rate limit,
network blip, bad credentials (F-02) — collapsing "could not check" into "looks like nothing is
there" for reasons that have nothing to do with `gh`/`lsof`/pane health.

**The PR fan-out backs off on total failure; the loop's cadence does not.** A card with two repos
issues one authenticated `gh pr list` per repo every 10s, so a dropped connection or GitHub secondary
rate limiting used to retry at full rate while every retry drove the `RESIL-02` counter toward wiping
the card's PR state — and the raised call rate made throttling likelier to begin with. A tick where
NO repo answered now arms a per-card retry deadline that doubles from the 10s cadence up to 60s,
cleared the moment any repo answers. It is deliberately not `poller.ts`'s whole-loop backoff: the
same tick runs the local `tmux`/`ps`/`lsof` preview scan whose measured port-change latency (F-08)
depends on the 10s cadence, so slowing everything because GitHub is unreachable would reopen a closed
finding. Partial failure never backs off, so a workspace holding one permanently unresolvable repo
keeps polling its healthy siblings at full cadence. While a card is backed off its PR block is
skipped entirely and `prsUnknown` is left standing — nothing was re-checked, so nothing may claim to
have been.

**The fan-out is scoped to PROBED cards, not every `cardsWithSession()` card — Done is excluded
(milestone-integration-audit, closes a cross-phase blocker between `LIFE-02`'s deferred-cleanup
retention and this loop).** `cardsWithSession()` alone stopped being naturally bounded by "how many
agents are actively working" the moment Phase 81 started keeping a Done card's tmux session alive
for days awaiting cleanup — measured at 60 concurrent `gh pr list` spawns in a single ~10s tick for
60 awaiting-cleanup cards, unbounded and indefinite as the retained-Done population grows. The
module-local `probedCards()` helper filters `cardsWithSession()` down to every column except Done
before either the PR fan-out or the preview scan runs. This is SIGNAL semantics, not a scale
shim: Done is a parked column with no Restart affordance, the card's work is finished there, and
nothing about a finished card's PR state or dev-server preview can change from further probing — a
PR merging after Done gates no further work for a card none is happening on. A Done card's
`prs`/`previews` therefore FREEZE at whatever the last probe resolved before the card left an
active column, rather than staying live for the length of the deferred-cleanup window; that is the
deliberate tradeoff, not an oversight. Every other live column (`in_progress` / `needs_input` /
`agent_done`; `todo` never carries a `tmuxSession` so was never in the input set) keeps probing
exactly as before — `RESIL-02`'s failure-ceiling and backoff, and the `null`-vs-`[]`
unknown-vs-confirmed-negative distinction above, are unchanged for those columns. The three
per-card bookkeeping maps (`prFailureCounts`, `prRetryNotBefore`, `previewFailureCounts`) are
pruned against this same `probedCards()` set at the end of each tick, so a card that moves to Done
mid-tick has its streak evicted on the very next tick rather than lingering forever. Concurrency
within `probedCards()` itself remains an unbounded `Promise.all` — acceptable at the scale of
"cards with an actively live session" (a handful at a time in normal use), unlike the
now-closed retained-Done-population case; a hard concurrency cap was deliberately left as a
follow-up rather than bundled into this fix, since nothing in the audit measured it as a live
problem once Done stopped inflating the set.

**The single-flight guard is retained for future callers, and enforces nothing today.** The loop arms
its next timer only in the awaited tick's `finally`, so a slow tick delays the following one instead
of overlapping it — the timer path cannot re-enter `detectCardArtifacts`, and it is the only caller.
The guard survives because a non-timer trigger is the obvious next step (a "refresh signals now"
route, the shape `pollNow()` already has for the Linear poller) and because the earlier
`pollOnce()`-driven design genuinely did re-enter. Anyone adding that second trigger must know what
the guard returns: the promise of the tick ALREADY in flight, not a fresh scan. A caller wanting
guaranteed-fresh results has to wait for the in-flight tick to settle and then run another.

### Design System Invariants

**Keyboard focus is an outline, never a box-shadow (`NEW-15`).** The rule, authored in `docs/standards/frontend-design-system.md`: "a keyboard focus ring must never look identical to selection."
`focusRing()` in `src/web/primitives/focus-ring.ts` is the single definition every call site
consumes. Where an `overflow: hidden` ancestor clips the ring's offset, the locked resolution is
to drop the offset to 0 at that call site — never to fall back to a box-shadow expression, which
is structurally identical to the selection ring and is exactly the defect this invariant exists
to prevent.

**One shadow token for the whole app (`NEW-16`).** `--shadow-float`, defined once in
`src/web/styles/tokens.css`, is the system's only shadow. The invariant is the single definition,
not a consumer cap: `RETIRED_PATTERNS`'s literal scan over `src/**/*.{ts,tsx}` catches the retired
`0 6px 16px rgba(0,0,0,0.45)` value reappearing anywhere outside `tokens.css`, which is what makes
"one definition" mechanical. Measured today it is consumed at seven call sites — the card drag
overlay (`CardView.tsx:171`), the selection bar (`SelectionBar.tsx:29`), the search results
listbox (`SearchBox.tsx:321`), the carousel search overlay (`SearchBox.tsx:400`), the move-to
picker (`MoveToPicker.tsx:97`), the multi-select dropdown (`MultiSelect.tsx:248`), and the modal
(`Modal.tsx:110`). Cards and columns carry no shadow at rest; a second, independently-defined
shadow value is the regression the gate catches, not an additional consumer of the one token.

**One wordmark definition (`NEW-17`).** `wordmarkStyle` in `src/web/primitives/Glyph.tsx` is the
only place the DISPATCH wordmark's type treatment (size, weight, letter-spacing) is written down.
Every site that renders the wordmark imports it rather than repeating the values inline.
`src/web/**/*.tsx` carries zero comments by this repo's comment standard (`docs/standards/comments.md`
rule 2's tsx carve-out), so this section — not a JSDoc pointer on `wordmarkStyle` itself — is the
durable home the invariant-audit gate reads for `NEW-17`.

**The contract's looser reading rhythm never enters a board surface (`NEW-19`).** The contract's
`.reading-surface` class lifts `--line-body` from its global 1.5 to a roomier 1.6
(`src/web/styles/tokens.css`); Phase 86's criterion 2 forbids that looser rhythm from
`src/web/features/board/` by name, so it can cost card density. The two carriers of the
forbidden rhythm are the `.reading-surface` class name and a local `--line-body` redefinition —
a custom-property declaration, never a `var(--line-body)` _read_. `var(--line-body)` consumption
at the global 1.5 is expressly permitted: the contract itself specifies `--line-body` as the card
title's own line height, so barring consumption would force a card-height change, which criterion
2 forbids outright. The check is directory-scoped to `src/web/features/board/` rather than global
because `.reading-surface` is legitimately used elsewhere (`Modal.tsx`, `DetailPanel.tsx`).
`src/web/**/*.tsx` carries zero comments by this repo's comment standard, so this section — not a
JSDoc pointer on any board component — is the durable home the invariant-audit gate reads for
`NEW-19`.

**The embedded terminal client is fenced out of Phase 87's diff (`NEW-20`).** The two paths
`src/web/terminal-main.ts` and `src/web/terminal.html` are the entire embedded terminal client —
there is no terminal-client directory on disk, so the fence names these two paths directly rather
than a glob. `src/web/features/detail/TerminalRegion.tsx`, which renders the panel's `<iframe>`
around that client, is a DIFFERENT file and is NOT fenced: the panel container may change this
phase, the terminal client itself may not. **Enforcement is SPLIT into two halves, and neither
half alone is the whole guarantee.** The mechanical half — `checkTerminalFence` in
`scripts/check-invariants.mjs`, run by `node scripts/check-invariants.mjs` — proves only that the
fence's SUBJECT SET is intact (neither fenced path was renamed or deleted, and no new
`terminal*`-named sibling file appeared beside them in `src/web/`) and that `NEW-20` has a home.
It structurally CANNOT prove the fenced files' CONTENTS are unchanged, because
`check-invariants.mjs`'s entire mechanism is point-in-time pattern matching against the current
tree, with zero `git diff`/`execSync` calls anywhere in the script. The second half — proving the
CONTENTS are unchanged — is the on-demand command `git diff <base-sha>..HEAD --
src/web/terminal-main.ts src/web/terminal.html`, run against the phase's recorded base SHA; empty
output is the proof. A reader who sees `PASS: 121/121` alone has not yet seen this second half
run.

`scripts/check-invariants.mjs` mechanically covers all six through four separate checks: a
global retired-pattern scan over `src/**/*.{ts,tsx}` catches the retired box-shadow focus
expression, the retired float-shadow literal, and a hardcoded wordmark weight reappearing
anywhere in source; a second, file-scoped check (`checkStripPadding`, `NEW-18`, see
[App Shell Zones](#app-shell-zones)) covers a fourth retired literal that the global scan cannot
safely reach, and additionally asserts the padding cascade's own mechanism so the check cannot pass
against an implementation that quietly dropped it; a third, directory-scoped check (`checkBoardReadingRhythm`, `NEW-19`, above) covers
the fifth; and a fourth, file-scoped check (`checkTerminalFence`, `NEW-20`, above) covers the
sixth — proving only the fenced subject set, never the fenced contents, as stated above.

### App Shell Zones

**The zone grid.** `SyncStrip.tsx` renders its three top-level children through a CSS grid whose
`gridTemplateColumns` reads `var(--strip-grid-columns)`: column 1 is the identity zone (`Glyph` plus
the DISPATCH wordmark, the glyph alone below 768px — see "Narrow-width behaviour" below), column 2
is the mode control and NOTHING else, and column 3 is the primary cluster (New Ticket, then Inbox
while `viewMode === "board"`) followed by a hairline divider and the utility cluster (sync status,
Activity, Settings). Column 2's exclusivity is load-bearing: because `justifySelf: "center"` places
it against its own track rather than against its neighbors' combined width, its horizontal position
stays invariant when anything in column 1 or column 3 mounts or unmounts — specifically, it stops
the Inbox button's `viewMode === "board"` guard from shifting the view switch sideways when Orca
view unmounts Inbox. A flex row with `justifyContent: "space-between"` cannot make this guarantee,
because removing a sibling from either side changes that side's total width and the center-weighted
middle drifts with it.

**The template is width-dependent, and the two properties it trades are not the same property.**
`--strip-grid-columns` cascades in `src/web/styles/tokens.css`, in the same
`@media (max-width: 767px)` block as `--strip-padding` and `--strip-height`:

| Width   | Template                             | Column 2                                     |
| ------- | ------------------------------------ | -------------------------------------------- |
| >=768px | `minmax(0, 1fr) auto minmax(0, 1fr)` | positionally invariant AND viewport-centred  |
| <768px  | `auto auto minmax(0, 1fr)`           | positionally invariant, NOT viewport-centred |

Both outer tracks are written with an explicit `minmax(0, …)` lower bound rather than the shorthand
`1fr`, because `1fr` is `minmax(auto, 1fr)`, whose automatic minimum is the track's own min-content
size — a bare `1fr` track can never shrink below its content, and the strip overflows the viewport
instead.

At >=768px the two outer tracks are symmetric, so column 2 lands on the viewport's centerline.
Below 768px they deliberately are not, and the reason is measured: symmetric tracks mirror whatever
slack column 1 does not use into column 1 anyway, and since the narrow identity zone is a glyph-only
16px, that mirrored slack starved the sync-status region to 7px of box and **zero painted
characters** at 390px. An `auto` first track hands that slack to column 3 instead, which is where
the only elastic element lives. **Positional invariance survives the change** — the property the
paragraph above calls load-bearing is immunity to a column-3 mount/unmount, and below 768px column 1
is a fixed 16px that cannot vary with column 3 at all, so toggling Orca view leaves column 2's rect
identical. What is given up below 768px is viewport _centring_, a different and weaker property,
and it is given up only there.

**The sync-status truncation chain.** The status string is the strip's only elastic element — every
other item in the strip has a fixed width — and it is the one piece that can be arbitrarily long,
since the server-supplied sync warning has no length bound. It is therefore the element that yields
under pressure, and it does so by truncating to one ellipsized line rather than wrapping. That
requires the WHOLE min-width chain to be able to shrink below min-content, not just the text node:
the grid track column 3 resolves to (`minmax(0, …)` at every width, above), then `rightZoneStyle` and
`utilityClusterStyle`, both flex containers whose default `min-width: auto` floors at min-content
the same way, then the `role="status"` container itself, which carries `minWidth: 0` together with
`whiteSpace: "nowrap"`, `overflow: "hidden"` and `textOverflow: "ellipsis"`. Any one link left out
silently restores the min-content floor and the ellipsis never engages, which is why the chain is
recorded here as a unit rather than as four independent style properties. The status dot keeps
`flex: "0 0 auto"` so it is never the thing that truncates. The truncation is CSS-only and the
region's `textContent` is always the complete string: `aria-live="polite"` announces the full text
regardless of what is painted, so no `title` attribute and no shortened substitute string may be
added here.

**The weight tiers.** Within column 3, the primary cluster (New Ticket, Inbox) sits nearest the
grid's center and the utility cluster (sync status, Activity, Settings) sits nearest the edge,
separated by a 1px `--border` hairline (`dividerStyle`). Utility demotion is positional and
color-based only — Activity and Settings stay at `IconButton`'s 16px glyph on `--text-muted` with
no `style` override — never a size reduction: `IconButton.tsx`'s 28px box is the touch-target
floor and this phase does not shrink it.

**Why New Ticket is a local composition.** New Ticket left the `IconButton` primitive entirely and
renders as a native `<button>` with its own `newTicketBaseStyle` / `newTicketLabelledStyle` /
`newTicketIconOnlyStyle` constants and its own hover/focus state pair. Both `IconButton.tsx` and
`Button.tsx` compute their resting `background` before spreading the caller's `style` prop, so
neither primitive can express a resting fill (`--surface-card`) that also lifts on hover
(`--surface-card-hover`) — a caller-supplied `style.background` would permanently pin one or the
other. A contained control needs both at once, so it is composed locally rather than forcing a
primitive change for a single consumer. Extraction to `src/web/primitives/` waits for a second
consumer.

**Narrow-width behaviour.** Exactly one thing is removed below 768px: the `DISPATCH` wordmark span,
leaving the identity zone as the `Glyph` alone. The app name is not lost — below 768px the glyph is
passed `title="Dispatch"`, which flips its `role` from `"presentation"` to `"img"`, drops its
`aria-hidden`, and gives it an `aria-label`, so the name stays in the accessibility tree exactly as
the wordmark's text node did. The wordmark is 136.5px wide, over a third of a 390px viewport, and
the strip's remaining fixed elements do not fit beside it at that width even with the status text
erased entirely, which is why this is a removal rather than a size reduction. `wordmarkStyle` itself
is untouched and its other two consumers (`App.tsx`, `FirstRunSetup.tsx`) render unchanged, so the
one-wordmark-definition rule is unaffected.

Nothing else is removed. `useMediaQuery` in `SyncStrip.tsx` otherwise only compresses `clusterGap`
(16px → 8px, the gap between the primary and utility clusters) and `itemGap` (8px → 4px, the gap
within each cluster) — no control, no badge, and above all not the `role="status" aria-live="polite"`
sync region is conditionally rendered away at any width. That region yields by truncating, never by
unmounting.

**The written non-goal: no persistent left sidebar.** A single-board product gains no navigation
value from a persistent left sidebar and pays for it in real board width with nothing to show for
it, so this app shell does not have one. Its enforceable form: `AppShell.tsx` mounts exactly one
chrome container (`chromeRef`, holding `header`) above `content` and `detail` — there is no second
top-level chrome slot for a sidebar to occupy without a structural change to `AppShell.tsx` itself.
This is recorded here, as a written decision with a durable artifact, specifically so it cannot
silently reopen in a later phase the way an unrecorded non-action would.

**`NEW-18`.** The strip carries two responsive token cascades, both defined in
`src/web/styles/tokens.css` and both stepped inside the same `@media (max-width: 767px)` block that
already steps `--strip-height`: `--strip-padding` (24px, stepped to 16px) and
`--strip-grid-columns` (symmetric, stepped to the narrow asymmetric template above). Each is
written once in `stripContainerStyle` in `SyncStrip.tsx` as a bare `var(…)` reference. Both cascades
are CSS rather than a `useMediaQuery` branch, deliberately: a custom property re-resolves on a
breakpoint cross with zero React re-render, whereas an inline `narrow ? … : …` would re-render the
whole strip while passing every geometry check. The "written once" guarantee is unchanged — the
component names the token, never a value. `scripts/check-invariants.mjs` fails the build unless the
component consumes both tokens, `tokens.css` defines both cascade steps for each, and the retired
`padding: "0 var(--space-lg)"` (16px) literal has not returned to that file. This check is
deliberately file-scoped (`checkStripCascades`) rather than a `RETIRED_PATTERNS` entry, because the
retired literal is a legitimate value in eight other files (`SearchBox.tsx`, `UpdateBanner.tsx`,
`MoveToPicker.tsx`, `FirstRunSetup.tsx`, `CleanupModal.tsx`, `ActivityDrawer.tsx`, `Button.tsx`,
`OrcaGroupSection.tsx`) and a global substring scan would false-positive on all of them. Mirroring
`NEW-17`'s own resolution: `src/web/**/*.tsx` carries zero comments under this repo's comment
standard (`docs/standards/comments.md` rule 2's tsx carve-out), so this section — not a JSDoc
pointer on any `.tsx` file — is the durable home the invariant-audit gate reads for `NEW-18`.

**The chosen view-switch rendering.** `modeControlStyle` in `SyncStrip.tsx` is a 28px-tall,
2px-padded `role="group" aria-label="View"` container with a `--surface-card` fill, a 1px
`--border` hairline, and `--radius` (6px) corners — the concentric outer curve to each segment's
`--radius-sm` (4px) inner curve, since 6 minus the 2px inset equals 4. Each segment
(`viewSegmentStyle`) is 24px tall by 28px wide, clearing WCAG 2.2 SC 2.5.8 Target Size
(Minimum)'s 24×24 CSS-px floor — a deliberate, measured exception to the utility cluster's 28px
touch-target floor described above, scoped to this control only. The active segment's whole box
originally took `var(--accent)` as an opaque background (Candidate C, chosen over two other
rendered candidates — an icon-color-only baseline and a labelled variant — because it was the
only one that stayed identifiable "in well under a second" at every one of the four measured
breakpoints; the icon-color-only baseline required close inspection to tell the segments apart,
and the labelled candidate's advantage disappeared below 1024px, where it renders pixel-identical
to the icon-color-only baseline). A later Phase 85 UI review found that opaque fill outweighed
New Ticket, the control this same phase set out to elevate as "the single most-used control in
the strip" — the mode control, which is used less often, was reading as the strip's most
prominent element. The active segment now takes `activeSegmentTint`
(`color-mix(in srgb, var(--accent) 16%, var(--surface-column))`, the same tint the inbox count
badge already uses) as its background with `var(--accent)` icon color; the inactive segment stays
transparent with `var(--text-muted)`. The Inbox toggle's open state was aligned to the same
`activeSegmentTint` + accent-icon grammar in the same pass, so the primary cluster now expresses
"active" one way, not two. `role="group"` with `aria-label="View"` was kept instead of
`radiogroup`/`radio`, since that conversion would change keyboard semantics. See
`docs/standards/design-contract.md`'s `## Deferred decisions` row 2 for the full rendered-evidence
comparison and the later retuning.

## Do Not Change Contracts

These are seams that refactors must hold **byte/shape-identical**. A change to any of them
is a behavior change, not a refactor.

1. **`shared/types.ts` shape.** `Card`, `BoardSnapshot`, `Config`, `StartError`, `TerminalError`,
   `SessionFields`, `ReconcileResult`, `Column`/`COLUMNS`. Consumed by both halves; **`BoardSnapshot`
   IS the SSE payload AND the on-disk `board.json`** — same FIELD SET both places (Plan 82-02
   deliberately broke the byte-identical shape this contract used to state: wire copies are now
   redacted AND Done-windowed at `store.snapshot(opts)`, `card.hookToken` stripped and the Done
   `cards` slice bounded by `doneLimit`; only the persisted file is complete). This break is
   deliberate and UNVERSIONED — single user, localhost, client and server ship in one package, so
   there are no external consumers to keep compatible; a future reader must not "fix" a missing
   version field. Keep the file location and every field name.
2. **SSE frame format.** `data: ${JSON.stringify(BoardSnapshot)}\n\n`; named heartbeat
   `event: ping\ndata: 1\n\n`; headers incl. `X-Accel-Buffering: no`; **server `KEEPALIVE_MS` (15s)
   must stay in lockstep with client `HEARTBEAT_MS`** (watchdog trips at 3×). No compression on
   `/stream`. Since `BOARD-08`, the serialized snapshot is per-connection-windowed — one broadcast
   may therefore produce MORE THAN ONE distinct frame (one per distinct `doneLimit` among connected
   clients), never a single shared frame for every client.
3. **REST route paths + status codes.** `GET /api/board`, `GET /api/stream` (SSE) — both take the
   identical `?doneLimit=` query parameter (`BOARD-08`): REST rejects an invalid value with `400`,
   SSE falls back to `DONE_PAGE_SIZE` instead of rejecting the connection (an `EventSource` retries
   a failed connect forever, so a 400 there would be an infinite reconnect loop) —
   `GET /api/events` (REST event log — `{ events: ActivityEvent[] }`, newest-first, default limit 200,
   `?cardId=` scoped),
   `POST /api/cards/:id/{move,start,resume,terminal,open-editor,cleanup,sync-linear}`; the
   `202/400/409/204` codes and the `{ error, variant? }` 400 body. `sync-linear` deliberately deviates
   with a `404` (not `400`) for an unknown card id — see the Sync-out contract above. Vite proxy
   matches `^/api/` only (regex, deliberately not `/api`). `GET /api/search?q=` (SCALE-03) returns
   `{ results: CardSearchResult[], total }`, `400` on a missing or out-of-bounds `q` (`T-82-02`).
   `GET /api/cards/:id` returns `200` with `{ card, members }` — a redacted card plus its redacted
   group members, `members` always an array (`[]` for a non-group card) — and, like every other
   handler in `cards.route.ts` — **`400`, not `404`**, for an unknown id (`T-82-03`); `sync-linear`'s
   `404` stays the sole documented deviation. See `## GET /api/cards/:id answers a group parent's
real membership directly, independent of windowing` below for the full envelope contract.
4. **Persistence format + location.** `~/.dispatch/{board.json,config.json}`; `board.json` ===
   `BoardSnapshot` JSON; atomic writes via `write-file-atomic`; config at mode `0600`; the `"//"`-keyed
   config template.
5. **tmux invocations (argv-exact).** Session name `dsp-<identifier>`;
   `new-session -d -s <name> -c <cwd> -x 200 -y 50 <argv>`; `capture-pane -p -J -t =<name>:`; exact-name
   `=` targeting; `load-buffer -b`/`paste-buffer -b -p -d`; separate `send-keys Enter`. Geometry `200×50`
   is load-bearing for readiness/marker parsing.
6. **ttyd invocation + tracking.** `ttyd -W -i 127.0.0.1 -p 0 -b /sessions/<cardId>/terminal -t
disableLeaveAlert=true -t DISPATCH_TTYD_REVISION_<revision>=1 tmux -u attach -t =<session>` (`-u` is
   mandatory — see `TERM-04`); port
   parsed from stderr `Listening on port: N`; loopback bind mandatory; orphan-sweep ownership proof
   (`basename(argv0)==="ttyd"` AND argv includes `tmux`+`attach`, OR the process title contains the
   exact retained-key revision literal, OR it carries `-b /sessions/<cardId>/terminal` — the arm
   that survives ttyd's proctitle rewrite, `TERM-05`); exact-current retained-key revision marker required for
   adoption/spare (the sole re-adoption fingerprint); iframe src `/sessions/${card.id}/terminal/`
   (same-origin, forwarded by the reverse-proxy — `@see` [Terminal (ttyd)](#terminal-ttyd)).
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

| T-ID    | STRIDE                                  | Component / site                                                                                                                                       | Mitigation (concrete control)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-01-03 | Information Disclosure                  | `adapters/poller.ts`                                                                                                                                   | `config.linearApiKey` is sent only as the raw `Authorization` header value (T-01-03a) — it is never logged, never echoed into any error body, and never reaches the routes layer.                                                                                                                                                                                                                                                                                                                                                                                                   |
| T-01-04 | Tampering (XSS) / DoS                   | `web/features/board/Card.tsx`, `web/hooks/useBoardStream.ts`                                                                                           | Linear title/identifier are rendered as plain React children (React auto-escapes) — never injected as raw inner HTML (XSS mitigation T-01-04a); and the SSE hook disposes EVERYTHING (EventSource, pending reconnect, watchdog) on unmount so a StrictMode double-mount never leaves two live connections or an orphan timer (DoS mitigation T-01-04c).                                                                                                                                                                                                                             |
| T-01-05 | Tampering (XSS) / Elevation             | `web/features/detail/DetailPanel.tsx`                                                                                                                  | The Linear-sourced description renders as plain React children (auto-escaped), never as raw inner HTML (T-01-05a); the panel is a PLAIN element with NO focus trap so keystrokes pass through to the live `claude` session — EoP accepted on a single-user loopback-only host with no adversarial keystroke concern (T-01-05c).                                                                                                                                                                                                                                                     |
| T-02-04 | Tampering                               | `adapters/claude-trust.ts`                                                                                                                             | `~/.claude.json` is concurrently rewritten by every live Claude session; all `preSeedTrust` calls serialize through a single in-process async lock, keep the re-read→merge-one-entry→write span tight (no awaits between), and parse in try/catch — never writing a file that could not be parsed.                                                                                                                                                                                                                                                                                  |
| T-02-05 | Tampering                               | `adapters/claude-trust.ts`                                                                                                                             | Same lost-update defense as T-02-04: `write-file-atomic` prevents torn files but not a stale snapshot clobbering a concurrent writer's live auth state, so the in-process lock + tight RMW span + parse-guard is the mitigation an in-process actor can offer.                                                                                                                                                                                                                                                                                                                      |
| T-02-12 | Tampering (XSS)                         | `web/features/modals/StartModal.tsx`                                                                                                                   | The Linear-sourced identifier renders as a plain React child (auto-escaped) — never injected as raw inner HTML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| T-02-15 | Spoofing / Elevation                    | `routes/cards.route.ts` (`/start`)                                                                                                                     | The start route lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — it is NOT mounted anywhere else, so there is no ungated path to the saga.                                                                                                                                                                                                                                                                                                                                                                                                          |
| T-02-16 | Tampering / Elevation                   | `routes/cards.route.ts` (`/start`)                                                                                                                     | Defense-in-depth identifier gate: the Linear-sourced identifier is re-validated against `^[A-Za-z0-9]+-\d+$` at the route before it enters filesystem paths, branch names, and tmux session names in the saga (the saga re-checks too).                                                                                                                                                                                                                                                                                                                                             |
| T-02-17 | Information Disclosure                  | `bootstrap/config.ts`, `services/infra/config-holder.ts`                                                                                               | Config validation happens at boot: `loadConfig` throws `StartupError` naming the offending field or config-file path and NEVER echoes the Linear API key; routes read config only through the holder and return a value-free 400 when it is unset, so configured values never reach a response body.                                                                                                                                                                                                                                                                                |
| T-03-01 | Spoofing / Elevation                    | `adapters/ttyd.ts`                                                                                                                                     | `-W` (writable) AND `-i 127.0.0.1` (loopback-only bind) are BOTH mandatory — a missing `-W` is a dead terminal, and an all-interfaces bind would expose an unauthenticated writable shell to the LAN. Never bind a routable interface.                                                                                                                                                                                                                                                                                                                                              |
| T-03-02 | Tampering / Elevation                   | `adapters/ttyd.ts`, `routes/cards.route.ts` (`/terminal`)                                                                                              | argv-array spawn only (never a shell string): only fixed strings + the caller-validated `session` (`dsp-` + a route-checked identifier) enter argv; the terminal route additionally re-validates the identifier before it enters the ttyd attach argv.                                                                                                                                                                                                                                                                                                                              |
| T-03-03 | Spoofing                                | `routes/cards.route.ts` (`/terminal`)                                                                                                                  | `/terminal` lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — no new mount, no second gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| T-03-07 | Denial of Service                       | `adapters/ttyd.ts`                                                                                                                                     | Single-flight spawn: `ensureTtyd` records the in-flight promise SYNCHRONOUSLY (before its first await) so a StrictMode double-effect or two near-simultaneous POSTs share ONE spawn — otherwise the loser leaks an orphan ttyd that later fires a FALSE `died` signal; the exit handler reconciles only the tracked child.                                                                                                                                                                                                                                                          |
| T-04-01 | Tampering / Elevation                   | `adapters/markers/watcher.ts`, `adapters/exec.ts`, `adapters/gh.ts`                                                                                    | Session names entering `capture-pane -t =<name>` are `dsp-` + a route-validated identifier and travel argv-only via `run()`; captured pane text is inert stdout, never a command. The `gh pr list` PR probe travels argv-only through the same `run()` chokepoint, with only the server-derived `card.branch` and the registered `card.workspace.repos[].path` entering argv — never a client-supplied value.                                                                                                                                                                       |
| T-04-02 | Tampering                               | `adapters/markers/parse.ts`                                                                                                                            | The marker reason/summary is captured as an OPAQUE string (trim only) — never eval'd, parsed as code, or template-executed; untrusted agent text stays inert.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T-04-04 | Information Disclosure                  | `adapters/markers/watcher.ts`, `adapters/ttyd.ts`, `adapters/gh.ts`                                                                                    | Content-free logging: logs only counts / error messages — NEVER pane text, card fields, the reason/summary, PIDs, argv, or session contents. The one-time `gh` failure log names a fixed CATEGORY only ("gh unavailable" / "gh not authenticated" / "gh pr list failed") — never raw `gh` stderr, the repo path, or the branch name.                                                                                                                                                                                                                                                |
| T-06-01 | Tampering                               | `adapters/editors.ts`                                                                                                                                  | `launchEditor` hands the server-owned `workspacePath` to the argv-array chokepoint (`exec.run`) as a SINGLE argv element — never interpolated, never a shell string, never a client path.                                                                                                                                                                                                                                                                                                                                                                                           |
| T-06-02 | Elevation                               | `routes/cards.route.ts` (`/open-editor`)                                                                                                               | The launch path comes ONLY from `card.workspacePath` (created by the saga); the client sends only the `editor` discriminant (`code`/`cursor`), never a filesystem path.                                                                                                                                                                                                                                                                                                                                                                                                             |
| T-06-03 | Information Disclosure                  | `adapters/editors.ts`, `routes/cards.route.ts` (`/open-editor`)                                                                                        | Absolute editor paths never leave the `editors` module (only availability booleans + the spawn side-effect escape); no 400 body ever echoes a path — messages name the editor id / "workspace".                                                                                                                                                                                                                                                                                                                                                                                     |
| T-06-04 | Denial of Service                       | `adapters/editors.ts`, `routes/cards.route.ts` (`/open-editor`)                                                                                        | A final launch failure (after one re-resolve-and-retry) is logged server-side, never thrown into the request or the process — it reaches the caller's fire-and-forget `.catch`, which logs it.                                                                                                                                                                                                                                                                                                                                                                                      |
| T-06-05 | Spoofing                                | `routes/cards.route.ts` (`/open-editor`)                                                                                                               | `/open-editor` lives on `apiRouter`, so it inherits the router-wide Origin/Host loopback gate — no new mount, no second gate.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T-08    | Spoofing / Elevation / Info. Disclosure | `web/hooks/useTransitionNotifications.ts`, `web/hooks/useUnseenActivity.ts`, `routes/cards.route.ts` (`/cleanup`), `services/orchestration/cleanup.ts` | Notification/localStorage + cleanup safety: the first snapshot after connect/reconnect only SEEDS the previous-column ref (never notifies), so a reboot/reconnect can't spam notifications (T-08a-02); all localStorage access is try/catch-wrapped, degrading cosmetically and self-healing on next open (T-08a-03); cleanup derives every path/session from `card.*` + configured `repoPaths`, never the request body (T-08b-01 EoP), inherits the loopback gate (T-08b-03), and NEVER deletes a branch — branches always survive (T-08b-05).                                     |
| T-73-01 | Elevation of Privilege                  | `bootstrap/index.ts` (first `app.use`), `services/infra/remote-auth.ts`                                                                                | The hoisted `remoteAuthRouter` is the FIRST `app.use()`, ahead of `/api`, `/sessions`, and the static/SPA fallback, so one gate covers all of them; `hasValidSession` returns false the instant `currentToken == null`, with no `if (enabled)` branch anywhere — "feature never minted" and "wrong cookie" are the same fail-closed path.                                                                                                                                                                                                                                           |
| T-73-02 | Elevation of Privilege                  | `bootstrap/index.ts` (`handleUpgrade`)                                                                                                                 | The raw WS upgrade bypasses Express entirely, so `isRequestAllowed` — the SAME predicate the app-level gate uses — is called as the first statement of `handleUpgrade`, ahead of the `/sessions/` path check; a rejected upgrade is `rejectUpgrade`d (non-101, socket closed) and never reaches `terminalProxyUpgrade`/ttyd.                                                                                                                                                                                                                                                        |
| T-73-03 | Information Disclosure                  | `services/infra/remote-auth.ts`                                                                                                                        | `hasValidSession` and `verifyCode` both compare via `crypto.timingSafeEqual` on length-checked, equal-size buffers — never `===`/`includes`/`Buffer.compare` — so a submitted code or presented cookie can't be brute-forced by measuring per-byte compare timing.                                                                                                                                                                                                                                                                                                                  |
| T-73-04 | Tampering (CSRF)                        | `routes/remote-auth-gate.ts`                                                                                                                           | The verify route cross-checks `Origin`/`Referer` against the request's OWN `Host` (not a stored allowlist), so a forged cross-site POST carrying the attacker's origin never matches the victim's Host and is rejected with a plain 403 before it touches the rate-limit budget or the credential compare.                                                                                                                                                                                                                                                                          |
| T-73-05 | Information Disclosure                  | `routes/remote-auth-gate.ts`                                                                                                                           | A submitted code is consumed and stripped from the URL via a 302 redirect (never left sitting in browser history/referrer), and every gate response — the code-entry page, the verify POST, and the `?code=` redirect — sets `Referrer-Policy: no-referrer` so the passphrase never rides an outbound `Referer` header.                                                                                                                                                                                                                                                             |
| T-73-06 | Information Disclosure                  | `routes/remote-auth-gate.ts`                                                                                                                           | Feature-off (`currentToken == null`) and wrong-code both render the IDENTICAL code-entry page (same status, same markup); nothing in the response distinguishes "remote access isn't enabled" from "you typed the wrong code" (UI-SPEC identical-response disclosure rule).                                                                                                                                                                                                                                                                                                         |
| T-73-09 | Elevation of Privilege                  | `routes/index.ts`                                                                                                                                      | The superseded `apiRouter`-nested `isLocalRequest` gate (and its now-unused import) is REMOVED outright rather than left as a second, divergent check — one enforcement point only, so the two gates can never drift out of sync or leave a bypassable seam.                                                                                                                                                                                                                                                                                                                        |
| T-74-01 | Spoofing / Elevation of Privilege       | `adapters/cloudflared.ts` (spawn), `routes/loopback.ts`                                                                                                | `cloudflared --http-host-header dispatch.invalid` unconditionally rewrites Host to a non-loopback sentinel (live-verified) so `isLocalRequest` classifies ALL tunnel traffic remote; a spoofed `Host: 127.0.0.1` through the tunnel can never present as loopback. Closes the Phase-73 CR-01 residual below.                                                                                                                                                                                                                                                                        |
| T-74-02 | Tampering (CSRF)                        | `routes/remote-auth-gate.ts` (`originMatchesHost`), `services/orchestration/tunnel.ts`                                                                 | `originMatchesHost` compares a non-loopback request's Origin/Referer against `getKnownPublicHost()` (the real trycloudflare host tunnel.ts parsed), NOT `req.headers.host` — once the sentinel ships, `req.headers.host` is always the sentinel, so keeping the old comparison would 403 every legitimate remote code submission.                                                                                                                                                                                                                                                   |
| T-74-03 | Elevation of Privilege                  | `bootstrap/index.ts` (`shutdown`, the first SIGINT/SIGTERM handler), `services/orchestration/tunnel.ts`                                                | cloudflared is spawned as a NON-detached child; SIGINT/SIGTERM synchronously calls `disableTunnel()` (kills cloudflared + `clearToken()`) on shutdown — scoped narrowly, ttyd/tmux survive a restart untouched — and the tunnel is never persisted or auto-resumed.                                                                                                                                                                                                                                                                                                                 |
| T-74-04 | Elevation of Privilege                  | `adapters/cloudflared.ts` (`sweepStrayTunnels`), `bootstrap/index.ts` (boot)                                                                           | A one-shot boot sweep kills any stray process matching `basename(argv[0]) === "cloudflared"` AND the exact `dispatch.invalid` sentinel substring, NEVER adopts — a tunnel surviving a crashed prior boot is a live unauthenticated public shell; the fail-closed null token is the backstop even before the sweep runs.                                                                                                                                                                                                                                                             |
| T-74-05 | Information Disclosure                  | `services/orchestration/tunnel.ts`, `services/infra/remote-auth.ts` (`clearToken`)                                                                     | The token is minted fresh per enable and cleared synchronously on disable/shutdown, in-memory only; `TunnelState` never carries it beyond the `on.code` broadcast, and nothing tunnel-related is written to `~/.dispatch`.                                                                                                                                                                                                                                                                                                                                                          |
| T-74-06 | Tampering (supply chain)                | `package.json` (`uqr`)                                                                                                                                 | `uqr` is `[ASSUMED]` (registry/downloads/GitHub-org checks passed; `slopcheck` could not be run without side-effecting the repo) — the actual install is gated behind a `checkpoint:human-verify` legitimacy gate in Plan 02 before it enters the tree. (Numbered to stay parseable by the invariant-home gate's ID pattern, which only recognizes a digit-leading second segment with at most one trailing lowercase letter, never a bare multi-letter suffix, so the non-numeric supply-chain label used in planning could not be homed verbatim.)                                |
| T-76-01 | Information Disclosure                  | `shared/types.ts`, `adapters/gh.ts`, `adapters/artifact-detect.ts`                                                                                     | A previously log-only `gh` failure category (T-04-04's content-free latch) now ALSO rides `card.prsUnknown`/`card.previewsUnknown` on the wire. `ProbeUnknown.category` is typed as the fixed `ProbeFailureCategory` union, so no raw `gh`/`lsof`/pane stderr, repo path, or branch name can ever be assigned to it — only the closed enum crosses `store.snapshot()`'s chokepoint, unredacted by design, exactly as `hookRoutedAt` already does for a non-secret timestamp. The log-once latch in `adapters/gh.ts` is preserved unchanged.                                         |
| T-82-01 | Tampering / Denial of Service           | `routes/board.route.ts`, `routes/sse.route.ts`, `shared/done-limit.ts`                                                                                 | `doneLimit` is validated by `parseDoneLimit` as an integer in `[1, DONE_LIMIT_MAX=5000]` before it can reach `store.snapshot(opts)`. `GET /api/board` rejects an invalid value with `400` rather than clamping silently (mirroring `LIFE-04`'s `PUT /config/cleanup-delay` posture); `GET /api/stream` falls back to `DONE_PAGE_SIZE` instead, because an `EventSource` retries a failed connect forever and a 400 there would be an infinite reconnect loop rather than an actionable error. Negative, fractional, huge, and non-numeric values are all rejected before the slice. |
| T-82-02 | Denial of Service                       | `routes/board.route.ts` (`/search`), `store#searchCards`                                                                                               | `q` is trimmed and length-bounded to `[SEARCH_QUERY_MIN=2, SEARCH_QUERY_MAX=100]` before any scan, and the response is capped at `SEARCH_RESULT_LIMIT=20` rows with the true `total` reported separately, so neither scan cost nor response size can be driven by a pathological query. Not an injection control — the query never leaves a `String.includes` argument (no SQL, no shell, no template).                                                                                                                                                                             |
| T-82-03 | Information Disclosure                  | `store#searchCards`, `routes/cards.route.ts` (`GET /cards/:id`)                                                                                        | `searchCards` projects to the four-field `CardSearchResult`, so no card field beyond id/identifier/title/column can ride the search response by construction — stronger than redaction, since there is nothing to redact. `GET /cards/:id` returns `{ card: redactCard(card), members: [...].map(redactCard) }` — every member, not just the card, routed through the single sanctioned redaction site added in Plan 82-02 rather than a second `delete`, so a single-card fetch (including its members array) can never widen what `store.snapshot()` already redacts.             |

## Known Residuals

### CR-01 Terminal Iframe Sandbox Boundary

The terminal `<iframe>` in `TerminalRegion.tsx` KEEPS the `allow-same-origin` sandbox flag rather
than dropping it. An opaque-origin sandboxed iframe — what dropping the flag produces — CANNOT send
`SameSite=Lax`/`Strict` cookies on any subresource or WebSocket request (three authoritative
sources: web.dev, Chrome Privacy Sandbox, W3C TAG), and GATE-03's session cookie hardcodes
`SameSite=Lax`; dropping the flag would silently break the gate's own cookie-gated terminal loads
and its WS upgrade the moment either is reached through the gate. "Harden now" was analytically
ruled out by a real browser constraint, not skipped.

The accepted residual: same-origin terminal content can reach `window.parent`/`/api/*`. This is
bounded by three independent factors together — (a) the [gate](#security-threat-model) + the
Phase-74 ephemeral tunnel (short exposure window, a valid session required to ever reach the
iframe), (b) the iframe loads dispatch's OWN built bundle from `WEB_DIST_DIR` (no third-party
script can be injected into the served terminal page — see [Terminal ttyd](#terminal-ttyd)), and
(c) xterm.js rendering terminal OUTPUT as text, never executing it as HTML — so there is no
realistic script-injection vector into the iframe's JS context. This is the same class of
single-user-loopback-bounded risk already accepted at `T-01-05c`.

### Closed: mobile scroll does not depend on tmux `mouse on`

This subsection previously claimed mobile kinetic scroll depends on the target pane having tmux
mouse reporting on — that premise is MEASURED FALSE. With `set -g mouse off` and Claude Code
running, the attached client still received `?1000h ?1002h ?1003h ?1006h`: tmux forwards the PANE
APP's own mouse mode to the client regardless of tmux's own `mouse` option. `scrollMode()`
(`TERM-03`, [Terminal ttyd](#terminal-ttyd)) therefore returns `"report"` for every dispatch user
running Claude Code, `mouse on` or not, and with `mouse off` tmux does not run its own wheel
bindings either — the report still reaches Claude Code. One line per report is universal, not
config-dependent, so this deferral is CLOSED on a false premise rather than still open. The still-true
part survives unrelated to scroll: dispatch deliberately does not set tmux `mouse on` globally,
because that changes selection/copy behavior for every existing session — that choice simply has no
bearing on mobile scroll. The `mouseTrackingMode` gate still makes the wheel path a silent no-op in
the one case where reporting genuinely is off (a bare shell prompt, no app mouse mode requested), so
that residual case degrades to "no kinetic scroll" rather than a mis-scroll — safe, not broken.

### Touch selection in Claude Code REPL prompts already works

A single SGR left-click report on a REPL option row both SELECTS and CONFIRMS it in one tap —
verified twice on a live `/model` list against `claude` 2.1.220 under tmux 3.6a, with the probe's
side effect fully reverted each time. A wheel report on the same list changes nothing (wheel is
scroll only, never selection). No on-screen arrow/Enter key affordance is needed for REPL selection
prompts, and none should be added on the assumption that taps do not work — the only control on the
terminal page remains the zoom chip.

Two bounded caveats. First, prompts Claude Code shows BEFORE entering its main REPL — the "Is this a
project you trust?" gate, the first-run theme picker — run with `mouse_any_flag=0` and IGNORE
clicks; measured: an injected click had no effect while `Up`/`Down` moved the selection, so those
prompts are keyboard-only on mobile. Second, at 60% zoom a terminal row is only ~11 px tall, so
hitting the intended option in a list on a phone is a precision problem, not a plumbing one. Also
note xterm's `mousedown` handler calls `this.focus()`, so every tap summons the iOS keyboard and may
occlude part of the prompt — pre-existing behavior, recorded here so it is not misdiagnosed as a tap
failure. The one inferred (not device-verified) link in this chain: whether iOS Safari synthesizes
`mousedown` from a tap inside the sandboxed same-origin terminal iframe is established by code
reading and spec, not confirmed on a real device.

### Phase 73 CR-01 — Loopback Classifier Is Host-Header-Based — CLOSED (Phase 74)

`isLocalRequest` (`routes/loopback.ts`), the predicate both the HTTP gate (`T-73-01`) and the raw
WS-upgrade gate (`T-73-02`) call FIRST to grant a credential-free bypass, decides "local" from the
client-supplied `Origin`/`Host` headers, never from `req.socket.remoteAddress`. This is BY DESIGN:
the server binds `127.0.0.1` only, so nothing remote can open a socket to it, and the Phase-74
`cloudflared` sidecar itself connects over loopback — meaning the TCP peer address cannot
distinguish a local browser from tunnel-forwarded traffic, so a socket check would not help while
the tunnel's own leg is loopback. The classifier logic is therefore unchanged; the residual is
closed one layer up, at what Host value tunnel traffic ever presents.

**CLOSED by `T-74-01` + `T-74-02` together.** `T-74-01`: cloudflared is spawned with
`--http-host-header dispatch.invalid`, live-verified to unconditionally rewrite the Host the
origin sees on EVERY tunnel-forwarded request — including a client-supplied `Host: 127.0.0.1`
spoof — so `isLocalRequest` classifies all tunnel traffic non-loopback, with zero exceptions.
`T-74-02`: closing the Host residual this way makes `req.headers.host` always the sentinel for
tunnel traffic, so `originMatchesHost`'s CSRF check was fixed in the SAME phase to compare a
non-loopback request's Origin/Referer against `getKnownPublicHost()` (the real trycloudflare host
the tunnel manager parsed) instead — shipping the sentinel without this second fix would have
403'd every legitimate remote user. Both landed together in Phase 74 Plan 01; the BLOCKING live
verification (spoofed `Host: 127.0.0.1` rejected AND a legitimate remote user still authenticates)
is the `phase-smoke-tester` gate's job before the phase is considered done.

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

### Vite dev port is not in the preview exclusion set

The preview exclusion set (`adapters/artifact-detect.ts`) covers the backend's own resolved listen
port and every card's `ttydPort`, but NOT the Vite dev server's own port (F-09). `vite.config.ts`
sets no explicit `server.port` (only a `server.proxy` block for `/api/`/`/sessions/`) and
`package.json`'s `"dev"` script passes no port to either process, so the backend has no way to
introspect Vite's chosen port at runtime — it is never told it. The gap is real only under `npm run
dev`: in production the built SPA is served from the SAME Express origin the API already listens
on (`bootstrap/index.ts`'s `NODE_ENV === "production"` static-serving branch), so there is no
separate Vite port to exclude at all. The bounded consequence is a `npm run dev`-only possibility
that the Vite dev port is surfaced as a preview on some OTHER card's board entry if a session's
process tree happens to include it — accepted and recorded here rather than silently claimed
excluded.

### `GET /api/cards/:id` answers a group parent's real membership directly, independent of windowing

`App.tsx`'s `selectedCardMembers` derivation branches on whether the selected card is genuinely
in-window (`board.cards.some(...)`, the same test the members-precedence rule and the
actionability derivation below both reuse, rather than each writing an independent copy). An
IN-WINDOW group card still derives members from the live SSE snapshot via
`membersOf(selectedCard, board?.cards ?? [])` — `group-members.ts`'s `groupId` filter over
`board.cards`, unchanged, so members keep updating live wherever the snapshot actually has the
answer. An OUT-OF-WINDOW group card (reachable only via search, since windowing only ever excludes
`done` cards past the page size) falls back to `pinned.members`, populated by
`GET /api/cards/:id`'s response envelope: `{ card, members }`, where `members` is ALWAYS present
(`[]` for a non-group card, never absent — an absent list is never ambiguous with "this is not a
group"), and every entry — the card and each member — is routed through `redactCard`, the store's
one sanctioned redaction site, so a members array can never re-implement the `hookToken` strip via
a second, drift-prone copy (`T-82-03`).

The server side of this answers the membership question over `BoardStore`'s FULL in-memory `cards`
Map (`board.store.ts`'s `membersOf(groupId)`), never the windowed wire `snapshot()` — the whole
point of a single-card fetch (per its own JSDoc) is answering for cards the windowed snapshot
excludes, so routing the members lookup through `snapshot()` would just re-import the same
windowing gap it exists to route around. This server-side filter is a distinct implementation from
the client's own `group-members.ts#membersOf`, which filters an ALREADY-fetched `Card[]` array —
the two are kept as exactly two legitimate copies of the same `groupId` predicate, one server-side
over the live Map, one client-side over an array, rather than a third independently-derived
condition appearing anywhere.

Actionability stays a separate, explicit question from "are the members known at all." A hydrated
out-of-window group parent's member rows are actionable in exactly the same way an in-window
card's are: `MemberRow`'s `actionable: boolean` prop is REQUIRED (no default), derived at exactly
one site — `actionablePinnedMembers` in `pinned-card.ts`, the sibling to `actionablePinnedCard`
with the identical three-part stub-vs-hydrated guard — so a stub can never present an actionable
member row, and a future call site cannot silently inherit an answer nobody chose. A stub card
(`stubToCard`'s filler placeholder, every non-identity field meaningless) renders NO Members block
at all, not an empty or disabled one, because `ReferenceBlocks`'s `c.source === "group"` guard is
never satisfied by a stub — `stubToCard` never sets `source: "group"`.

This section previously recorded a deliberate residual: a search-opened group parent showed zero
members until it re-entered the window, because `GET /api/cards/:id` returned a bare card with no
membership data at all. That gap is closed — this section now describes the shipped mechanism,
not the defect it replaced.

## Verification Gates

Dev tooling, not test code (repo rule — no unit/e2e tests). Each gate answers one narrow,
mechanically-checkable question; none of them read prose for truth.

- **`npm run check`** — the standing CI-shaped gate: `format:check`, `lint`, `typecheck`,
  `deadcode` (knip), `replay-gate`, and `doc-drift` (below), run in sequence.
- **`node scripts/check-invariants.mjs`** — invariant-home audit: every ID in the frozen
  baseline (`scripts/invariant-baseline.txt`) must have a durable home (a JSDoc block in `src/`
  or anywhere in this doc). Deliberately NOT wired into `npm run check` — it gates the
  Phase 10 knowledge-migration baseline specifically, run on demand.
- **`node scripts/check-doc-drift.mjs`** (`npm run doc-drift`, wired into `npm run check`) —
  catches two classes of drift between this doc and `src/`: (1) `@see docs/ARCHITECTURE.md#...`
  pointers and backtick-quoted source-file citations in this doc that no longer resolve, and
  (2) internal planning-process vocabulary (`this phase`, `Plan NN-NN`, `Phase <number>`,
  `phase-smoke-tester`, `ROADMAP`, `.planning/`) leaking into shipped `src/` — the shape of bug
  that once shipped a "pre-this-phase" reference in `SettingsScreen.tsx`'s user-facing copy. See
  the script's own header JSDoc for the full scope, its JSDoc-citation carve-out, and what it
  deliberately does not attempt (behavioral claims — no grep proves a paragraph's claim about
  what the code does is still true).
- **`phase-smoke-tester`** — the only BEHAVIORAL verification this project runs: an agent derives
  and executes smoke cases against the running app after each phase's implementation lands. This
  is the one gate above that cannot be reduced to a grep.
