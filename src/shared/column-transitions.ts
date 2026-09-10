import type { Column } from "./types.js";

/**
 * The executable FLOW-01 column-transition specification (`BOARD-06`): every column-changing
 * trigger against its legal source column(s), its target, and its OWNING code path. This module is
 * the spec's code-side home and the block below is its full text; the human-readable table lives
 * at `docs/ARCHITECTURE.md#column-transition-specification`, hand-maintained from this list rather
 * than generated (the invariant gate verifies presence in both homes, not content-equality,
 * matching every other dual-homed invariant in this codebase). References are `file#symbol` on
 * purpose — absolute line numbers rot on the first edit to the file they point at, which is how
 * the drift this spec exists to prevent gets in.
 *
 * The module lives in `shared/` (the `shared/demote-eligibility.ts` precedent) so the web bundle
 * consults the SAME predicates the store enforces. A client that re-states a blocked pair as its
 * own literal drifts silently: the board keeps offering the move, the route answers 409, and
 * `moveCardManual` is never reached — so no `change` event is broadcast and the optimistic column
 * has nothing to reconcile against.
 *
 * 1. Hook `Stop` + `DISPATCH_STATUS: DONE` -> `agent_done` — owner
 *    `hook-events.ts#applyStopEvent` -> `board.store.ts#applyMarker`.
 *    Sources: any except `APPLY_MARKER_EXCLUDED_SOURCES`.
 * 2. Hook `Stop` + `DISPATCH_STATUS: NEEDS_INPUT` -> `needs_input` — same owner/sources as #1.
 * 3. Hook `UserPromptSubmit` -> `in_progress` — owner `hook-events.ts#applyPromptSubmit` ->
 *    `board.store.ts#flipBack`. Sources: `FLIP_BACK_SOURCES`.
 * 4. Hook `PreToolUse` for a pause-class tool -> `needs_input` — owner
 *    `hook-events.ts#applyPreToolUseEvent` -> `applyMarker`. Same sources as #1.
 * 5. Hook `PostToolUse` for a pause-class tool -> `in_progress` — owner
 *    `hook-events.ts#applyHookEvent`'s `PostToolUse` branch -> `flipBack`. Same sources as #3.
 * 6. Watcher marker decision (pane-parsed) -> `needs_input`/`agent_done` — owner
 *    `watcher.ts#scanSession` reading the PURE `scan-decision.ts#decideScan`, to `applyMarker`.
 *    Same sources as #1.
 * 7. Watcher flip-back decision -> `in_progress` — owner same path (`watcher.ts#scanSession`), to
 *    `flipBack`. Source: ONLY `needs_input` — `decideScan` never emits a `flipBack` decision for
 *    an `agent_done`/`in_review`/`parked` source, so the watcher does NOT drive those edges; only
 *    the hook channel (#3, #5) does. Named fact, not a bug.
 * 8. Manual drag / `POST /cards/:id/move` — owner `board.store.ts#moveCardManual`, gated by
 *    `routes/cards.route.ts#manualMoveTransitionError`. NOT a blind set: the mutator consults
 *    {@link isManualMoveAllowed} inside its enqueue callback (`BOARD-07`), which refuses
 *    `agent_done` as a target from every source and refuses To Do -> `in_progress`; every other
 *    pair the pre-allowlist blind set permitted still passes. The route mirrors the same predicate
 *    for a legible 409 and refuses anything the allowlist rejects, including a pair it has no
 *    tailored message for.
 * 9. Group member mirroring — NOT an independent trigger; a fan-out from #1, #3, #6 (when the
 *    watcher path applies), #8, `attachExistingSession`, and `completeStart` — owner
 *    `board.store.ts#mirrorMemberColumn`, called from exactly these five writers. Unchanged by
 *    Phase 77 — no writer is added to or removed from this set.
 * 10. Session-lost (watcher 3-strike detector, boot reconcile) — column-PRESERVING, no column
 *     write — owner `board.store.ts#markSessionLost`.
 * 11. Resume / resume-failed — column-PRESERVING — owner `board.store.ts#resumeSession` /
 *     `#recordResumeFailure`.
 * 12. Cleanup (Done teardown) — column-PRESERVING (the card already reached `done` via #8 before
 *     cleanup runs) — owner `services/orchestration/cleanup.ts` plus the `board.store.ts` cleanup
 *     mutators.
 * 13. Card creation -> To Do (`board.store.ts#createLocalCard` / `#createGroupCard`) or ->
 *     `inbox` (`newInboxCard` via `store/mapping.ts#applyIssues`) — owner as named.
 * 14. Boot hydration legacy migration (`in_planning` -> To Do / `in_progress`) — owner
 *     `board.store.ts#hydrateFromParsed`, one-way, deliberately skips `mirrorMemberColumn`.
 * 15. Start-saga success -> `in_progress` — owner `board.store.ts#completeStart` /
 *     `#attachExistingSession`.
 * 16. Marker while Parked (LOCAL-17): column-PRESERVING. `applyMarker` records the marker key on
 *     the session (and the card mirror) but never moves the card and emits no event. Sources:
 *     `MARKER_CONSUMED_SOURCES`. Recording the key is what keeps the level-triggered pane scan
 *     from applying the still-visible marker the moment a prompt flips the card back (#3), which
 *     is why Parked is a consumed source rather than an excluded one.
 *
 * 17. Unwind (LOCAL-17) -> members to To Do or the Inbox, group card archived, owner
 *     `services/orchestration/unwind.ts#unwindGroup` -> `board.store.ts#unwindGroup`.
 * 18. Restore (LOCAL-17) -> the group's archived column, members mirror, all-or-nothing via
 *     `board.store.ts#restoreBlocker`; owner `board.store.ts#restoreGroup`.
 *
 * Parked has NO automatic in-edge (manual drag only, #8) and exactly one automatic out-edge, the
 * prompt-driven flip-back (#3, #5): it sits in `FLIP_BACK_SOURCES` but NOT in
 * `FLIP_BACK_CLEARS_LAST_MARKER`, so the consumed key survives the flip and dedups the marker
 * still on the pane.
 *
 * Agent Done and In Review carry OPPOSITE asymmetries. Agent Done has an automatic in-edge
 * (marker) and no automatic out-edge except the already-intentional `agent_done -> needs_input` on
 * a new distinct marker (`applyMarker`'s own guard, unchanged) plus the prompt-driven flip-back
 * added by this spec. In Review has NO automatic in-edge (deliberately deferred) but DOES have
 * automatic out-edges (marker to needs_input / agent_done, and prompt-driven flip-back to
 * in_progress).
 *
 * Every conflict this spec was written to name is now closed and reflected above: `flipBack`'s
 * guard is `FLIP_BACK_SOURCES` rather than `needs_input` alone; `applyMarker` reads
 * `APPLY_MARKER_EXCLUDED_SOURCES`, which includes Inbox; `moveCardManual` consults
 * {@link isManualMoveAllowed}; and `applyMarker` takes its activity-event type from the caller
 * rather than deriving it from the target column (`WR-05`). One deliberate residual remains, and
 * is not a conflict: under `statusChannel: "auto"` both channels are live until a session's first
 * authenticated hook event, because that latch is evidence and arbitration must never leave a
 * session with no status channel at all — see `docs/ARCHITECTURE.md#hooks-status-channel`.
 *
 * Legal source columns for `flipBack` — the target is always `in_progress` (no
 * return-to-previous-column history state). Read by `board.store.ts#flipBack`.
 * @see docs/ARCHITECTURE.md#column-transition-specification
 */
export const FLIP_BACK_SOURCES: readonly Column[] = [
  "needs_input",
  "agent_done",
  "in_review",
  "parked",
] as const;

/**
 * Source columns where `applyMarker` consumes a marker: the key is recorded, nothing moves (#16).
 * @see docs/ARCHITECTURE.md#in-review-lifecycle
 */
export const MARKER_CONSUMED_SOURCES: readonly Column[] = ["parked"] as const;

/**
 * The subset of {@link FLIP_BACK_SOURCES} whose flip ALSO clears `card.lastMarker`. `needs_input`
 * is deliberately EXCLUDED — flipping out of `needs_input` must stay byte-identical to today
 * (FLOW-05). Read by `board.store.ts#flipBack`.
 */
export const FLIP_BACK_CLEARS_LAST_MARKER: readonly Column[] = [
  "agent_done",
  "in_review",
] as const;

/**
 * Source columns `applyMarker` refuses to move a card out of. `inbox` is the new member this plan
 * adds (an inbox card structurally never carries a `tmuxSession` so no live caller reaches this
 * path today, but the guard must not rely on that accident); To Do and Done are unchanged from
 * today. Read by `board.store.ts#applyMarker`.
 */
export const APPLY_MARKER_EXCLUDED_SOURCES: readonly Column[] = [
  "todo",
  "done",
  "inbox",
] as const;

/**
 * `BOARD-07`: Agent Done is NEVER a legal manual target from any source — the only sanctioned
 * entry is a real completion signal via `applyMarker`, never a drag or a bare REST move. Read by
 * `board.store.ts#moveCardManual` and `routes/cards.route.ts#manualMoveTransitionError`.
 * @see docs/ARCHITECTURE.md#column-transition-specification
 */
export function blocksAgentDoneManualEntry(to: Column): boolean {
  return to === "agent_done";
}

/**
 * `BOARD-07`: To Do -> In Progress is reserved for the start saga (`completeStart` /
 * `attachExistingSession`), which provisions a session; a manual move would park a card in In
 * Progress with none. Read by the same two call sites as {@link blocksAgentDoneManualEntry}.
 */
export function blocksTodoToInProgressManualMove(
  from: Column,
  to: Column,
): boolean {
  return from === "todo" && to === "in_progress";
}

/**
 * `BOARD-07`: the manual-move allowlist. Every `(from, to)` pair the pre-Phase-77 blind set
 * allowed stays allowed — this closes exactly the two named holes above, nothing more. The sole
 * authority is `moveCardManual`, consulted inside the enqueue callback (WR-04 precedent); the
 * route's use of this same predicate is for a legible message only, never the enforcement point.
 * @see docs/ARCHITECTURE.md#column-transition-specification
 */
export function isManualMoveAllowed(from: Column, to: Column): boolean {
  return (
    !blocksAgentDoneManualEntry(to) &&
    !blocksTodoToInProgressManualMove(from, to)
  );
}
