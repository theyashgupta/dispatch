# Code Review Rules (per layer)

The review-agent standard: a per-layer checklist for anything checking a diff against Dispatch's architecture, extracted from the already-ratified standards (`backend-design.md`, `folder-structure.md`, `frontend-design-system.md`, `comments.md`) and the as-landed `eslint.config.ts`. Every line below is an objectively checkable assertion, not a restatement of rationale — see the linked doc for the WHY.

## The three enforcement layers

1. **ESLint at error (`npm run check`).** Import-direction boundaries (`boundaries/dependencies`) and the exec-chokepoint ban (`no-restricted-imports` on `node:child_process`) are machine-enforced at `error` severity across `src/**`. A violating diff fails the build before it reaches review.
2. **Local `PreToolUse` pointer hooks.** A gitignored, local-only `.claude/settings.json` + `.claude/hooks/pretooluse-rules.mjs` inject a per-layer `docs/standards/*.md` pointer on every `Edit`/`Write`, so the rule surfaces at edit time instead of only at review time. This requires Claude Code CLI `>=2.1.9` for `PreToolUse` `additionalContext` support (installed CLI verified `2.1.214`) — this sentence is the durable, committed record of that floor; the hook script itself is gitignored and is not the record.
3. **This review doc.** Checks what lint structurally cannot: intent, business-rule placement, side-effect discipline, and the shape of a change rather than its import graph.

Scope: this doc exists for what layer 1 cannot express — a route file with zero disallowed imports can still validate asynchronously, or a domain file can still smuggle in a subprocess call through an already-allowed adapter. Layers 1 and 2 catch import-direction and chokepoint violations mechanically; this layer catches everything else.

## Backend: `routes/`

- [ ] Validates synchronously and returns 4xx before any async work begins; handlers stay thin (`docs/standards/backend-design.md` — Transport contract).
- [ ] Never imports `adapters/{exec,git,tmux}.ts` directly — subprocess calls go through `services`/`adapters` only (lint-enforced at error; this is the intent check behind that rule).
- [ ] Fire-and-forgets anything slower than ~50ms (cold ttyd start, the saga) and carries state to the client over SSE rather than blocking the response.

## Backend: `services/orchestration/`

- [ ] Composes adapters + store writes; steps are idempotent (`docs/standards/backend-design.md` rule on producer/orchestration shape).
- [ ] Where a flow has genuine compensation (a do step with a matching undo/rollback), it is a saga proper: `start-session.ts`, `resume-session.ts`, `cleanup.ts`. Flows without compensation (`terminal.ts`, `uninstall.ts`, `update.ts`, `playbook-generate.ts`) still belong here because they compose adapters + store, not because they carry rollback — do not claim "saga" for these in new documentation or comments.
- [ ] No new second write path to `board.json` or the in-memory snapshot — every mutation still goes through the store's single-writer queue.

## Backend: `services/domain/`

- [ ] Pure business rules and builders only: no subprocess execution, no direct store mutation beyond the documented producer calls (`hook-events.ts` is the one producer-shaped domain file — every exported handler ends in a store mutation).
- [ ] No new file in this tier reaches into `adapters-subprocess` (`exec`/`git`/`tmux`) — that stays an `orchestration`/`adapters` concern.

## Backend: `services/infra/`

- [ ] Cross-cutting plumbing only (config holder, path constants, preflight) — no business rules, no saga steps.
- [ ] Any subprocess call (e.g. a preflight binary check) routes through `adapters/exec.ts`'s `run()` or `runInherit()`, never a local `spawn`/`execFile` invocation.

## Backend: `adapters/`

- [ ] All subprocess execution routes through the single argv-array `adapters/exec.ts` chokepoint's `run()` (capture-and-await) or `runInherit()` (stdio-inherit foreground streaming) — no shell, no string interpolation, no new third spawn shape.
- [ ] No new `node:child_process` import outside the four ruled carve-out files (the exec chokepoint plus its three AUDIT-01 exceptions — see Named Exceptions below); lint-enforced at error, this checklist line is the intent check behind it.
- [ ] External I/O (Linear poller, image-proxy, editors) stays isolated to this tier — no `services/` or `routes/` file performs external I/O directly.

## Backend: `store/`

- [ ] Every mutation goes through `board.store.ts`'s single-writer mutation queue — no new file introduces a second write path to `board.json` or the in-memory snapshot.
- [ ] Column-sensitive checks happen INSIDE the mutator, against live state (the `WR-04` invariant) — never read-then-write from outside the queue.
- [ ] `board.store.ts` is never split into multiple classes; helpers live alongside it (e.g. `store/mapping.ts`), not as a second writer.

## Backend: `sources/`

- [ ] Ticket-source provider seams (`linear.source.ts`, the source registry, per-source filters) stay isolated to this tier — no `routes/` or `services/` file talks to a ticket provider directly.

## Backend: `bootstrap/`

- [ ] Composition-root only: wiring, config holder, binary preflight, boot reconcile. No business logic lives here — if a bootstrap file grows business rules, that's a domain-layer extraction, not a bootstrap concern.
- [ ] The two named `bootstrap/` exec carve-outs (`ttyd-index-setup.ts`, `cli.ts`) keep their direct `node:child_process` import narrowly scoped to the ruled behavior (a throwaway boot-time ttyd probe; a detached fire-and-forget browser opener) — do not widen either beyond its ruled shape.

## Frontend: `primitives/`

- [ ] Props in, no data fetching: zero imports from `hooks/`, `lib/`, `feature`, or `web` (lint-enforced at error; this is the intent check — a primitive that reaches into `lib/` for formatting is the exact violation class the two named Phase-57 warn carve-outs track, see below).
- [ ] Purely presentational; a props type is declared immediately above the component (`docs/standards/frontend-design-system.md` anatomy checklist).

## Frontend: `hooks/`

- [ ] May import `lib/` (data hooks legitimately sit on `lib/api`), but never `feature` or `web` — import direction is `primitives -> hooks/lib -> features -> App`.
- [ ] Filename is `useX.ts` camelCase (`docs/standards/folder-structure.md` naming convention).

## Frontend: `lib/`

- [ ] Never imports React or `react-dom` (lint-enforced at error via `no-restricted-imports` scoped to `src/web/lib/**/*.ts`) — `lib` is the pure-helper floor of the tier.
- [ ] Never imports `primitives/`, `hooks/`, `feature`, or `web` — the asymmetric rule: `hooks` may import `lib`, `lib` never imports upward into `hooks`.

## Frontend: `features/`

- [ ] Cross-feature imports go through the target feature's `index.ts` barrel only — a deep import into a sibling feature's internals is a violation (lint-enforced at error).
- [ ] The `features/* -> badges` shared-leaf edge is the one sanctioned cross-feature exception: `badges/` is a shared leaf feature whose components import nothing of their own and may be imported by any feature.

## Frontend: web root (`App.tsx`, `main.tsx`)

- [ ] Composes features through their `index.ts` barrel only — no reach-in past a feature's public entry point.
- [ ] Zero `createContext`/`useContext` usage anywhere in `src/web` — plain props over Context is the standing decision (`docs/standards/frontend-design-system.md`).

## Named exceptions (do NOT flag these)

Every exception below is a named, narrow allow-rule that survives the error-level flip — cross-checked to exist in the as-landed `eslint.config.ts`, never treated as debt to clear:

- **The 4-file `node:child_process` allow-list.** Only `adapters/exec.ts` (the chokepoint itself), `adapters/ttyd.ts`, `bootstrap/ttyd-index-setup.ts`, and `bootstrap/cli.ts` may import `node:child_process` directly — the AUDIT-01 ruling verbatim (`docs/standards/architecture.md` exec-chokepoint rulings). Any other file importing it directly is a real violation, not a review judgment call.
- **The image-proxy `adapters-config-consumer` carve-out.** `adapters/image-proxy.ts` is a named file-mode element (`adapters-config-consumer`) allowed to import `services` — the one adapter that reads orchestration config directly from `services/infra/config-holder.ts` instead of receiving it as an injected parameter. Never widen `adapters -> services` generally from this precedent.
- **The `features/* -> badges` shared-leaf edge.** `CardView.tsx`'s badge deep imports (`GoneBadge`, `SourceBadge`) are sanctioned by design, encoded as the boundaries config's final allow policy — not a violation to flag.
- **The `watcher -> ttyd -> store` edge.** Both `watcher` and `ttyd` classify as the general `adapters` element; `adapters -> store` is an already-allowed edge. This is a documented architecture invariant (`docs/ARCHITECTURE.md#preserved-import-edges`), not an unenforced gap — no allow-rule was needed to encode it, and none should be added.
- **The file-scoped warn carve-out (2 files).** `lib/card-badges.ts` and `primitives/ActivityItem.tsx` have their entire `boundaries/dependencies` rule demoted to `warn` via a named trailing carve-out block in `eslint.config.ts` — flat config cannot express per-edge severity, so the carve-out is file-scoped, not edge-scoped: it demotes every boundaries policy in those two files, not just the debt edges. The intended debt is the 3 TODO-57 edges (`lib/card-badges.ts -> hooks/useUnseenActivity`; `primitives/ActivityItem.tsx -> lib/event-copy` / `lib/format-age`) — genuine layering violations kept at `warn` (not `error`, not silenced), pointing at `docs/standards/architecture.md`'s "Triage-derived layering-violation fixes" gap-list entry, temporary until Phase 57 relocates/hoists the offending calls. Flag those 3 in review as known, tracked debt, not as new findings — but any NEW, unrelated boundaries violation in these two files also reports only at `warn`, so reviewers must manually hold new edges there to the error bar until Phase 57 removes the carve-out block entirely.

## Comments (all layers)

- [ ] JSDoc-only form, WHY not WHAT, zero body/inline comments, no TODOs in code — the full nine-rule standard lives at `docs/standards/comments.md`; this doc does not restate it.
