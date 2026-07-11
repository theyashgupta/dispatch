# Folder Structure Standard

The target source layout for Dispatch. The tool is too small for per-feature folders but big enough that the flat `src/web/*` directory has become noisy, so the standard is capability folders on the backend plus a light layered split on the frontend, with a single lint-enforced import direction.

The layer names below are authoritative: backend `bootstrap / routes / services / adapters / store` and frontend `primitives / features / hooks / lib / styles`. Where earlier research proposed other names (`http/`, `components/ui` + `components/board`), those were rationale only — these names win.

## Backend target tree — `src/server/`

```
src/server/
├── bootstrap/     # composition root + preflight: startup wiring, config holder, binary preflight, boot reconcile
├── routes/        # HTTP transport: route handlers (thin), SSE broadcaster, loopback/DNS-rebinding guard
├── services/      # orchestration: the start/cleanup saga, kickoff, config validation, rollback
├── adapters/      # subprocess + external I/O: tmux, ttyd, git, the exec chokepoint, claude-trust, marker parse/watcher, Linear poller, editors
└── store/         # single-writer state: board.store (never split) + Linear→Card mapping
```

### Current → target mapping (backend)

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

`board.store.ts` stays one cohesive single-writer class — it is never split.

## Frontend target tree — `src/web/`

```
src/web/
├── main.tsx        # entry
├── App.tsx         # shell
├── primitives/     # reusable presentational design-system parts: Button, IconButton, Notice, Modal, Field, Glyph, Markdown
├── features/       # feature folders: kebab-case directories, PascalCase components inside
│   ├── board/      # Board, Column, Card, CardView, EmptyState
│   ├── detail/     # DetailPanel, PanelHeader, ReferenceBlocks, SessionLostSection, TerminalRegion
│   ├── sync/       # SyncStrip
│   ├── modals/     # StartModal, SettingsModal, CleanupModal, MultiSelect
│   └── badges/     # GoneBadge, PlanReadyBadge, SourceBadge — shared leaf feature (see import direction)
├── hooks/          # data/effect hooks: useBoardStream, useUnseenActivity, useTransitionNotifications, useResumeFeedback, useMediaQuery
├── lib/            # non-UI helpers: api.ts, card-badges.ts, format-age.ts, resume-feedback.ts, start-request.ts
└── styles/         # tokens.css — the design-token source of truth, survives unchanged
```

### Component placement (frontend)

| Artifact                                                                                                                 | Home                             |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `main.tsx`, `App.tsx`                                                                                                    | web root (entry + shell)         |
| `Board.tsx`, `Column.tsx`, `Card.tsx`, `CardView.tsx`, `EmptyState.tsx`                                                  | `features/board/`                |
| `DetailPanel.tsx`, `PanelHeader.tsx`, `ReferenceBlocks.tsx`, `SessionLostSection.tsx`, `TerminalRegion.tsx`              | `features/detail/`               |
| `SyncStrip.tsx`                                                                                                          | `features/sync/`                 |
| `StartModal.tsx`, `SettingsModal.tsx`, `CleanupModal.tsx`, `MultiSelect.tsx`                                             | `features/modals/`               |
| `GoneBadge.tsx`, `PlanReadyBadge.tsx`, `SourceBadge.tsx`                                                                 | `features/badges/` (shared leaf) |
| `useBoardStream.ts`, `useUnseenActivity.ts`, `useTransitionNotifications.ts`, `useResumeFeedback.ts`, `useMediaQuery.ts` | `hooks/`                         |
| `api.ts`, `card-badges.ts`, `format-age.ts`, `resume-feedback.ts`, `start-request.ts`                                    | `lib/`                           |
| `Button` / `IconButton` / `Notice` / `Modal` / `Field` / `Glyph` / `Markdown`                                            | `primitives/`                    |
| `tokens.css`                                                                                                             | `styles/`                        |

A component lives in the folder of the feature that consumes it; a component consumed by exactly one feature is co-located with that consumer (`MultiSelect` sits in `modals/` because `SettingsModal` is its only consumer).

## Import direction (unidirectional)

Imports flow one way; the lower a layer sits, the fewer things it may import. This encodes the layering the code already follows and is lint-enforceable via `import/no-restricted-paths` or `eslint-plugin-boundaries`.

**Backend:** `shared` → (`store`, `adapters`) → `services` → `routes`, with `bootstrap` as the composition root that wires them at startup. Routes never call `exec`/`tmux`/`git` directly — only through `services`/`adapters`. `shared` is a sink (imported by everyone, imports nothing app-specific). `store` is a single-writer island: nothing outside `store/` mutates board state.

**Frontend:** `primitives` → `hooks`/`lib` → `features` → `App`. Primitives are purely presentational (props in, no data fetching); hooks own data and effects; features compose them.

Feature folders never import from sibling feature folders — cross-feature sharing goes through `primitives/`, `hooks/`, `lib/`, or `shared/`. The single sanctioned exception is `features/* → badges`: `badges/` is a shared LEAF feature — its components import nothing of their own and may be imported by any feature. The edge is declared here so the boundaries DAG encodes it as an explicit allow when per-feature lint enforcement lands; the graph stays acyclic.

## Naming convention

One convention spans the whole tree. Every artifact kind has a fixed pattern and folder home:

| Artifact kind                 | Location             | Pattern                     | Example             |
| ----------------------------- | -------------------- | --------------------------- | ------------------- |
| React component               | `src/web/**`         | `PascalCase.tsx`            | `SettingsModal.tsx` |
| React hook                    | `src/web/hooks`      | `useX.ts` (camelCase)       | `useBoardStream.ts` |
| Web util / client             | `src/web/lib`        | `kebab-case.ts`             | `card-badges.ts`    |
| HTTP route module             | `src/server/routes`  | `<resource>.route.ts`       | `cards.route.ts`    |
| Store module                  | `src/server/store`   | `<domain>.store.ts`         | `board.store.ts`    |
| Ticket source                 | `src/server/sources` | `<name>.source.ts`          | `linear.source.ts`  |
| Service / adapter / bootstrap | `src/server/**`      | `kebab-case.ts` (no suffix) | `start-session.ts`  |

The enforceable rule: `.tsx` → PascalCase; `hooks/*.ts` → `useX` camelCase; every other `.ts` → kebab-case; `route`/`store`/`source` suffixes layered on via glob. Role suffixes apply **only** where a folder groups by resource (`routes/`, `store/`, `sources/`) — everywhere else the folder already encodes the layer, so the suffix is dropped (the Angular v20 lesson: no redundant type suffixes). Helpers that live inside a resource folder but are not themselves the resource module (`store/mapping.ts`, `sources/registry.ts`, `sources/linear/filter.ts`, `routes/loopback.ts`) stay plain kebab-case.

The server tree and the web tree both conform fully — the table above states the pattern every new file must follow.

## Build artifacts

`src/web/dist/` is a build artifact and must not live in source control — it belongs in `.gitignore`, not tracked in git.
