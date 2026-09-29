# Backend System Design

The backend is already close to correct: the de-facto layering is **routes (validate + fire-and-forget) → services (saga) → adapters (subprocess/external I/O) → store (single-writer)**. This standard names and locks that structure rather than restructuring it, so future changes cannot drift out of the shape that already makes the system reconcilable on restart.

## Layers and contracts

| Layer                        | Modules                                                                                                                                 | Contract                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport (routes)**       | `routes/index.ts`, `routes/cards.route.ts`, `routes/board.route.ts`, `routes/sse.route.ts`, `routes/loopback.ts`                        | Synchronous validation → 4xx before any async work; then delegate. Handlers stay thin. **Never** touch `exec`/`tmux`/`git` directly.                                                                                                                                                                                                      |
| **Services (orchestration)** | `services/orchestration/*` (sagas), `services/domain/*` (business rules and pure builders), `services/infra/*` (cross-cutting plumbing) | The start/cleanup saga plus rollback lives in `services/orchestration/*`. Business rules and pure builders (kickoff assembly, workspace/playbook domain logic, hook policy/token state) live in `services/domain/*`. Cross-cutting plumbing (config holder, path constants, preflight) lives in `services/infra/*`. Steps are idempotent. |
| **Adapters**                 | `adapters/*` (tmux, ttyd, git, exec, claude-trust, marker parse/watcher, image-proxy), `adapters/poller` (Linear), `adapters/editors`   | All external I/O lives only here, and every subprocess call routes through the single argv-array `exec` chokepoint.                                                                                                                                                                                                                       |
| **State (store)**            | `store/board.store.ts` (+ `store/mapping.ts`, `store/items.ts`)                                                                         | The single writer of board state, cards and items alike: a mutation queue is the only path that changes `board.db` (the `cards`, `meta`, `events` and `items` tables) or the in-memory snapshot. `board.store.ts` plus `store/board-db.ts` ARE this codebase's Repository, see rule 1 below.                                              |
| **SSE**                      | `routes/sse.route.ts` + store subscription                                                                                              | Store changes broadcast to a `Set` of clients. Producers never write to sockets directly — they mutate the store, which broadcasts.                                                                                                                                                                                                       |

## The four layering rules

1. **Store is the sole writer of board state.** Nothing outside `store/` mutates `board.json` or the in-memory snapshot; every mutation is enqueued on the store's single-writer mutation queue (the conditional-inside-the-queue pattern, e.g. set-ttyd-port-if-session-still-live, is the canonical example). This invariant is documented at `docs/ARCHITECTURE.md#single-writer-store` and referenced from JSDoc. This is the **single-writer** rule. `store/board.store.ts` plus `store/board-db.ts` ARE this codebase's Repository — the pattern under a domain-specific name; the term is never to be reinvented as a wrapper class. See `docs/standards/architecture.md`'s "Repository pattern — rejected" section for the full rationale.

2. **All subprocess execution goes through the exec chokepoint.** Every `tmux`/`ttyd`/`git`/`claude` call routes through the single argv-array `exec` adapter (no shell, no string interpolation) — the security chokepoint that prevents shell injection. No layer spawns a subprocess any other way. The one text a shell parses is the claude launch line typed into the ticket's login shell, every token single-quoted by `shellQuote` (`SHELL-01`, see `docs/standards/code-review-rules.md` named exceptions).

3. **Producers form a DAG, they only call store mutations.** The marker watcher, the Linear poller, the Granola round (`services/orchestration/granola-round.ts`, an hourly timer that writes items and its cursor), the saga, and `services/domain/hook-events.ts` are "producers": they only ever call store mutations; they never call routes or SSE (grep-verified, every exported handler in `hook-events.ts` ends in a store mutation such as `applyMarker`/`flipBack`/`setClaudeSessionId`/`markHookRouted`/`setOutputChanged`). This makes the data flow a directed acyclic graph and is exactly what makes the system reconcilable on restart. The update-checker (`services/orchestration/update.ts`'s `startUpdateCheckLoop`) is producer-SHAPED, not a producer: it self-reschedules on a timer like the poller, but writes a local cache file rather than calling any store mutation, it sits outside the DAG by design. This is the **producer DAG** rule.

4. **Imports are unidirectional; routes are transport-only.** Import direction is `shared → (store, adapters) → services → routes`, wired by `bootstrap`. Routes validate → delegate → respond, and fire-and-forget anything slower than ~50ms (cold ttyd start, the saga), carrying state to the client over SSE. Routes never reach past `services`/`adapters` to call `exec`/`tmux`/`git` themselves. This is the **unidirectional imports** rule. The transport rule and the exec chokepoint are both now lint-enforced at `error` severity (`boundaries/dependencies` and `no-restricted-imports` on `node:child_process`, gating `npm run check`) — see `docs/standards/code-review-rules.md` for the review-time checklist.

## Where the store, watcher, and saga sit

- **Store** = the state layer; it owns atomicity via the single-writer queue.
- **Watcher** (`adapters/markers/watcher`) = an adapter-tier producer that samples panes and pushes store mutations.
- **Saga** (`services/orchestration/*`) = the services layer that composes adapters and store writes with rollback, implementing the **Saga pattern**: multi-step operations built from idempotent do steps with compensating undo/rollback steps. Start/resume/cleanup are sagas proper — each has a matching compensating undo/rollback step; terminal/uninstall/update/playbook-generate live in `services/orchestration/` because they compose adapters + store writes, not because they carry compensation.

None of them belong in `routes/`. This matches the current tree; the standard just forbids future drift — for example, a route calling `tmux` directly, or the watcher writing to a socket instead of the store.

## Standard v2 (2026-09-30)

The v2 rules below add to the sections above. The sections above stay in force. `docs/standards/frontend-architecture.md` is the frontend partner of this standard.

## Layer definitions

- **Route.** A file `src/server/routes/<resource>.route.ts`.
  - Use it when: a path needs an owner. The route declares the paths, parses `params`, `query` and `body` with zod and calls one handler.
  - Never: call `exec`, tmux or git in a route file, or call the store in a new route file. Ten current route files call the store, and ticket 18 moves those calls behind `BoardRepository`.
- **Handler.** The function that a route calls with typed input.
  - Use it when: typed input must become one service call and one response. The inline route callback is the handler. It moves to `routes/<resource>.handlers.ts` when the route file is longer than 300 lines.
  - Never: put business logic in a handler.
- **Service.** A file in `services/orchestration/`, `services/domain/` or `services/infra/`.
  - Use it when: code runs a multi-step flow (orchestration), applies a business rule (domain) or gives shared plumbing such as paths and config (infra). An orchestration service can await adapters and the store.
  - Never: read `req` or `res` in a service.
- **Repository.** The store behind an interface, `BoardRepository` (ticket 18).
  - Use it when: code reads or writes board state. `board.store.ts` stays the single writer. Until ticket 18 adds the interface, code calls `board.store.ts` directly.
  - Never: write board state outside the store.
- **Adapter.** A file in `src/server/adapters/`.
  - Use it when: code wraps one external I/O, such as gh, git, tmux, ttyd, cloudflared or a subprocess. An adapter returns typed results and throws typed errors.
  - Never: spawn a subprocess outside `adapters/exec.ts` and the four named exceptions in `code-review-rules.md`.
- **Domain.** `src/shared/types.ts` and the files in `services/domain/`.
  - Use it when: code is a type or a pure rule that the server and the web share, or a business rule.
  - Never: import an adapter, the store, `services/infra/` or `services/orchestration/` in a new domain file.

## Validation

1. Parse each `params`, `query` and `body` input with a zod schema in the route file.
2. Use the client error code as the schema message. For example, the name field of a playbook has the message `invalid-name`.
3. Put the schema fields in the order that sets error precedence. The first failing field gives the code. When you convert a route, use the order of its old hand checks.
4. Call `parseOrThrow` from `src/server/routes/parse-input.ts`. When the parse fails, it throws a `ValidationError` with the message of the first issue.
5. For a string length limit, use `.refine((s) => s.length <= max)`. The zod `.max()` check on a string counts code points, not the UTF-16 units that `.length` counts.

## Errors

1. `src/server/services/domain/errors.ts` defines `HttpError` (fields `status`, `code`, `details`) and five classes: `ValidationError` (400), `NotFoundError` (404), `ConflictError` (409), `UpstreamError` (502) and `InternalError` (500). For another status, throw `new HttpError(status, code, details)`. Add a named class only when a third route needs that status.
2. `src/server/routes/error-handler.ts` (`httpErrorHandler`) is the last middleware in `src/server/bootstrap/index.ts`. It writes the status and the body `{ "error": "<code>", ...details }`.
3. The `error` field is always the first key, and a `details` field never replaces it. The web client reads `body.error` as a string.
4. `details` carries the extra fields that an error response sends today, for any status.
5. The handler sends every other error to the next handler. Routes that answer errors by hand keep their old responses.
6. Throw a typed error outside any `try` block whose `catch` maps unexpected errors to `InternalError`.
7. A converted route does not call `res.status` with a 4xx or 5xx code.

## Import direction inside services

- A file in `services/domain/` imports `src/shared/` only.
- A file in `services/infra/` imports `src/shared/`, the store and adapters.
- A file in `services/orchestration/` imports `src/shared/`, the store, adapters, sources, `services/domain/` and `services/infra/`.
- A route imports `services/orchestration/`, `services/domain/` and `services/infra/`.

On 2026-09-30, the non-test service files had 191 imports that cross a folder. 28 import statements (27 file and target pairs) break this direction. All of them are in `services/domain/`. Ticket 18 moves them. Until then, the dependency check from ticket 4 reports each one as a warning.

- `domain/attachments.ts` imports `../infra/paths.js`
- `domain/claude-accounts.ts` imports `../../adapters/claude-cli.js`
- `domain/claude-accounts.ts` imports `../infra/paths.js`
- `domain/claude-accounts.ts` imports `../infra/config-holder.js`
- `domain/github-token.ts` imports `../../adapters/gh.js`
- `domain/github.ts` imports `../../adapters/source-gateway.js`
- `domain/github.ts` imports `../infra/config-holder.js`
- `domain/hook-events.ts` imports `../../adapters/markers/parse.js`
- `domain/hook-events.ts` imports `../../store/board.store.js`
- `domain/hook-events.ts` imports `../infra/config-holder.js`
- `domain/hook-tokens.ts` imports `../../store/board.store.js`
- `domain/kickoff.ts` imports `../infra/paths.js`
- `domain/meeting-actions.ts` imports `../../store/items.js`
- `domain/playbooks.ts` imports `../infra/paths.js`
- `domain/push-send.ts` imports `../infra/push-keys.js`
- `domain/push-send.ts` imports `../../store/board.store.js`
- `domain/push-send.ts` imports `../../store/board-db.js`
- `domain/sentry.ts` imports `../../adapters/source-gateway.js`
- `domain/sentry.ts` imports `../../store/board.store.js`
- `domain/sentry.ts` imports `../infra/config-holder.js`
- `domain/slack.ts` imports `../../adapters/source-gateway.js`
- `domain/slack.ts` imports `../../store/board.store.js`
- `domain/slack.ts` imports `../infra/config-holder.js`
- `domain/token-connection.ts` imports `../../adapters/source-gateway.js`
- `domain/token-connection.ts` imports `../infra/config-holder.js`
- `domain/vault.ts` imports `../infra/paths.js`
- `domain/workspaces.ts` imports `../../adapters/git.js`

## Naming

- A service file has a kebab-case singular name, for example `playbook-generate.ts`.
- A route file has a plural resource name, for example `playbooks.route.ts`.
- Put a test file next to its subject and name it `<subject>.test.ts`. Name a route test `<resource>-route.test.ts`.

## Tests

1. Use colocated `node:test` files.
2. Test a service with the fakes in `src/server/test-support/`.
3. Test a route through a real Express app on port 0 with `isolateEnv()`. Mount `httpErrorHandler` after the router, as the app does.
4. Before you convert a route, write a characterization test that pins the status and the exact body of each status path. Keep its assertions unchanged through the conversion.
5. Replace only external binaries with stubs, for example a `claude` stub on the isolated `PATH`. Do not mock the route or its service.

## Agent rules block (backend)

1. Parse each route input with a zod schema in the route file.
2. Throw a typed error from `services/domain/errors.ts`. Do not call `res.status` with a 4xx or 5xx code.
3. Keep routes free of `exec`, tmux and git calls. Do not call the store in a new route file.
4. Keep business logic in services, not in routes or handlers.
5. Do not read `req` or `res` in a service.
6. Write board state only through the store.
7. Spawn a subprocess only through `adapters/exec.ts` or a named exception in `code-review-rules.md`.
8. Keep new files in `services/domain/` free of adapter, store, infra and orchestration imports.
9. Put a `node:test` file next to each new route, service and domain file.
