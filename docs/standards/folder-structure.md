# Folder Structure Standard

The source layout for the Dispatch backend: capability folders with a single lint-enforced import direction. The frontend layout is in `docs/standards/frontend-architecture.md`.

The backend layer names below are authoritative: `bootstrap / routes / services / adapters / sources / store`. Earlier research proposed other names (`http/`). Those names were rationale only, and these names win.

## Backend target tree — `src/server/`

```
src/server/
├── bootstrap/     # composition root + preflight: startup wiring, config holder, binary preflight, boot reconcile
├── routes/        # HTTP transport: route handlers (thin), SSE broadcaster, loopback/DNS-rebinding guard
├── services/      # orchestration: the start/cleanup saga, config validation, rollback
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

## Frontend tree

The frontend tree is the module tree. `docs/standards/frontend-architecture.md` defines it: the folder list in "Status and scope", the layer definitions, the shared tiers and the Naming section.

Record, 2026-10-07 (LOCAL-77): the legacy frontend target tree, the brand marks paragraph, the component placement table and their supersede notes are removed, because the legacy tree is deleted. `git log -p docs/standards/folder-structure.md` shows the old text.

## Import direction (unidirectional)

Imports flow one way; the lower a layer sits, the fewer things it may import. This encodes the layering the code already follows and is **enforced at error severity** by `eslint-plugin-boundaries`'s `boundaries/dependencies` rule, gating `npm run check` — a wrong-direction import fails the build, it is not merely a style convention. See `docs/standards/code-review-rules.md` for the per-layer review checklist derived from this rule.

**Backend:** `shared` → (`store`, `adapters`) → `services` → `routes`, with `bootstrap` as the composition root that wires them at startup. Routes never call `exec`/`tmux`/`git` directly — only through `services`/`adapters`. `shared` is a sink (imported by everyone, imports nothing app-specific). `store` is a single-writer island: nothing outside `store/` mutates board state.

**Frontend:** the import matrix of `docs/standards/frontend-architecture.md` governs `src/web/`. Record, 2026-10-07 (LOCAL-77): the legacy frontend paragraphs (primitives, hooks, lib and features) are removed with the legacy tree.

## Naming convention

One convention spans the whole tree. Every artifact kind has a fixed pattern and folder home:

| Artifact kind                 | Location             | Pattern                     | Example               |
| ----------------------------- | -------------------- | --------------------------- | --------------------- |
| HTTP route module             | `src/server/routes`  | `<resource>.route.ts`       | `cards.route.ts`      |
| Route zod schemas (over 3)    | `src/server/routes`  | `<resource>-schemas.ts`     | `cards-schemas.ts`    |
| Store module                  | `src/server/store`   | `<domain>.store.ts`         | `board.store.ts`      |
| Ticket source                 | `src/server/sources` | `<name>.source.ts`          | `linear.source.ts`    |
| Service / adapter / bootstrap | `src/server/**`      | `kebab-case.ts` (no suffix) | `start-session.ts`    |
| Test (node:test)              | `src/**`             | `<subject>.test.ts`         | `attachments.test.ts` |

The enforceable rule: every `.ts` file is kebab-case; `route`/`store`/`source` suffixes layered on via glob. Role suffixes apply **only** where a folder groups by resource (`routes/`, `store/`, `sources/`). Everywhere else the folder already encodes the layer, so the suffix is dropped (the Angular v20 lesson: no redundant type suffixes). Helpers that live inside a resource folder but are not themselves the resource module (`store/mapping.ts`, `sources/registry.ts`, `sources/linear/filter.ts`, `routes/loopback.ts`) stay plain kebab-case.

The server tree conforms fully. The table above states the pattern every new file must follow. The naming convention is lint-enforced at error severity by `eslint-plugin-check-file` (`filename-naming-convention` per file class plus `folder-naming-convention` for kebab-case folders) inside `npm run check`, so a wrongly-named file or folder fails the gate rather than landing silently.

Web file names follow the Naming section of `docs/standards/frontend-architecture.md`. Record, 2026-10-07 (LOCAL-77): the web rows of the table above are removed with the legacy tree.

## Build artifacts

`src/web/dist/` is a build artifact and must not live in source control — it belongs in `.gitignore`, not tracked in git.
