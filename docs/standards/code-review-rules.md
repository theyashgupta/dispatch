# Code Review Rules (per layer)

The review-agent standard: a per-layer checklist for anything checking a diff against Dispatch's architecture, extracted from the already-ratified standards (`backend-design.md`, `folder-structure.md`, `frontend-design-system.md`, `comments.md`) and the as-landed `eslint.config.ts`. Every line below is an objectively checkable assertion, not a restatement of rationale — see the linked doc for the WHY.

## The three enforcement layers

1. **ESLint at error (`npm run check`).** Import-direction boundaries (`boundaries/dependencies`) and the exec-chokepoint ban (`no-restricted-imports` on `node:child_process`) are machine-enforced at `error` severity across `src/**`. A violating diff fails the build before it reaches review.
2. **Tracked Claude Code hooks.** Git tracks `.claude/settings.json` and the scripts in `.claude/hooks/`. The `PreToolUse` hook denies an `Edit` or `Write` that breaks a deny rule of `frontend-architecture.md`. For an allowed edit, it adds a pointer to the applicable `docs/standards/*.md` file. The `PostToolUse` hook formats each edited file with prettier. The `Stop` hook runs `format:check`, `lint`, `typecheck` and `depcruise` before a session with changes stops. These hooks need Claude Code CLI 2.1.9 or later.
3. **This review doc.** Checks what lint structurally cannot: intent, business-rule placement, side-effect discipline, and the shape of a change rather than its import graph.

Scope: this doc exists for what layer 1 cannot express — a route file with zero disallowed imports can still validate asynchronously, or a domain file can still smuggle in a subprocess call through an already-allowed adapter. Layers 1 and 2 catch import-direction and chokepoint violations mechanically; this layer catches everything else.

## Backend: `routes/`

- [ ] Validates synchronously and returns 4xx before any async work begins; handlers stay thin (`docs/standards/backend-design.md` — Transport contract).
- [ ] Never imports `adapters/{exec,git,tmux}.ts` directly — subprocess calls go through `services`/`adapters` only (lint-enforced at error; this is the intent check behind that rule).
- [ ] Fire-and-forgets anything slower than ~50ms (cold ttyd start, the saga) and carries state to the client over SSE rather than blocking the response.
- [ ] Parses `params`, `query` and `body` with a zod schema and throws typed errors from `services/domain/errors.ts` (`docs/standards/backend-design.md`, Validation and Errors).
- [ ] A converted route does not call `res.status` with a 4xx or 5xx code.
- [ ] Calls the board store through `boardRepository` from `store/board-repository.ts`, never through `board.store.ts` (`docs/standards/backend-design.md`, Agent rules block rule 3).

## Backend: `services/orchestration/`

- [ ] Composes adapters + store writes; steps are idempotent (`docs/standards/backend-design.md` rule on producer/orchestration shape).
- [ ] Where a flow has genuine compensation (a do step with a matching undo/rollback), it is a saga proper: `start-session.ts`, `resume-session.ts`, `cleanup.ts`. Flows without compensation (`terminal.ts`, `uninstall.ts`, `update.ts`, `playbook-generate.ts`, the timer-driven `granola-round.ts`) still belong here because they compose adapters + store, not because they carry rollback, do not claim "saga" for these in new documentation or comments.
- [ ] Reads and writes the board store through `boardRepository`; a new test replaces it with `fakeBoardRepository` (`docs/standards/backend-design.md`, Tests).
- [ ] No new second write path to `board.json` or the in-memory snapshot — every mutation still goes through the store's single-writer queue.

## Backend: `services/domain/`

- [ ] Pure business rules and builders only: no subprocess execution and no store access.
- [ ] No new file in this tier reaches into `adapters-subprocess` (`exec`/`git`/`tmux`) — that stays an `orchestration`/`adapters` concern.

## Backend: `services/infra/`

- [ ] Plumbing and file-backed stores only (config holder, path constants, preflight, vault, kickoff, playbooks, attachments). No saga steps.
- [ ] Any subprocess call (e.g. a preflight binary check) routes through `adapters/exec.ts`'s `run()` or `runInherit()`, never a local `spawn`/`execFile` invocation.

## Backend: `adapters/`

- [ ] All subprocess execution routes through the single argv-array `adapters/exec.ts` chokepoint's `run()` (capture-and-await) or `runInherit()` (stdio-inherit foreground streaming) — no shell, no string interpolation, no new third spawn shape.
- [ ] No new `node:child_process` import outside the four ruled carve-out files (the exec chokepoint, its two AUDIT-01 exceptions, and the Phase-74 `cloudflared.ts` extension — see Named Exceptions below); lint-enforced at error, this checklist line is the intent check behind it.
- [ ] External I/O (Linear poller, image-proxy, editors) stays isolated to this tier — no `services/` or `routes/` file performs external I/O directly.

## Backend: `store/`

- [ ] Every mutation goes through `board.store.ts`'s single-writer mutation queue — no new file introduces a second write path to `board.json` or the in-memory snapshot.
- [ ] Column-sensitive checks happen INSIDE the mutator, against live state (the `WR-04` invariant) — never read-then-write from outside the queue.
- [ ] `board.store.ts` is never split into multiple classes; helpers live alongside it (e.g. `store/mapping.ts`), not as a second writer.

## Backend: `sources/`

- [ ] Ticket-source provider seams (`linear.source.ts`, the source registry, per-source filters) stay isolated to this tier — no `routes/` or `services/` file talks to a ticket provider directly.

## Backend: `bootstrap/`

- [ ] Only `bootstrap/index.ts` calls `setBoardRepository` in source code.
- [ ] Composition-root only: wiring, config holder, binary preflight, boot reconcile. No business logic lives here — if a bootstrap file grows business rules, that's a domain-layer extraction, not a bootstrap concern.
- [ ] The named `bootstrap/` exec carve-out (`cli.ts`) keeps its direct `node:child_process` import narrowly scoped to the ruled behavior (a detached fire-and-forget browser opener) — do not widen it beyond its ruled shape.

## Frontend: `primitives/`

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md` for new code. Until ticket 16, this checklist applies only to the legacy tree that the new standard names in "Status and scope".

- [ ] Props in, no data fetching: zero imports from `hooks/`, `lib/`, `feature`, or `web` (lint-enforced at error; this is the intent check — a primitive that reaches into `lib/` for formatting is a layering violation, e.g. the one Phase 57 fixed in `ActivityItem.tsx` by hoisting the formatting calls to its callers).
- [ ] Purely presentational; a props type is declared immediately above the component (`docs/standards/frontend-design-system.md` anatomy checklist).

## Frontend: `hooks/`

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md` for new code. Until ticket 16, this checklist applies only to the legacy tree that the new standard names in "Status and scope".

- [ ] May import `lib/` (data hooks legitimately sit on `lib/api`), but never `feature` or `web` — import direction is `primitives -> hooks/lib -> features -> App`.
- [ ] Filename is `useX.ts` camelCase (`docs/standards/folder-structure.md` naming convention).

## Frontend: `lib/`

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md` for new code. Until ticket 16, this checklist applies only to the legacy tree that the new standard names in "Status and scope".

- [ ] Never imports React or `react-dom` (lint-enforced at error via `no-restricted-imports` scoped to `src/web/lib/**/*.ts`) — `lib` is the pure-helper floor of the tier.
- [ ] Never imports `primitives/`, `hooks/`, `feature`, or `web` — the asymmetric rule: `hooks` may import `lib`, `lib` never imports upward into `hooks`.

## Frontend: `features/`

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md` for new code. Until ticket 16, this checklist applies only to the legacy tree that the new standard names in "Status and scope".

- [ ] Cross-feature imports go through the target feature's `index.ts` barrel only — a deep import into a sibling feature's internals is a violation (lint-enforced at error).
- [ ] The badges live in the shared tier `src/web/components/badges/` (moved from `features/badges/` in G11 Unit 3), so there is no cross-feature exception to flag.

## Frontend: web root (`App.tsx`, `main.tsx`)

Superseded on 2026-09-30 by `docs/standards/frontend-architecture.md` for new code. Until ticket 16, this checklist applies only to the legacy tree that the new standard names in "Status and scope".

- [ ] Composes features through their `index.ts` barrel only — no reach-in past a feature's public entry point.
- [ ] Zero `createContext`/`useContext` usage anywhere in `src/web`, except the files `frontend-architecture.md` (Providers) names. Plain props over Context is the standing decision (`docs/standards/frontend-design-system.md`). One dated exception: `src/web/components/AppState.tsx` (R-15, transitional, ticket 16 removes it).

## Frontend module: route (`src/web/routes/`)

- [ ] The file renders exactly one view, or one shared layout component that gets module views as children. The root route `__root.tsx` is exempt from this section (`docs/standards/frontend-architecture.md`, Layer definitions, Route).
- [ ] The file has no business logic, no JSX layout and no data transform.
- [ ] Search params go through `validateSearch` with a zod schema.
- [ ] The loader calls `queryOptions` from a module barrel or from `src/web/queries/`, never from a file in a layer folder.

## Frontend module: view (`modules/<feature>/views/`)

- [ ] The view composes containers and layout. It calls no query hook (`docs/standards/frontend-architecture.md`, Layer definitions, View).
- [ ] The file name ends in `View`, and no file outside `views/` ends in `View`.

## Frontend module: container (`modules/<feature>/containers/`)

- [ ] Data comes only through the module's query hooks or a shared query in `src/web/queries/` (`docs/standards/frontend-architecture.md`, Layer definitions, Container).
- [ ] Mutations, selection state and editing state live here. The container gives plain props to its child components.
- [ ] The container renders components and `components/ui` primitives. It renders no host element that has a `className`.
- [ ] The file name ends in `Container`, and no file outside `containers/` ends in `Container`.

## Frontend module: component (`modules/<feature>/components/`)

- [ ] The component takes props and returns JSX. It imports no TanStack Query, TanStack Router or HTTP client. It does not call `fetch` (`docs/standards/frontend-architecture.md`, Layer definitions, Component).
- [ ] The component composes `components/ui` primitives, or it is in an allowed custom family folder. It uses no JSX `style` prop outside a `components/dnd/` folder and no colour value.

## Frontend module: hook (`modules/<feature>/hooks/`)

- [ ] The hook holds reusable logic that is not a query. It does not import TanStack Query. A wrapper of `useQuery` or `useMutation` goes in a `queries/` folder (`docs/standards/frontend-architecture.md`, Layer definitions, Hook).
- [ ] The file name is kebab-case, for example `use-drag-reorder.ts`.

## Frontend module: domain (`modules/<feature>/domain/`)

- [ ] The file holds pure functions, constants and types. It imports no React, TanStack Query, TanStack Router or HTTP client. It uses no `fetch`, `window`, `document`, `localStorage` or `EventSource` (`docs/standards/frontend-architecture.md`, Layer definitions, Domain utility).
- [ ] Each non-test domain file has a colocated `<subject>.test.ts` file.

## Frontend module: query (`modules/<feature>/queries/`)

- [ ] The folder holds the key factory, `queryOptions`, the query and mutation wrappers, and the fetch or SSE glue (`docs/standards/frontend-architecture.md`, Layer definitions, Query).
- [ ] Only query files, in a module `queries/` folder or in `src/web/queries/`, import `src/web/lib/http.ts`.
- [ ] The wrapper returns a 400, 409 or 502 response with the body `{ "error": "<code>" }` as typed data. It does not throw it.
- [ ] The file renders no JSX.
- [ ] The `useMutation` wrapper owns optimistic updates and rollback.
- [ ] Each `*-queries.ts` file has a colocated `<subject>.test.ts` file that also covers the `*-api.ts` glue.

## Frontend modules, every layer folder

- [ ] No file imports a sibling module or the legacy tree (`docs/standards/frontend-architecture.md`, Import matrix, Global bans).
- [ ] The module `index.ts` exports only views and `queryOptions` factories.

## Frontend shared: `src/web/components/ui/`

- [ ] A primitive file came from `npx shadcn@latest add`. A change is a `cva` variant in the same file, or an edit that "Primitive conventions" names (`docs/standards/frontend-architecture.md`, The only-shadcn rule).
- [ ] The file has no `ring-*` class. Focus uses the outline classes.

## Frontend shared: `src/web/components/`

- [ ] The file serves two or more modules, or it is the layout where a route composes two modules. It can also be in `icons/`, `markdown/`, `AppState.tsx` or `ThemeProvider.tsx` (`docs/standards/frontend-architecture.md`, Shared tiers, Shared components).
- [ ] The file imports no file of a module.

## Frontend shared: `src/web/queries/`

- [ ] Two or more modules read this data. Data that one module reads stays in that module. Files follow the `<name>-api.ts` and `<name>-queries.ts` pattern, and each `*-queries.ts` file has a colocated test (`docs/standards/frontend-architecture.md`, Shared tiers, Shared queries).

## Frontend shared: `src/web/lib/`

- [ ] A new file is `http.ts`, `query-client.ts` or `utils.ts`. It imports no module or component and holds no React state. Legacy helpers keep their legacy rules (`docs/standards/frontend-architecture.md`, Shared tiers, Configured clients).

## Frontend shared: `src/web/styles/`

- [ ] A colour value appears only in `tokens.css`. `globals.css` maps names to tokens through `var()` only (`docs/standards/frontend-architecture.md`, Shared tiers, Styles).

## Named exceptions (do NOT flag these)

Every exception below is a named, narrow allow-rule that survives the error-level flip — cross-checked to exist in the as-landed `eslint.config.ts`, never treated as debt to clear:

- **The 4-file `node:child_process` allow-list.** Only `adapters/exec.ts` (the chokepoint itself), `adapters/ttyd.ts`, `adapters/cloudflared.ts`, and `bootstrap/cli.ts` may import `node:child_process` directly — the AUDIT-01 ruling (`ttyd.ts`, `cli.ts`) plus the Phase-74 `cloudflared.ts` extension (`docs/standards/architecture.md` exec-chokepoint rulings). Any other file importing it directly is a real violation, not a review judgment call.
- **The image-proxy `adapters-config-consumer` carve-out.** `adapters/image-proxy.ts` is a named file-mode element (`adapters-config-consumer`) allowed to import `services` — the one adapter that reads orchestration config directly from `services/infra/config-holder.ts` instead of receiving it as an injected parameter. Never widen `adapters -> services` generally from this precedent.
- **The one shell surface, `SHELL-01`.** The ticket tmux session runs a login shell and the claude launch line is typed into it with `adapters/tmux.ts#sendLiteral` (`send-keys -l`) after `services/domain/claude-launch.ts#shellQuote` single-quotes every token. The argv chokepoint still holds (tmux itself is spawned argv-only); the typed line is the only text a shell parses, its tokens are server-derived, and `docs/ARCHITECTURE.md#tmux-invocations` records the boundary and its measured limits. Do not flag `sendLiteral` or `shellQuote` as a rule-2 violation, and do not add a second typed surface without extending that section. The `/cards/:id/run-claude` route awaits its service call (a few tmux round trips) because the 409 is the only feedback a refused relaunch has; that await is the named exception to the fire-and-forget rule. `POST /cards/:id/unwind` and `DELETE /archive/:id` (LOCAL-17) await their services for the same reason: archive rows never ride the SSE snapshot, so the response body is the only channel that can carry the archive summary, the restore blocker, or the recorded delete reason to the client. `GET /workspaces` (LOCAL-53) awaits `buildInventory` for the same reason: the inventory never rides the SSE snapshot, and its `du` and `git log` probes are async, bounded and cached, so the wait delays only that response. `POST /ask` (LOCAL-51) awaits its headless `claude -p` run for the same reason: the answer never rides the SSE snapshot, and the run is single-flight, time-limited and abortable on disconnect.
- **Live provider checks on the connection routes.** `GET /api/sources/:source/connection`, `PUT /api/sources/:source/key` (LOCAL-32) and `POST /api/sources/:source/connect` (LOCAL-45) await one provider round trip, as `POST /api/setup` does: the response body is the only channel for connected, rejected or unreachable, and nothing is written when the check fails. The pull request routes (LOCAL-45) `GET /api/github/pr/:owner/:repo/:number`, `POST .../review` and `POST .../merge` await GitHub for the same reason: the body is the only channel for the detail, a refused review or a refused merge. The Sentry issue routes (LOCAL-46) `GET /api/sentry/issue/:id` and `POST /api/sentry/issue/:id/resolve` await Sentry for the same reason, and the resolve route marks the item done only after Sentry answers success. The Slack setup routes (LOCAL-27) `GET /api/slack/channels` (up to 5 Slack calls, one per page) and `POST /api/slack/channels/resolve` (one call) await Slack because the body is the only channel for the channel list or the resolved name, and `GET /api/slack/thread/:itemId` (LOCAL-29) awaits one `conversations.replies` call plus at most 20 `users.info` lookups because the body is the only channel for the thread (a 10 minute cache answers repeats without Slack). The calendar routes (LOCAL-50) are the same kind: `PUT /api/calendar/settings` waits for one test read (osascript or the iCal fetch, up to 30 s) when the result is enabled, and `POST /api/calendar/calendars` waits for one osascript calendar list (up to 30 s), because the response body is the only channel for the read's error code and nothing is written when the read fails. That await is a named exception to the fire-and-forget rule; do not add other provider calls to a request path without extending this entry.
- **The Linear write routes await Linear.** `POST /cards/:id/comment`, `POST /cards/:id/assign-me` and `POST /cards/:id/linear-state` await their `services/orchestration/linear-outbound.ts` call because the response is the only channel for the outcome the panel shows: the 400 for a state outside the card's team needs the cached workflow, and a 502 carries the fixed copy the card notice also records. Board moves still push fire-and-forget (`pushColumnChanges`). These routes also skip `groupedMemberError`: they write only the ticket's Linear-side fields (a comment, the assignee, the Linear state) and never its column, session or workspace, which is what the grouped-member guard protects.
- **Held-open draft generation routes.** `POST /api/cards/draft` and `POST /api/cards/draft-many` (LOCAL-30) keep the request open for the headless `claude -p` run (up to 150 s) because the response body is the only channel that carries the drafts back to the modal. Each route has its own single-flight flag and aborts the run on `res.on("close")`. That wait is a named exception to the fire-and-forget rule.
- **Granola settings and check routes.** `PUT /api/meetings/granola` (LOCAL-31) waits for the settings apply, which can wait up to 5 s for an aborted claude child to exit, so the status it answers is true; `POST /api/meetings/granola/check` waits for one `claude mcp list` (up to 60 s) because the response body is the only channel for the check result. Both are named exceptions to the fire-and-forget rule.
- **The `watcher -> ttyd -> store` edge.** Both `watcher` and `ttyd` classify as the general `adapters` element; `adapters -> store` is an already-allowed edge. This is a documented architecture invariant (`docs/ARCHITECTURE.md#preserved-import-edges`), not an unenforced gap — no allow-rule was needed to encode it, and none should be added.
- **Exception R-05: the two lib barrels.** `src/web/lib/api.ts` and `src/web/lib/push.ts` re-export query files. One allow rule in `eslint.config.ts` allows only these two files to import a query file or a shared query file. No other lib file may import a query file. The rule starts on 2026-09-30. Ticket 16 removes both barrels and this rule. Do not flag these two imports.
- **Exception R-14: router transitional imports.** Route files under `src/web/routes/` may import the legacy tree, to render legacy pages, and `__root.tsx` may import `src/web/styles/*`. `src/web/components/AppState.tsx` may type-import the legacy pages, and the `@/modules/settings` and `@/modules/connections` barrels for the settings page props. Route file names under `src/web/routes/` are exempt from the filename case rule. No other file gets these allows: a module file still may not import the legacy tree. The rules start on 2026-09-30. Ticket 16 removes them. Do not flag these imports.

## Comments (all layers)

- [ ] JSDoc-only form, WHY not WHAT, zero body/inline comments, no TODOs in code — the full nine-rule standard lives at `docs/standards/comments.md`; this doc does not restate it.
