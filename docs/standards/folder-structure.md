# Folder Structure Standard

The target source layout for Dispatch. The tool is too small for per-feature folders but big enough that the flat `src/web/*` directory has become noisy, so the standard is capability folders on the backend plus a light layered split on the frontend, with a single lint-enforced import direction.

The layer names below are authoritative: backend `bootstrap / routes / services / adapters / sources / store` and frontend `primitives / features / hooks / lib / styles`. Where earlier research proposed other names (`http/`, `components/ui` + `components/board`), those were rationale only — these names win.

## Backend target tree — `src/server/`

```
src/server/
├── bootstrap/     # composition root + preflight: startup wiring, config holder, binary preflight, boot reconcile
├── routes/        # HTTP transport: route handlers (thin), SSE broadcaster, loopback/DNS-rebinding guard
├── services/      # orchestration: the start/cleanup saga, kickoff, config validation, rollback
├── adapters/      # subprocess + external I/O: tmux, ttyd, git, the exec chokepoint, claude-trust, marker parse/watcher, Linear poller, editors, the macOS calendar reader (calendar-mac.ts)
├── sources/       # ticket and item sources: provider seams (linear.source.ts, github/github.source.ts, sentry/sentry.source.ts, slack/slack-api.ts), source registry, per-source filters, the calendar snapshot source (calendar/)
└── store/         # single-writer state: board.store (never split) + Linear→Card mapping
```

### Original → target mapping (backend, historical — the left column describes the pre-restructure tree)

| Current                                                                               | Target layer                   |
| ------------------------------------------------------------------------------------- | ------------------------------ |
| `index.ts`, `config.ts`, `binaryCheck.ts`                                             | `bootstrap/`                   |
| `sessions/reconcile.ts` (boot service)                                                | `bootstrap/`                   |
| `api/routes.ts`, `api/sse.ts` (+ extracted loopback guard)                            | `routes/`                      |
| `orchestrator/{startSession,steps,cleanup,kickoff,validateConfig}.ts`                 | `services/`                    |
| `sessions/{tmux,ttyd,git,exec,claudeTrust}.ts`, `sessions/markers/{parse,watcher}.ts` | `adapters/`                    |
| `linear/poller.ts`                                                                    | `adapters/` (external adapter) |
| `editors.ts` (root file today — it is a subprocess adapter)                           | `adapters/`                    |
| `store/{board.store,mapping}.ts`                                                      | `store/`                       |

The calendar source lives in `sources/calendar/` (`calendar.source.ts`, `calendar-events.ts`, `ics.ts`); its macOS reader is the subprocess adapter `adapters/calendar-mac.ts`, injected at boot (the registry setters `setMacCalendarReader` and `setCredentialResolver`) because a source may import only sources and shared. Its status, calendar list and settings service is `services/orchestration/calendar.ts`, since it runs osascript, writes config and restarts pollers.

`board.store.ts` stays one cohesive single-writer class — it is never split.

## Frontend target tree — `src/web/`

```
src/web/
├── main.tsx        # entry
├── App.tsx         # shell
├── primitives/     # reusable presentational design-system parts: Button, IconButton, Notice, Modal, Field, Glyph, Markdown, PageHeader
├── features/       # feature folders: kebab-case directories, PascalCase components inside
│   ├── board/      # Board, Column, Card, CardView, EmptyState
│   ├── detail/     # DetailPanel, PanelHeader, ReferenceBlocks, SessionLostSection, TerminalRegion
│   ├── nav/        # SidebarNav, NavRow, SyncStatus, nav-items
│   ├── modals/     # StartModal, CleanupModal, MultiSelect
│   ├── settings/   # SettingsScreen (full-screen, sidebar-nav), PlaybookEditorModal
│   ├── slack/      # SlackPage, SlackList, SlackDetail, SlackThread (the Inbox row reuses SlackThread through the barrel)
│   └── badges/     # GoneBadge, PlanReadyBadge, SourceBadge — shared leaf feature (see import direction)
├── hooks/          # data/effect hooks: useBoardStream, useUnseenActivity, useTransitionNotifications, useResumeFeedback, useMediaQuery
├── lib/            # non-UI helpers: api.ts, card-badges.ts, format-age.ts, resume-feedback.ts, start-request.ts, meetings.ts, calendar.ts
└── styles/         # tokens.css — the design-token source of truth, survives unchanged
```

`features/badges/brands/` (since 2026-09-30, G9 Unit 3) holds the six brand mark components (`GitHubMark.tsx`, `LinearMark.tsx`, `SlackMark.tsx`, `SentryMark.tsx`, `GranolaMark.tsx`, `CalendarMark.tsx`) and their shared svg shell `MarkSvg.tsx`. Only `features/badges/source-mark.ts` and its test import from the folder; every file outside `features/badges/` reads a mark through `sourceMark()` of the badges barrel, with one exception: `features/nav/nav-items.test.ts` reads the map `SOURCE_MARK` from `source-mark.ts` direct.

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md`. The new tree is `src/web/routes/`, `src/web/modules/<feature>/` with six layer folders, `src/web/components/ui/`, `src/web/components/`, `src/web/queries/`, the new files in `src/web/lib/` and `src/web/styles/globals.css`. Until ticket 16, this section still applies to the legacy tree that the new standard names in "Status and scope".

### Component placement (frontend)

| Artifact                                                                                                                                   | Home                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `main.tsx`, `App.tsx`                                                                                                                      | web root (entry + shell)         |
| `Board.tsx`, `Column.tsx`, `Card.tsx`, `CardView.tsx`, `EmptyState.tsx`                                                                    | `features/board/`                |
| `DetailPanel.tsx`, `PanelHeader.tsx`, `ReferenceBlocks.tsx`, `SessionLostSection.tsx`, `TerminalRegion.tsx`                                | `features/detail/`               |
| `SidebarNav.tsx`, `NavRow.tsx`, `SyncStatus.tsx`                                                                                           | `features/nav/`                  |
| `StartModal.tsx`, `CleanupModal.tsx`, `MultiSelect.tsx`                                                                                    | `features/modals/`               |
| `SettingsScreen.tsx`, `PlaybookEditorModal.tsx`                                                                                            | `features/settings/`             |
| `GoneBadge.tsx`, `PlanReadyBadge.tsx`, `SourceBadge.tsx`                                                                                   | `features/badges/` (shared leaf) |
| `SessionsPage.tsx`, `SessionRow.tsx`                                                                                                       | `features/sessions/`             |
| `PullRequestsPage.tsx`, `PrList.tsx`, `PrDetail.tsx`                                                                                       | `features/pull-requests/`        |
| `ErrorsPage.tsx`, `ErrorList.tsx`, `ErrorDetail.tsx`, `error-rows.ts`                                                                      | `features/errors/`               |
| `TodayPage.tsx`, `P0Card.tsx`, `CountChips.tsx`, `TodayList.tsx`, `Agenda.tsx`, `EntryRow.tsx`, `today-view.ts`                            | `features/today/`                |
| `SlackPage.tsx`, `SlackList.tsx`, `SlackDetail.tsx`, `SlackThread.tsx`                                                                     | `features/slack/`                |
| `MeetingNotesModal.tsx`, `MeetingsPage.tsx`, `MeetingList.tsx`, `MeetingDetail.tsx`                                                        | `features/meetings/`             |
| `CalendarPage.tsx`                                                                                                                         | `features/calendar/`             |
| `WorkspacesPage.tsx`, `WorktreeRow.tsx`, `WorkspaceFolders.tsx`, `WorkspaceAdd.tsx`, `FolderBrowserModal.tsx`                              | `features/workspaces/`           |
| `AskPage.tsx`, `AskComposer.tsx`, `AskMessage.tsx`                                                                                         | `features/ask/`                  |
| `FlowPage.tsx`, `FlowToolbar.tsx`, `FlowDiagram.tsx`, `FlowNarrow.tsx`, `flow-model.ts`                                                    | `features/flow/`                 |
| `useBoardStream.ts`, `useUnseenActivity.ts`, `useTransitionNotifications.ts`, `useResumeFeedback.ts`, `useMediaQuery.ts`                   | `hooks/`                         |
| `api.ts`, `card-badges.ts`, `format-age.ts`, `resume-feedback.ts`, `start-request.ts`, `meetings.ts`, `calendar.ts`                        | `lib/`                           |
| `Button` / `IconButton` / `Notice` / `Modal` / `Field` / `Glyph` / `Markdown` / `SplitView` / `ListGroup` / `DetailPaneBody` / `FlowStage` | `primitives/`                    |
| `tokens.css`                                                                                                                               | `styles/`                        |

A component lives in the folder of the feature that consumes it; a component consumed by exactly one feature is co-located with that consumer (`PlaybookEditorModal` sits in `settings/` because `SettingsScreen` is its only consumer). `MultiSelect` stays in `modals/` even though both `settings/` and `inbox/` now consume it: cross-feature reuse goes through the owning feature's `index.ts` barrel rather than forcing a move. `features/connections/` follows the same rule: `LinearConnectionCard` composes the connection primitives with the Linear hook, and Settings imports it through the `connections` barrel so the setup wizard can reuse the same card instead of forking it.

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md`. Place a new file in a layer that the new standard defines. Until ticket 16, this section still applies to the legacy tree that the new standard names in "Status and scope".

## Import direction (unidirectional)

Imports flow one way; the lower a layer sits, the fewer things it may import. This encodes the layering the code already follows and is **enforced at error severity** by `eslint-plugin-boundaries`'s `boundaries/dependencies` rule, gating `npm run check` — a wrong-direction import fails the build, it is not merely a style convention. See `docs/standards/code-review-rules.md` for the per-layer review checklist derived from this rule.

**Backend:** `shared` → (`store`, `adapters`) → `services` → `routes`, with `bootstrap` as the composition root that wires them at startup. Routes never call `exec`/`tmux`/`git` directly — only through `services`/`adapters`. `shared` is a sink (imported by everyone, imports nothing app-specific). `store` is a single-writer island: nothing outside `store/` mutates board state.

**Frontend:** `primitives` → `hooks`/`lib` → `features` → `App`. Primitives are purely presentational (props in, no data fetching); hooks own data and effects; features compose them. Within the `hooks`/`lib` tier the rule is asymmetric: `hooks` may import `lib` (data hooks legitimately sit on `lib/api`), but `lib` never imports `hooks` — `lib` is the pure-helper floor of the tier. Two files carry a temporary `warn`-severity exception to this rule rather than `error`: `lib/card-badges.ts` (imports `hooks/useUnseenActivity`) and `primitives/ActivityItem.tsx` (imports `lib/event-copy` and `lib/format-age`). The exception is recorded as a named, trailing file-glob carve-out block (`feWebBoundariesWarnCarveout`) in `eslint.config.ts`, and tracked as open debt in `docs/standards/architecture.md`'s "Triage-derived layering-violation fixes" gap-list entry — Phase 57 work, not a silent gap.

Feature folders never import from sibling feature folders — cross-feature sharing goes through `primitives/`, `hooks/`, `lib/`, or `shared/`. The single sanctioned exception is `features/* → badges`: `badges/` is a shared LEAF feature — its components import nothing of their own and may be imported by any feature. The edge is encoded in `eslint.config.ts` as an explicit allow policy, enforced at error alongside the rest of the frontend import-direction rule; the graph stays acyclic.

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md`. The Frontend paragraph of this section describes the legacy tree only. The new tree follows the import matrix of the new standard. Until ticket 16, this section still applies to the legacy tree that the new standard names in "Status and scope".

## Naming convention

One convention spans the whole tree. Every artifact kind has a fixed pattern and folder home:

| Artifact kind                 | Location             | Pattern                     | Example               |
| ----------------------------- | -------------------- | --------------------------- | --------------------- |
| React component               | `src/web/**`         | `PascalCase.tsx`            | `SettingsScreen.tsx`  |
| React hook                    | `src/web/hooks`      | `useX.ts` (camelCase)       | `useBoardStream.ts`   |
| Web util / client             | `src/web/lib`        | `kebab-case.ts`             | `card-badges.ts`      |
| HTTP route module             | `src/server/routes`  | `<resource>.route.ts`       | `cards.route.ts`      |
| Route zod schemas (over 3)    | `src/server/routes`  | `<resource>-schemas.ts`     | `cards-schemas.ts`    |
| Store module                  | `src/server/store`   | `<domain>.store.ts`         | `board.store.ts`      |
| Ticket source                 | `src/server/sources` | `<name>.source.ts`          | `linear.source.ts`    |
| Service / adapter / bootstrap | `src/server/**`      | `kebab-case.ts` (no suffix) | `start-session.ts`    |
| Test (node:test)              | `src/**`             | `<subject>.test.ts`         | `attachments.test.ts` |

The enforceable rule: `.tsx` → PascalCase; `hooks/*.ts` → `useX` camelCase; every other `.ts` → kebab-case; `route`/`store`/`source` suffixes layered on via glob. Role suffixes apply **only** where a folder groups by resource (`routes/`, `store/`, `sources/`) — everywhere else the folder already encodes the layer, so the suffix is dropped (the Angular v20 lesson: no redundant type suffixes). Helpers that live inside a resource folder but are not themselves the resource module (`store/mapping.ts`, `sources/registry.ts`, `sources/linear/filter.ts`, `routes/loopback.ts`) stay plain kebab-case.

The server tree and the web tree both conform fully — the table above states the pattern every new file must follow. The naming convention is lint-enforced at error severity by `eslint-plugin-check-file` (`filename-naming-convention` per file class plus `folder-naming-convention` for kebab-case folders) inside `npm run check`, so a wrongly-named file or folder fails the gate rather than landing silently.

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md`. The web rows of this table describe the legacy tree only. New web files follow the Naming section of the new standard. In that section, hook files are kebab-case. Until ticket 16, this section still applies to the legacy tree that the new standard names in "Status and scope".

## Build artifacts

`src/web/dist/` is a build artifact and must not live in source control — it belongs in `.gitignore`, not tracked in git.
