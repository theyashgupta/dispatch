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
└── store/         # single-writer state: boardStore (never split) + Linear→Card mapping
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
| `store/{boardStore,mapping}.ts`                                                       | `store/`                       |

`boardStore.ts` stays one cohesive single-writer class — it is never split.

## Frontend target tree — `src/web/`

```
src/web/
├── main.tsx        # entry
├── App.tsx         # shell
├── primitives/     # reusable presentational design-system parts: Button, IconButton, Notice, Modal, Field + typed style objects
├── features/       # board feature components: Board, Column, Card, EmptyState, GoneBadge, SyncStrip, DetailPanel, StartModal, CleanupModal
├── hooks/          # data/effect hooks: useBoardStream, useUnseenActivity, useTransitionNotifications
├── lib/            # non-UI helpers: api fetch wrappers
└── styles/         # tokens.css — the design-token source of truth, survives unchanged
```

### Current → target mapping (frontend)

| Current (flat `src/web/`)                                                                                                                          | Target layer                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `main.tsx`, `App.tsx`                                                                                                                              | web root (entry + shell)          |
| `Board.tsx`, `Column.tsx`, `Card.tsx`, `EmptyState.tsx`, `GoneBadge.tsx`, `SyncStrip.tsx`, `DetailPanel.tsx`, `StartModal.tsx`, `CleanupModal.tsx` | `features/`                       |
| `useBoardStream.ts`, `useUnseenActivity.ts`, `useTransitionNotifications.ts`                                                                       | `hooks/`                          |
| `api.ts`                                                                                                                                           | `lib/`                            |
| `tokens.css`                                                                                                                                       | `styles/` (unchanged)             |
| `StartupErrorScreen.tsx`                                                                                                                           | deleted (dead code — never wired) |
| the new `Button` / `IconButton` / `Notice` / `Modal` / `Field` primitives                                                                          | `primitives/`                     |

## Import direction (unidirectional)

Imports flow one way; the lower a layer sits, the fewer things it may import. This encodes the layering the code already follows and is lint-enforceable via `import/no-restricted-paths` or `eslint-plugin-boundaries`.

**Backend:** `shared` → (`store`, `adapters`) → `services` → `routes`, with `bootstrap` as the composition root that wires them at startup. Routes never call `exec`/`tmux`/`git` directly — only through `services`/`adapters`. `shared` is a sink (imported by everyone, imports nothing app-specific). `store` is a single-writer island: nothing outside `store/` mutates board state.

**Frontend:** `primitives` → `hooks`/`lib` → `features` → `App`. Primitives are purely presentational (props in, no data fetching); hooks own data and effects; features compose them.

## Build artifacts

`src/web/dist/` is a build artifact and must not live in source control — it belongs in `.gitignore`, not tracked in git.
