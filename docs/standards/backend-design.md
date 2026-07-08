# Backend System Design

The backend is already close to correct: the de-facto layering is **routes (validate + fire-and-forget) → services (saga) → adapters (subprocess/external I/O) → store (single-writer)**. This standard names and locks that structure rather than restructuring it, so future changes cannot drift out of the shape that already makes the system reconcilable on restart.

## Layers and contracts

| Layer                        | Modules                                                                                                                  | Contract                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Transport (routes)**       | `routes/routes.ts`, `routes/sse.ts`, `routes/loopback.ts`                                                                | Synchronous validation → 4xx before any async work; then delegate. Handlers stay thin. **Never** touch `exec`/`tmux`/`git` directly. |
| **Services (orchestration)** | `services/*`                                                                                                             | The start/cleanup saga plus rollback. Owns business rules (Done-card parking, start-in-flight guards). Steps are idempotent.         |
| **Adapters**                 | `adapters/*` (tmux, ttyd, git, exec, claude-trust, marker parse/watcher), `adapters/poller` (Linear), `adapters/editors` | All external I/O lives only here, and every subprocess call routes through the single argv-array `exec` chokepoint.                  |
| **State (store)**            | `store/boardStore.ts` (+ `store/mapping.ts`)                                                                             | The single writer of board state: a mutation queue is the only path that changes `board.json` or the in-memory snapshot.             |
| **SSE**                      | `routes/sse.ts` + store subscription                                                                                     | Store changes broadcast to a `Set` of clients. Producers never write to sockets directly — they mutate the store, which broadcasts.  |

## The four layering rules

1. **Store is the sole writer of board state.** Nothing outside `store/` mutates `board.json` or the in-memory snapshot; every mutation is enqueued on the store's single-writer mutation queue (the conditional-inside-the-queue pattern, e.g. set-ttyd-port-if-session-still-live, is the canonical example). This invariant is documented at `docs/ARCHITECTURE.md#single-writer-store` and referenced from JSDoc. This is the **single-writer** rule.

2. **All subprocess execution goes through the exec chokepoint.** Every `tmux`/`ttyd`/`git`/`claude` call routes through the single argv-array `exec` adapter (no shell, no string interpolation) — the security chokepoint that prevents shell injection. No layer spawns a subprocess any other way.

3. **Producers form a DAG — they only call store mutations.** The marker watcher, the Linear poller, and the saga are "producers": they only ever call store mutations; they never call routes or SSE. This makes the data flow a directed acyclic graph and is exactly what makes the system reconcilable on restart. This is the **producer DAG** rule.

4. **Imports are unidirectional; routes are transport-only.** Import direction is `shared → (store, adapters) → services → routes`, wired by `bootstrap`. Routes validate → delegate → respond, and fire-and-forget anything slower than ~50ms (cold ttyd start, the saga), carrying state to the client over SSE. Routes never reach past `services`/`adapters` to call `exec`/`tmux`/`git` themselves. This is the **unidirectional imports** rule.

## Where the store, watcher, and saga sit

- **Store** = the state layer; it owns atomicity via the single-writer queue.
- **Watcher** (`adapters/markers/watcher`) = an adapter-tier producer that samples panes and pushes store mutations.
- **Saga** (`services/*`) = the services layer that composes adapters and store writes with rollback.

None of them belong in `routes/`. This matches the current tree; the standard just forbids future drift — for example, a route calling `tmux` directly, or the watcher writing to a socket instead of the store.
