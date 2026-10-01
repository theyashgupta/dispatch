# Backend System Design

The backend is already close to correct: the de-facto layering is **routes (validate + fire-and-forget) → services (saga) → adapters (subprocess/external I/O) → store (single-writer)**. This standard names and locks that structure rather than restructuring it, so future changes cannot drift out of the shape that already makes the system reconcilable on restart.

## Layers and contracts

| Layer                        | Modules                                                                                                                                 | Contract                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport (routes)**       | `routes/index.ts`, `routes/cards.route.ts`, `routes/board.route.ts`, `routes/sse.route.ts`, `routes/loopback.ts`                        | Synchronous validation → 4xx before any async work; then delegate. Handlers stay thin. **Never** touch `exec`/`tmux`/`git` directly.                                                                                                                                                                                                      |
| **Services (orchestration)** | `services/orchestration/*` (sagas), `services/domain/*` (business rules and pure builders), `services/infra/*` (cross-cutting plumbing) | The start/cleanup saga plus rollback lives in `services/orchestration/*`, with the hook, token and source services. Pure builders (ask prompt, launch args, workspace paths, typed errors) live in `services/domain/*`. Plumbing (config, paths, preflight, vault, kickoff, playbooks) lives in `services/infra/*`. Steps are idempotent. |
| **Adapters**                 | `adapters/*` (tmux, ttyd, git, exec, claude-trust, marker parse/watcher, image-proxy), `adapters/poller` (Linear), `adapters/editors`   | All external I/O lives only here, and every subprocess call routes through the single argv-array `exec` chokepoint.                                                                                                                                                                                                                       |
| **State (store)**            | `store/board.store.ts` (+ `store/mapping.ts`, `store/items.ts`)                                                                         | The single writer of board state, cards and items alike: a mutation queue is the only path that changes `board.db` (the `cards`, `meta`, `events` and `items` tables) or the in-memory snapshot. `store/board-repository.ts` declares `BoardRepository` in front of the store. See rule 1 below.                                          |
| **SSE**                      | `routes/sse.route.ts` + store subscription                                                                                              | Store changes broadcast to a `Set` of clients. Producers never write to sockets directly — they mutate the store, which broadcasts.                                                                                                                                                                                                       |

## The four layering rules

1. **Store is the sole writer of board state.** Nothing outside `store/` mutates `board.json` or the in-memory snapshot; every mutation is enqueued on the store's single-writer mutation queue (the conditional-inside-the-queue pattern, e.g. set-ttyd-port-if-session-still-live, is the canonical example). This invariant is documented at `docs/ARCHITECTURE.md#single-writer-store` and referenced from JSDoc. This is the **single-writer** rule. `store/board-repository.ts` declares `BoardRepository` in front of the store. The store stays the single writer. For the rationale, see the reversal record in the "Repository pattern" section of `docs/standards/architecture.md`.

2. **All subprocess execution goes through the exec chokepoint.** Every `tmux`/`ttyd`/`git`/`claude` call routes through the single argv-array `exec` adapter (no shell, no string interpolation) — the security chokepoint that prevents shell injection. No layer spawns a subprocess any other way. The one text a shell parses is the claude launch line typed into the ticket's login shell, every token single-quoted by `shellQuote` (`SHELL-01`, see `docs/standards/code-review-rules.md` named exceptions).

3. **Producers form a DAG, they only call store mutations.** The marker watcher, the Linear poller, the Granola round (`services/orchestration/granola-round.ts`, an hourly timer that writes items and its cursor), the saga, and `services/orchestration/hook-events.ts` are "producers": they only ever call store mutations; they never call routes or SSE (grep-verified, every exported handler in `hook-events.ts` ends in a store mutation such as `applyMarker`/`flipBack`/`setClaudeSessionId`/`markHookRouted`/`setOutputChanged`). This makes the data flow a directed acyclic graph and is exactly what makes the system reconcilable on restart. The update-checker (`services/orchestration/update.ts`'s `startUpdateCheckLoop`) is producer-SHAPED, not a producer: it self-reschedules on a timer like the poller, but writes a local cache file rather than calling any store mutation, it sits outside the DAG by design. This is the **producer DAG** rule.

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
  - Never: call `exec`, tmux or git in a route file. Route files call the board store only through `boardRepository` from `store/board-repository.ts`. The one exception is the `ITEM_*_MAX` constants from `store/items.ts`.
- **Handler.** The function that a route calls with typed input.
  - Use it when: typed input must become one service call and one response. The inline route callback is the handler. It moves to `routes/<resource>.handlers.ts` when the route file is longer than 300 lines.
  - Never: put business logic in a handler.
- **Service.** A file in `services/orchestration/`, `services/domain/` or `services/infra/`.
  - Use it when: code runs a multi-step flow (orchestration), applies a business rule (domain) or gives shared plumbing such as paths and config (infra). An orchestration service can await adapters and the store.
  - Never: read `req` or `res` in a service.
- **Repository.** The store behind an interface, `BoardRepository` (ticket 18).
  - Use it when: code reads or writes board state. `board.store.ts` stays the single writer. Services and routes import `boardRepository` from `store/board-repository.ts`; `bootstrap/index.ts` sets it with `setBoardRepository(store)`. Existing files import it as `store` (`import { boardRepository as store }`).
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
8. Each route file that throws a typed error ends with `<name>Router.use(httpErrorHandler)`. The app-level mount stays as the backstop. A test that mounts one router then gets the same error responses as the app.
9. Put the schemas of a route file in `routes/<resource>-schemas.ts` when the file has more than three schemas. Put a `<resource>-schemas.test.ts` file next to it.

On 2026-09-30, ticket 17 converted all route files to this model. One site stays hand-written: the text/plain `Not found` 404 in `routes/viewer-page.route.ts`, because the error handler writes JSON only. The 403 and the one `typeof req.query.code` check in `routes/remote-auth-gate.ts` are middleware, not a route, and stay as they are. The six empty-body errors in `routes/terminal-proxy.route.ts` use a local handler that writes the status with no body.

## Import direction inside services

- A file in `services/domain/` imports `src/shared/` only.
- A file in `services/infra/` imports `src/shared/`, the store and adapters.
- A file in `services/orchestration/` imports `src/shared/`, the store, adapters, `services/domain/` and `services/infra/`.
- A route imports `services/orchestration/`, `services/domain/` and `services/infra/`.

On 2026-09-30, ticket 18 moved 18 files: 15 did not obey this direction, and 3 moved with the files they depend on. The list of exceptions is now empty.

## Naming

- A service file has a kebab-case singular name, for example `playbook-generate.ts`.
- A route file has a plural resource name, for example `playbooks.route.ts`.
- Put a test file next to its subject and name it `<subject>.test.ts`. Name a route test `<resource>-route.test.ts`.

## Tests

1. Use `node:test`. Put each test file next to its subject. Name the file `<name>.test.ts`.
2. Name a route error test `<resource>-errors-route.test.ts`.
3. Keep a domain test pure. A domain test does not use the store, an adapter, the file system or the network.
4. In a new orchestration test, replace the store with `fakeBoardRepository` from `src/server/test-support/fake-board-repository.ts`. An existing orchestration test can use the real store.
5. Install the fake with `setBoardRepository` from `src/server/store/board-repository.ts`. After each test, install the real store again. `t.mock.method` works on the real `store`, not on `boardRepository`.
6. In an orchestration test, replace each adapter with a fake from `src/server/test-support/`.
7. When an orchestration test is about store behavior, use the real SQLite store under `isolateEnv()`. Do not install the fake in that test.
8. Test a route through a real Express app on port 0 with `isolateEnv()`. Mount `httpErrorHandler` after the router, as the app does.
9. A route test can use `fakeBoardRepository`. Exception: `routes/sse.route.ts` calls `boardRepository.on` when the module loads. A test that needs SSE broadcasts must use the real store.
10. Test the store with the real SQLite store under `isolateEnv()`.
11. Before you convert a route, write a characterization test that pins the status and the exact body of each status path. Keep its assertions unchanged through the conversion.
12. Replace only external binaries with stubs, for example a `claude` stub on the isolated `PATH`. Do not mock the route or its service.

### Test files by layer

On 2026-09-30, this list has 184 server test files. Each path is relative to `src/server/`. The folder of a file sets its layer. The mark "(crosses layers)" shows a test that breaks a rule above. For example, the test runs a real `git` binary, or a domain test runs a subprocess. A follow-up ticket changes these tests.

#### store (13)

- `store/archive-store.test.ts`
- `store/board-db.test.ts`
- `store/board-repository.test.ts`
- `store/board-store-comments.test.ts`
- `store/board-store-cursors.test.ts`
- `store/board-store-items.test.ts`
- `store/board-store-push.test.ts`
- `store/board-store-sources.test.ts`
- `store/board-store-tracked.test.ts`
- `store/board-store.test.ts`
- `store/claude-sessions.test.ts`
- `store/items.test.ts`
- `store/mapping.test.ts`

#### adapter (17)

- `adapters/calendar-mac.test.ts`
- `adapters/calendar-poll.test.ts`
- `adapters/claude-cli.test.ts`
- `adapters/claude-login.test.ts`
- `adapters/claude-trust.test.ts`
- `adapters/claude-usage.test.ts`
- `adapters/disk-usage.test.ts`
- `adapters/exec.test.ts`
- `adapters/git-last-commit.test.ts`
- `adapters/poller-cursors.test.ts`
- `adapters/poller-github.test.ts`
- `adapters/poller.test.ts`
- `adapters/source-gateway-key.test.ts`
- `adapters/source-gateway.test.ts`
- `adapters/tmux-env.test.ts`
- `adapters/tmux-pane-border.test.ts`
- `adapters/ttyd-fingerprint.test.ts`

#### domain (4)

- `services/domain/ask-context.test.ts`
- `services/domain/ask-prompt.test.ts`
- `services/domain/claude-launch.test.ts` (crosses layers)
- `services/domain/workspace-inventory.test.ts`

#### infra (11)

- `services/infra/attachments.test.ts`
- `services/infra/config-holder-linear-key.test.ts`
- `services/infra/config-holder-source-enabled.test.ts`
- `services/infra/config-holder.test.ts`
- `services/infra/config-linear-fields.test.ts`
- `services/infra/kickoff-slack.test.ts`
- `services/infra/kickoff.test.ts`
- `services/infra/sentry-token.test.ts`
- `services/infra/slack-token.test.ts`
- `services/infra/ttl-cache.test.ts`
- `services/infra/vault-clear.test.ts`

#### orchestration (27)

- `services/orchestration/archive-delete.test.ts` (crosses layers)
- `services/orchestration/claude-accounts.test.ts`
- `services/orchestration/claude-login.test.ts`
- `services/orchestration/cleanup-scheduler.test.ts` (crosses layers)
- `services/orchestration/cleanup.test.ts` (crosses layers)
- `services/orchestration/create-worktrees.test.ts` (crosses layers)
- `services/orchestration/github-token.test.ts`
- `services/orchestration/granola-actions.test.ts`
- `services/orchestration/granola-round.test.ts`
- `services/orchestration/hook-events.test.ts`
- `services/orchestration/linear-move-state.test.ts`
- `services/orchestration/linear-outbound.test.ts`
- `services/orchestration/linear-push.test.ts`
- `services/orchestration/linear-sync-claude.test.ts`
- `services/orchestration/linear-sync-direct.test.ts`
- `services/orchestration/meeting-actions.test.ts`
- `services/orchestration/outbound-error.test.ts`
- `services/orchestration/reset.test.ts` (crosses layers)
- `services/orchestration/resume-session.test.ts` (crosses layers)
- `services/orchestration/run-claude.test.ts` (crosses layers)
- `services/orchestration/start-push.test.ts`
- `services/orchestration/steps.test.ts` (crosses layers)
- `services/orchestration/terminal.test.ts` (crosses layers)
- `services/orchestration/ticket-generate.test.ts`
- `services/orchestration/token-connection-slack.test.ts`
- `services/orchestration/unwind.test.ts`
- `services/orchestration/workspaces.test.ts` (crosses layers)

#### route (77)

- `routes/accounts-errors-route.test.ts`
- `routes/accounts-route.test.ts`
- `routes/accounts-schemas.test.ts`
- `routes/archive-errors-route.test.ts` (crosses layers)
- `routes/archive-route.test.ts` (crosses layers)
- `routes/ask-errors-route.test.ts`
- `routes/ask-route.test.ts`
- `routes/board-claude-args.test.ts`
- `routes/board-errors-route.test.ts`
- `routes/board-route.test.ts`
- `routes/board-schemas.test.ts`
- `routes/calendar-errors-route.test.ts`
- `routes/calendar-route.test.ts`
- `routes/cards-assign-route.test.ts`
- `routes/cards-attachments.test.ts`
- `routes/cards-cleanup-route.test.ts` (crosses layers)
- `routes/cards-comment-route.test.ts`
- `routes/cards-comments-route.test.ts`
- `routes/cards-draft.test.ts`
- `routes/cards-errors-route.test.ts`
- `routes/cards-linear-state-route.test.ts`
- `routes/cards-move-push.test.ts`
- `routes/cards-run-claude-errors-route.test.ts`
- `routes/cards-run-claude.test.ts`
- `routes/cards-schemas.test.ts`
- `routes/cards-sync-route.test.ts`
- `routes/connection-errors-route.test.ts`
- `routes/connection-route.test.ts`
- `routes/connection-sentry-route.test.ts`
- `routes/connection-slack-route.test.ts`
- `routes/connection-sources-route.test.ts`
- `routes/events-errors-route.test.ts`
- `routes/github-errors-route.test.ts`
- `routes/github-route.test.ts`
- `routes/github-schemas.test.ts`
- `routes/granola-round-timers.test.ts`
- `routes/hooks-errors-route.test.ts`
- `routes/hooks-route.test.ts`
- `routes/images-errors-route.test.ts`
- `routes/items-errors-route.test.ts`
- `routes/items-promote-context.test.ts`
- `routes/items-promote-slack.test.ts`
- `routes/items-route.test.ts`
- `routes/items-schemas.test.ts`
- `routes/linear-errors-route.test.ts`
- `routes/linear-route.test.ts`
- `routes/linear-state-map-route.test.ts`
- `routes/meetings-errors-route.test.ts`
- `routes/meetings-route.test.ts`
- `routes/meetings-schemas.test.ts`
- `routes/or-fail.test.ts`
- `routes/playbooks-schemas.test.ts`
- `routes/profile-errors-route.test.ts`
- `routes/profile-route.test.ts`
- `routes/push-errors-route.test.ts`
- `routes/push-schemas.test.ts`
- `routes/remote-errors-route.test.ts`
- `routes/route-error-mount.test.ts`
- `routes/schema-primitives.test.ts`
- `routes/sentry-errors-route.test.ts`
- `routes/sentry-route.test.ts`
- `routes/setup-errors-route.test.ts`
- `routes/setup-onboarding-route.test.ts`
- `routes/setup-route.test.ts`
- `routes/slack-errors-route.test.ts`
- `routes/slack-route.test.ts`
- `routes/slack-thread-route.test.ts`
- `routes/sse-profile.test.ts`
- `routes/terminal-proxy-errors-route.test.ts`
- `routes/update-errors-route.test.ts`
- `routes/vault-errors-route.test.ts`
- `routes/vault-route.test.ts`
- `routes/vault-schemas.test.ts`
- `routes/viewer-errors-route.test.ts`
- `routes/viewer-page-errors-route.test.ts`
- `routes/workspaces-errors-route.test.ts`
- `routes/workspaces-route.test.ts`

#### bootstrap (7)

- `bootstrap/config-github.test.ts`
- `bootstrap/config-onboarding.test.ts`
- `bootstrap/config-profile.test.ts`
- `bootstrap/config-slack.test.ts`
- `bootstrap/config-state-map.test.ts`
- `bootstrap/config-sync-flag.test.ts`
- `bootstrap/config.test.ts`

#### sources (27)

- `sources/calendar/calendar-events.test.ts`
- `sources/calendar/calendar-source.test.ts`
- `sources/calendar/ics.test.ts`
- `sources/github/github-pr.test.ts`
- `sources/github/github-search.test.ts`
- `sources/github/github-source.test.ts`
- `sources/linear/linear-create.test.ts`
- `sources/linear/linear-source-fields.test.ts`
- `sources/linear/linear-tracked.test.ts`
- `sources/linear/linear-viewer.test.ts`
- `sources/linear/linear-workflow.test.ts`
- `sources/registry-github.test.ts`
- `sources/registry-sentry.test.ts`
- `sources/registry-slack.test.ts`
- `sources/registry.test.ts`
- `sources/sentry/sentry-issue.test.ts`
- `sources/sentry/sentry-source.test.ts`
- `sources/slack/channel-ref.test.ts`
- `sources/slack/slack-api.test.ts`
- `sources/slack/slack-classify.test.ts`
- `sources/slack/slack-permalink.test.ts`
- `sources/slack/slack-readonly.test.ts`
- `sources/slack/slack-source.test.ts`
- `sources/slack/slack-targets.test.ts`
- `sources/slack/slack-text.test.ts`
- `sources/slack/slack-thread-cache.test.ts`
- `sources/slack/slack-thread.test.ts`

#### test-support (1)

- `test-support/fake-board-repository.test.ts`

## Agent rules block (backend)

1. Parse each route input with a zod schema in the route file.
2. Throw a typed error from `services/domain/errors.ts`. Do not call `res.status` with a 4xx or 5xx code.
3. Keep routes free of `exec`, tmux and git calls. A new route file calls `boardRepository`, not `board.store.ts`.
4. Keep business logic in services, not in routes or handlers.
5. Do not read `req` or `res` in a service.
6. Write board state only through the store.
7. Spawn a subprocess only through `adapters/exec.ts` or a named exception in `code-review-rules.md`.
8. Put a `node:test` file next to each new route, service and domain file.
9. A file imports only from its own folder and from folders earlier in this list: `src/shared/`, `store/` and `sources/`, `adapters/`, `services/infra/`, `services/orchestration/`, `routes/`. `store/` and `sources/` do not import each other, and among these folders only `adapters/` imports `sources/`. A file in `services/domain/` imports `src/shared/` only; orchestration files and routes can import it. The one exception is `adapters/image-proxy.ts`, which imports `services/infra/config-holder.ts`.
10. Use `bootstrap/` as the composition root. It can import every folder. Only `bootstrap/index.ts` calls `setBoardRepository(store)` in source code. A test can call `setBoardRepository` to install `fakeBoardRepository`.
