/**
 * Phase 100 plan 01 CDP harness scaffold (DRAG-05, dev/ops tooling, NOT test code): no test
 * framework, no assertion library, lives outside src/, the same category as panel-92..99.mjs. This
 * file is the FIRST script in this repo to drive a real dnd-kit `MouseSensor` drag through CDP
 * `Input.dispatchMouseEvent` and prove, before asserting anything else, that the drag actually
 * activated (`assertDragActivated`). Every check this phase writes calls that primitive first; a
 * fixture or a drag sequence that never truly activates dnd-kit would otherwise let every later
 * check pass vacuously against a still board, exactly the "check that cannot fail" failure this
 * milestone has recorded repeatedly (99-REVIEW.md CR-02, three earlier phases' own findings).
 *
 * SAFETY, copied verbatim in substance from this project's own precedent (panel-92 through
 * panel-99.mjs headers). Booting ANY dispatch server sweeps `ttyd` processes MACHINE-WIDE via
 * `adoptAndSweep`, fingerprinted by argv shape, never by tmux session name or which board.db
 * spawned it. `assertNoLiveService()` is a FAIL-CLOSED preflight: it throws (never warns) if
 * anything answers on :4700, before this script boots any server or spawns any real process, and
 * there is no override flag. It is awaited BEFORE any sandbox directory is created.
 *
 * NO REAL TMUX, NO REAL TTYD, NO REAL SAGA. Every verdict measures DOM shape produced from a wire
 * payload the fixtures seed directly via `node:sqlite` (the panel-93..99.mjs idiom). None of the
 * five fixture cards below ever carries a `tmuxSession`: a seeded `tmuxSession` with no live tmux
 * gets reconciled to lost at boot (`board.store.ts`'s `markSessionLost` full-card-loss branch),
 * which wipes seeded fields before the board ever paints, the exact trap `panel-99.mjs`'s own
 * header documents and this file avoids the same way.
 *
 * FIXTURE SHAPE, matched exactly to `Board.tsx`'s own selection-eligibility predicate
 * (`c.column === "todo" && c.groupId == null && c.source !== "group"`), not a shape the product can
 * never produce. `MSD-A`/`MSD-B`/`MSD-C`/`MSD-D` are all `column: "todo"`, `groupId: null`, no
 * `source` field at all (so `source !== "group"` holds trivially). `MSD-Z` sits in `done` so the
 * direct-move target column is never empty, which would otherwise make "card moved into an empty
 * column" ambiguous with "card moved to the wrong column that happens to render first." No fixture
 * ever seeds a `selectedIds`-shaped object; selection in later plans is only ever produced by real
 * Ctrl/Cmd+click through the real DOM, never a direct React-state injection (RESEARCH Pitfall 2,
 * `99-REVIEW.md` CR-02's own root cause).
 *
 * THE DRAG PRIMITIVE, the load-bearing addition this file makes to the repo's toolbox
 * (`100-PATTERNS.md` gotcha 5, verified against `node_modules/@dnd-kit/core/dist/core.esm.js`).
 * `MouseSensor.activators = [{ eventName: 'onMouseDown' }]`, its `events` map is
 * `{ move: 'mousemove', end: 'mouseup' }`, plain native mouse events, NOT pointer events
 * (`PointerSensor` is not used anywhere in this codebase; `Board.tsx` wires only `MouseSensor` and
 * `TouchSensor`). Those listeners reach the DOM through `Card.tsx`'s
 * `domProps={{ ...listeners, ...attributes, ... }}`, spread onto `CardView`'s root `<div>`, THAT
 * div, never a child button or icon, is the element `Input.dispatchMouseEvent` must target.
 * Activation constraint is `useSensor(MouseSensor, { activationConstraint: { distance: 5 } })`
 * (`Board.tsx`): the FIRST `mousemove` whose delta from the `mousedown` point exceeds 5px activates
 * the drag; a sequence that never exceeds 5px total never starts a drag at all. `beginDrag` below
 * asserts that displacement NUMERICALLY rather than assuming the geometry clears it.
 * `assertDragActivated` is the self-proof: called while the mouse button is still down, it reads
 * the rendered `DragOverlay` node (NOT a `document.body` portal in this dnd-kit version,
 * `DragOverlay`'s own source has no `createPortal` call, it renders in normal React tree flow
 * exactly where `<DragOverlay>` sits in `Board.tsx`'s JSX, which is a sibling of the column scroll
 * row, never nested inside any `[data-column]` container) and asserts the SOURCE card root's
 * computed `opacity` is `"0.4"` (`CardView.tsx`'s `dimmed` rendering, driven only by
 * `useDraggable().isDragging`, which is only ever true today while a drag is genuinely active). If
 * either reading is absent or wrong, `assertDragActivated` THROWS, naming the identifier and both
 * readings, it never records a violation and continues, because every later check in this phase
 * calls it first and a soft failure there would let those checks pass against a board that never
 * moved (the exact failure mode `100-01-PLAN.md`'s own rationale names).
 *
 * CARD LOCATION, the `density-91.mjs`/`panel-99.mjs` convention copied verbatim: no DOM `id` or
 * `data-*` attribute names an individual card today, so every card lookup below walks
 * `[data-column="<column>"] > .scroll-stable-y`'s direct DIV children and matches on
 * `el.textContent.indexOf(identifier) !== -1`, throwing on zero matches and on more than one match.
 * No locator anywhere in this file keys on an `aria-label` prefix (the standing Trap 3 rule this
 * milestone has recorded from `panel-99.mjs`'s own header): an attribute a later regression could
 * change would report "not found" instead of naming the wrong value, which looks like a real
 * pass/fail signal but proves nothing.
 *
 * Ports, unique across every existing harness (verified against every `panel-9x.mjs`,
 * `density-91.mjs`, and `port-attribution-99.mjs`'s own constants): sandbox server 47876, CDP 9377,
 * sandbox prefix `dispatch-panel-100-`.
 *
 * Usage:
 *   node scripts/panel-100.mjs                       every registered check, exits non-zero on any
 *                                                       violation. Plan 01 registered two:
 *                                                       single-card-unchanged | keyboard-unchanged.
 *                                                       Plan 05 added three more: stacked-overlay |
 *                                                       overlay-unchanged-n1 | a11y, registered
 *                                                       BEFORE plan 01's two in CHECKS (see PLAN
 *                                                       100-05 ADDITIONS below, "CHECKS' insertion
 *                                                       order is LOAD-BEARING"). Plan 06 (this
 *                                                       revision) added the final two:
 *                                                       group-modal-prefill | atomic-rollback,
 *                                                       registered between a11y and the two
 *                                                       permanent-movers for the same reason, and
 *                                                       registered nine `--break <name>` legs
 *                                                       total (see PLAN 100-06 ADDITIONS below).
 *                                                       This is now the phase's complete
 *                                                       seven-check harness.
 *   node scripts/panel-100.mjs --check <name>         one named check only.
 *   node scripts/panel-100.mjs --break <name>         that check's OWN break: fires the SAME check
 *                                                       function the real run uses against a DOM
 *                                                       mutation, confirms it reports the violation
 *                                                       by name, restores the captured original,
 *                                                       and re-confirms PASS, all inside one Chrome
 *                                                       tab. Never edits a source file.
 *
 * BREAK EVIDENCE, all seven checks (nine registered breaks, `atomic-rollback` carries three of its
 * own) run under `--break <name>` for real and observed reporting their own violation. The quoted
 * lines below are the VERBATIM TRIP-leg output captured from those runs:
 *   - `single-card-unchanged` proven able to fail: removing the `done` column's droppable DOM node
 *     (behind a same-size placeholder so no sibling column reflows) BEFORE the drag starts produced
 *     `single-card-unchanged: MSD-A expected column "done", measured "todo"`.
 *   - `keyboard-unchanged` proven able to fail: detaching MSD-B's MoveToPicker "Done" entry before
 *     the click produced `keyboard-unchanged: MSD-B expected column "done", measured "todo"`.
 *   - `stacked-overlay` proven able to fail (100-05): rewriting the 4px back face's inline
 *     `transform` to `translate(4px, 10px)` mid-drag produced
 *     `stacked-overlay: leg A (N=3), 4px back face transform expected "matrix(1, 0, 0, 1, 4, 4)",
 *     measured "matrix(1, 0, 0, 1, 4, 10)"` AND
 *     `stacked-overlay: leg A (N=3), 4px back face rect expected left=1365.00 top=145.00
 *     width=206.00 height=91.19 (front rect translated by (4,4)), measured left=1365.00 top=151.00
 *     width=206.00 height=91.19`.
 *     `stacked-overlay` ALSO carries a PAINT-ORDER assertion added by 100-REVIEW CR-01, because
 *     transform/rect math alone cannot see occlusion and passed against a visibly blank overlay:
 *     the deck container's own `pointer-events`/`inert` are toggled for exactly one synchronous
 *     `document.elementFromPoint` at the front face's centre (both attributes suppress hit testing
 *     and neither affects painting, so the reading is unperturbed), plus a per-layer computed
 *     `z-index` comparison against 100-UI-SPEC.md's layer table and a check that the deck container
 *     establishes a stacking context at all. Run VERBATIM against the pre-fix build (front
 *     `CardView` at `z-index: auto`, back faces at 1/2, deck wrapper not a stacking context) it
 *     reported, for leg A and leg B alike:
 *     `stacked-overlay: leg A (N=3), front CardView face z-index expected "3" (100-UI-SPEC.md layer
 *     table), measured "auto"`,
 *     `stacked-overlay: leg A (N=3), the deck container establishes no stacking context (isolation
 *     "auto", z-index "auto"), so the layer table's z-indexes escape into the DragOverlay's own
 *     stacking context and no longer order the deck`, AND
 *     `stacked-overlay: leg A (N=3), paint order, the element painted at the deck's centre point
 *     expected to be the front CardView face, measured the deck back face at index 1 (<div>, probe
 *     pointer-events "auto"); front z-index "auto", back face z-indexes ["1","2"]`.
 *   - `overlay-unchanged-n1` proven able to fail (100-05): inserting an absolutely positioned
 *     inset:0 intruder `<div>` as a sibling of the N<=1 overlay's own card root, mid-drag, produced
 *     `overlay-unchanged-n1: N=0 leg, expected exactly 1 face-level element directly under the
 *     fixed overlay node, measured 2`,
 *     `overlay-unchanged-n1: N=0 leg, found an unexpected absolutely-positioned inset:0 descendant
 *     (a deck back face) inside the N<=1 overlay`, AND
 *     `overlay-unchanged-n1: N=0 leg, fixed overlay node's own descendant-element count expected 10
 *     (the card root itself plus its own subtree, nothing else), measured 11`.
 *   - `a11y` proven able to fail (100-05): removing the `aria-hidden` attribute from the deck
 *     container mid-drag produced `a11y: deck container aria-hidden expected "true", measured null`
 *     AND `a11y: badge's closest [aria-hidden="true"] ancestor is not the deck container, the count
 *     is not inside the hidden subtree`.
 *   - `group-modal-prefill` proven able to fail (100-06): a `MutationObserver` detaching the New
 *     group modal's first `MemberRow` node the instant the modal appears produced
 *     `group-modal-prefill: modal member identifier set expected ["MSD-A","MSD-B","MSD-C"], measured
 *     ["MSD-B","MSD-C"]`, never "modal not found".
 *   - `atomic-rollback` proven able to fail three ways (100-06):
 *     (1) releasing all three initial `POST /move` requests successfully (no CDP failure injected)
 *     produced `atomic-rollback: trip, [role="alert"] text expected "Couldn't move 3 tickets",
 *     measured null` AND `atomic-rollback: trip, MSD-A expected column "todo" immediately after
 *     rollback, measured "done"` (also reproduced for MSD-B/MSD-C, and again after a full page
 *     reload);
 *     (2) `atomic-rollback-toast`, a `MutationObserver` removing `[role="alert"]` the instant it
 *     appears while the injection works normally, produced `atomic-rollback: leg 1 (clean rollback),
 *     [role="alert"] text expected "Couldn't move 3 tickets", measured null` with every column
 *     assertion still passing, proving the toast assertion is not masked by the column ones;
 *     (3) `atomic-rollback-stranded-compensation`, a monkey-patched `window.console.error` that
 *     swallows any "stranded" message plus a `MutationObserver` removing `[role="alert"]`, layered
 *     on top of a genuinely permanent compensation failure (failing the targeted compensating call
 *     AND its retry), produced `atomic-rollback: trip (detection signals suppressed), expected
 *     [role="alert"] to stay visible past 3200ms for a stranded compensation, measured absent` AND
 *     `atomic-rollback: trip (detection signals suppressed), expected a console.error mentioning
 *     "stranded" and card id panel100-a, none captured`, proving the check's own stranded-card
 *     detection (an alert that outlives the normal 3200ms auto-clear, plus a captured `console.error`
 *     naming the card) is what catches this failure mode, not a column read (which a real SSE resync
 *     eventually settles to the server's own un-reverted truth regardless of what this harness
 *     asserts, see PLAN 100-06 ADDITIONS below). Which of MSD-A/MSD-C is stranded is NOT
 *     deterministic: `strandedId` is taken from whichever compensating request the CDP pause queue
 *     delivers first out of a concurrent `Promise.allSettled`, so the card id in that message varies
 *     run to run.
 *     Those two assertions were DEAD until 100-REVIEW CR-02: they ran only in this break's trip leg,
 *     where they are expected to fail, so `checkAtomicRollback` gained
 *     `leg 3 (compensation permanently fails)`, the same scenario in the configuration where both
 *     must pass. Run verbatim against a `Board.tsx` with `strandedCompensationRef` and its
 *     `if (!strandedCompensationRef.current)` timer guard deleted, leg 3 reported
 *     `atomic-rollback: leg 3 (compensation permanently fails), expected [role="alert"] to stay
 *     visible past 3200ms for a stranded compensation, measured absent`, where every path was
 *     previously green with the feature removed.
 * All nine `--break <name>` runs' restore legs re-confirmed PASS (`tripFired=true restoreClean=true`
 * for each), and a plain `node scripts/panel-100.mjs` run immediately after all nine breaks exited 0
 * with all seven checks PASS, proving no break leaked DOM state.
 *
 * PLAN 100-05 ADDITIONS AND FINDINGS, load-bearing for anyone extending this file further:
 *   - `selectCardsByIdentifier`/`ctrlClickCard` use CDP's Meta/Command modifier bit (`modifiers: 4`),
 *     NOT Ctrl (`modifiers: 2`), for the multi-select click. Diagnosed against an isolated `data:`
 *     URL test page on this machine's Chrome (151.0.7922.170, `--headless=new`): `modifiers: 2`
 *     dispatches real `mousedown`/`mouseup` events but NEVER synthesizes the follow-up native
 *     `click` event, matching macOS's own "Control+click == secondary click" convention (Chrome
 *     routes it toward a context-menu gesture); `modifiers: 4` produces a normal `click` with
 *     `metaKey: true`, which `Card.tsx`'s own `event.metaKey || event.ctrlKey` eligibility check
 *     already accepts. Platform-specific; budget for it if this harness ever runs on Linux/Windows
 *     Chrome, where plain Ctrl is very likely correct.
 *   - `moveDragTo` (a mid-drag relocation to a DIFFERENT column than `beginDrag`'s own target,
 *     used for every "harmless same-column drop" check in this file) MUST actually dispatch a real
 *     `mouseMoved` to the new point before `endDrag`: dnd-kit resolves `over` from the LAST real
 *     `mousemove` coordinates, never from `mouseReleased`'s own x/y, so releasing at a different
 *     point than the drag's last move does not change where the drop resolves. A single move
 *     without a settle sleep also raced dnd-kit's own collision re-measurement in this harness
 *     (observed once: the card landed in an unrelated intermediate column); `moveDragTo` now
 *     dispatches the move TWICE with a 150ms settle sleep after each.
 *   - `FIND_FIXED_OVERLAY_SRC` (locates the TRUE dnd-kit `position: fixed` `DragOverlay` wrapper,
 *     distinct from plan 01's `FIND_OVERLAY_SRC`, which keys on this phase's own `aria-hidden`/
 *     `inert` attributes) filters candidates by cheap `textContent` string search BEFORE calling
 *     `getComputedStyle()`, never the reverse: computing style for every element under `#root`
 *     measurably degraded this harness under repeated drags in one long session.
 *   - `a11y`'s own reading locates the deck container via `FIND_FIXED_OVERLAY_SRC` (its wrapper's
 *     single child), never via `FIND_OVERLAY_SRC`'s `aria-hidden`/`inert` selector: the `a11y`
 *     break REMOVES `aria-hidden` from that exact node, so a locator keyed on that same attribute
 *     would go blind the instant the attribute changes and silently resolve to the wrong node (the
 *     inner `CardView`, which also carries its own separate `aria-hidden`/`inert` pair) instead of
 *     reporting the real violation, a live instance of the standing Trap 3 rule.
 *   - `CDP.send()` now carries a 20s per-call timeout (default `timeoutMs`, see the class itself):
 *     empirically, this harness's headless renderer occasionally stops responding to
 *     `Runtime.evaluate` after several consecutive real drags in one long-lived tab (a genuine
 *     renderer stall, not a bug traced to any one check's own JS; zero console/exception output
 *     accompanies it). `freshBoardSession()` opens a genuinely NEW Chrome target/tab (a same-tab
 *     `Page.navigate` reload does not recover once the renderer is already stuck, since the reload
 *     command itself queues in the same stalled renderer) and is used both between a break's TRIP
 *     and RESTORE legs and between successive checks in a multi-check `CHECKS` run; the very first
 *     check in a run reuses the already-loaded standup session.
 *   - `CHECKS`' insertion order is LOAD-BEARING: `stacked-overlay`/`overlay-unchanged-n1`/`a11y` are
 *     registered BEFORE `single-card-unchanged`/`keyboard-unchanged`, since the latter two
 *     PERMANENTLY drag MSD-A and MSD-B into `done` (that IS what they assert), which would make
 *     those two cards ineligible for a later ctrl-click (`Card.tsx` requires `column === "todo"`)
 *     if they ran first in the same full-suite invocation.
 *
 * PLAN 100-06 ADDITIONS AND FINDINGS, load-bearing for anyone extending this file further:
 *   - `group-modal-prefill`/`atomic-rollback` reuse `panel-95.mjs`'s `Fetch.enable`/
 *     `Fetch.requestPaused`/`Fetch.failRequest`/`Fetch.continueRequest` idiom, extended for THIS
 *     phase's own shape: three initial paused requests arrive together (not one), and the two
 *     compensating requests plan 04 fires after a partial failure arrive on the SAME pattern
 *     afterward and must also be drained, or the page hangs on them. `fetchPausedQueue` (module
 *     level, fed by `main()`'s single `cdp.ws` message listener, which spans every session) and
 *     `waitForNextPausedRequest` mirror `panel-95.mjs`'s own queue/wait shape exactly.
 *   - `atomic-rollback`'s `strandCompensation`/`retryCompensationOnce` legs need the same shared
 *     capture: `consoleCapturedMessages` (also module level, fed by the same listener) retains every
 *     `Runtime.consoleAPICalled` event so a check can assert a SPECIFIC `console.error` (here,
 *     `performGroupMove`'s stranded-compensation log naming the card id) actually fired, not merely
 *     grep this script's own stdout after the fact.
 *   - `FIND_OVERLAY_SRC`/`FIND_FIXED_OVERLAY_SRC` needed a THIRD exclusion (`#activity-drawer`)
 *     beyond `[data-column]`: the app's own Activity feed drawer is `position: fixed`,
 *     `aria-hidden="true"`, `inert` when closed, exactly the same attribute/style signature a
 *     `DragOverlay` node carries, and once a card's move has been logged even once, the drawer's own
 *     (hidden) event text legitimately contains that card's identifier. No prior plan's checks ever
 *     drove a SECOND drag against a card that already had activity history (this plan's
 *     `atomic-rollback` break-restore repair does), so this collision was previously unreachable;
 *     both locators now explicitly exclude `el.closest("#activity-drawer")`.
 *   - `atomic-rollback`'s two legs (leg 1, the plan's own base scenario; leg 2, the plan-checker's
 *     required addition proving a retried-once compensation is what actually saves a card, on the
 *     client AND after a full page reload) share ONE `performAtomicRollbackLeg` body, branched by
 *     `opts`. A break's own SCENARIO (e.g. `atomic-rollback`'s "release all three, no failure ever
 *     occurs") is checked by running the SAME assertions the passing case uses, never a bespoke
 *     "expect the broken outcome" branch: the former proves the check's own assertions can fail
 *     when run against a genuinely wrong scenario, the latter proves nothing about the check at all.
 *   - `atomic-rollback-stranded-compensation`'s own scenario (fail the compensating call AND its
 *     retry) is `Board.tsx`'s OWN already-correct handling of a permanently-stranded card (plan 04),
 *     not a bug, so the bare scenario alone produces a clean pass, not a violation. Proving THIS
 *     check's own detection signals (an alert that outlives its normal 3200ms auto-clear, a captured
 *     `console.error` naming the card) are load-bearing needed a DOM/JS-level mutation layered ON
 *     TOP of the real stranding: a `MutationObserver` removing `[role="alert"]` the instant it
 *     appears, plus a monkey-patched `window.console.error` swallowing any call mentioning
 *     "stranded" (so this harness's own capture never observes it). The `atomic-rollback` and
 *     `atomic-rollback-toast` breaks genuinely and permanently move real cards server-side
 *     (`releaseAllInitial` lets all three moves land for real; the stranded scenario permanently
 *     fails one compensation for real); both restore legs first drag the affected card(s) back to
 *     `todo` via a real single-card `dragCardToColumn` (`repairCardsToTodo`) before reusing that
 *     board session, since the following restore-verification run's own `selectCardsByIdentifier`
 *     needs every fixture back in a selection-eligible column.
 *   - `freshBoardSession()` now also closes the PREVIOUS target via `Target.closeTarget` (a
 *     browser-process-level command, independent of whether the closed tab's own renderer is
 *     responsive) once the new one is confirmed loaded. This plan's two new checks add substantially
 *     more real drags per full-suite run than any prior plan (`atomic-rollback` alone drives two
 *     full drags plus a `Page.reload` in one check); left unclosed, the accumulating stuck tabs
 *     (deliberately never closed before this plan, see PLAN 100-05's own `CDP.send()` timeout note)
 *     measurably starved the LAST fresh session in a full-suite run of enough CPU to render within
 *     `RENDER_TIMEOUT_MS`, reproducing on 1 of 3 consecutive full-suite runs before this fix and on
 *     0 of 2 after it.
 *
 * TIMING FINDING, load-bearing for the `single-card-unchanged` break specifically, and worth
 * recording since it corrects this plan's own `<interfaces>` block: dnd-kit caches a droppable's
 * rect at drag activation (`handleDragStart`) and does not re-measure a droppable removed AFTER
 * that point. A first draft of this break removed the `done` column's node MID-DRAG (matching the
 * `<interfaces>` block's literal wording, "before the drop"), and the drop SILENTLY SUCCEEDED
 * server-side anyway (verified via a direct `fetch("/api/board")` read from the page: MSD-A's
 * server-side `column` read `"done"`), because collision detection reused the STALE pre-removal
 * rect. The resulting React commit into the now-detached `done` subtree left the whole page stuck
 * (`DragOverlay` never cleared, MSD-A vanished from every attached column, `over` never resolving
 * clean). Removing `done` BEFORE `beginDrag`'s `mousedown` instead means dnd-kit's very first
 * measurement of that droppable reads a detached node's `getBoundingClientRect()` (all zeros in
 * every browser), so no drop point can ever intersect it and `over` correctly resolves to nothing.
 *
 * Exit codes: 0 every requested check PASS (or, under `--break <name>`, the break correctly fired
 * and the restore leg re-passed). 1 a live :4700, a failed build, a sandbox safety violation, a DOM
 * node the evaluate could not resolve, any violated criterion, the real board.db changing during
 * the run, or a sandbox port still held after teardown.
 */
import { spawn, execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const execFileP = promisify(execFile);

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
/** Every verdict here reads DOM served out of `dist/web`, a server-only build would measure a
 * stale bundle, so this is the full `build`, never `build:server`. */
const BUILD_SCRIPT = "build";

/** Distinct from every other scripts/*.mjs sandbox/CDP port pair in this repo (verified against
 * density-91.mjs 47861/9366, panel-92..99.mjs 47864..47871/47874/9367..9373/9376, port-attribution-99.mjs
 * 47875). Neither number below equals any of them. */
const SANDBOX_PORT = 47876;
const CDP_PORT = 9377;
const SANDBOX_PREFIX = "dispatch-panel-100-";

const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const RENDER_TIMEOUT_MS = 15_000;
/** Same value/purpose as `panel-95.mjs`'s own constant of the same name: how long a check may wait
 * for a `Fetch.requestPaused` event on the intercepted move pattern before giving up. */
const FETCH_PAUSE_TIMEOUT_MS = 10_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const FAKE_LINEAR_API_KEY = "panel-100-harness-fake-key-never-real";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Fail-closed: throw (never degrade) if anything answers on the user's real dispatch port. */
async function assertNoLiveService() {
  try {
    const res = await fetch("http://127.0.0.1:4700/api/board");
    await res.body?.cancel().catch(() => {});
    throw new Error(
      "PANEL-100-LIVE: a live dispatch service answered on http://127.0.0.1:4700/api/board, " +
        "refusing to start real processes or boot a sandbox server while the user's real service " +
        "is up. Stop the launchd service first, then rerun.",
    );
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("PANEL-100-LIVE"))
      throw err;
  }
}

function assertSandboxSafe(home) {
  if (SANDBOX_PORT === 4700) {
    throw new Error(
      "SANDBOX_PORT must never equal 4700, that is the user's live dispatch instance.",
    );
  }
  if (home === homedir()) {
    throw new Error(
      "sandbox home must never equal the real $HOME, refusing to proceed.",
    );
  }
  if (!home.startsWith(tmpdir())) {
    throw new Error(
      `sandbox home ${home} must live under ${tmpdir()}, refusing to proceed.`,
    );
  }
  if (!basename(home).startsWith(SANDBOX_PREFIX)) {
    throw new Error(
      `sandbox home ${home} must have a basename starting with "${SANDBOX_PREFIX}", refusing to proceed.`,
    );
  }
}

function makeSandboxHome(label) {
  const home = join(tmpdir(), `${SANDBOX_PREFIX}${label}-${process.pid}`);
  assertSandboxSafe(home);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: SANDBOX_PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey: FAKE_LINEAR_API_KEY } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

async function waitForReady(port) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `server on :${port} did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

function killAndWait(child) {
  if (child == null) return Promise.resolve();
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

let headBuild = null;

/** Unconditional full `build` (web + server), this instrument reads rendered DOM. Never mtime-gated. */
function assertBuilt() {
  if (headBuild !== null) return headBuild;
  const startedAt = Date.now();
  try {
    execFileSync("npm", ["run", BUILD_SCRIPT], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });
  } catch (err) {
    const detail = [err.stdout?.toString(), err.stderr?.toString()]
      .filter(Boolean)
      .join("\n")
      .trim();
    throw new Error(
      `refusing to run, \`npm run ${BUILD_SCRIPT}\` failed, so dist/ does not reflect src/:\n${detail || err.message}`,
    );
  }
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `Missing ${DIST_ENTRY} after a successful \`npm run ${BUILD_SCRIPT}\`.`,
    );
  }
  headBuild = { durationMs: Date.now() - startedAt };
  console.log(
    `preflight: built src/ -> dist/ via \`npm run ${BUILD_SCRIPT}\` in ${headBuild.durationMs}ms`,
  );
  return headBuild;
}

/** `entry` is REALPATH'd before being handed to `node`, the macOS /var -> /private/var trap. */
function bootServerAt(home, pathPrefix) {
  assertBuilt();
  const env = { ...process.env, HOME: home, NODE_ENV: "production" };
  if (pathPrefix) env.PATH = `${pathPrefix}:${env.PATH ?? ""}`;
  return spawn("node", [realpathSync(DIST_ENTRY)], {
    env,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

/**
 * Plant a stub `claude` executable at `<home>/bin/claude`, defense in depth only, since every
 * fixture below is seeded directly via `node:sqlite` and never drives a real saga. MUST branch on
 * `--version`: `checkHooksCapability()` probes it, untimeouted, before the sandbox server ever
 * starts listening, a stub blocking unconditionally hangs the boot.
 */
function writeStubClaudeBinary(home) {
  const binDir = join(home, "bin");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    join(binDir, "claude"),
    "#!/bin/sh\n" +
      'case " $* " in\n' +
      '  *" --version "*)\n' +
      '    echo "1.0.0 (Claude Code)"\n' +
      "    exit 0\n" +
      "    ;;\n" +
      "esac\n" +
      "echo 'panel-100 stub claude, deliberately never ready'\n" +
      "while true; do sleep 3600; done\n",
    { mode: 0o755 },
  );
  return binDir;
}

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `No Chrome binary found at any known path: ${CHROME_CANDIDATES.join(", ")}`,
    );
  }
  return found;
}

/** Minimal raw-CDP-over-WebSocket client (Node global WebSocket/fetch, zero new npm dependency). */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  /**
   * `timeoutMs` is a defensive bound, not a normal-path concern: every CDP round trip this file
   * issues completes in well under a second. Its purpose is to turn a genuinely lost response (a
   * message the renderer never sends back, observed empirically in this harness under sustained
   * multi-drag sessions) into a diagnosable rejection instead of hanging the whole process forever,
   * since `this.pending`'s resolve/reject pair otherwise has no other way to ever settle.
   */
  send(method, params = {}, sessionId, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(
            new Error(
              `CDP.send: no response to ${method} (id ${id}) within ${timeoutMs}ms, the renderer likely stalled`,
            ),
          );
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    this.ws.close();
  }
}

async function connectCDP() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const info = await res.json();
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  return new CDP(ws);
}

async function waitForCdpUp() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // Chrome debugging port not up yet, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Chrome debugging port :${CDP_PORT} did not come up`);
}

async function evalValue(cdp, sessionId, expression) {
  const { result, exceptionDetails } = await cdp.send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: false },
    sessionId,
  );
  if (exceptionDetails) {
    const thrown =
      exceptionDetails.exception?.description ??
      exceptionDetails.exception?.value ??
      exceptionDetails.text;
    throw new Error(
      `Runtime.evaluate failed: ${thrown}\n--- expression ---\n${expression}`,
    );
  }
  return result.value;
}

async function evalReport(cdp, sessionId, violations, label, expr) {
  try {
    return await evalValue(cdp, sessionId, expr);
  } catch (err) {
    violations.push(`${label}: ${err.message}`);
    return null;
  }
}

async function isPortListening(port) {
  try {
    await execFileP("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Module-level, populated by `main()`'s single `cdp.ws` message listener (shared across every
 * `Target.attachToTarget` session, including `freshBoardSession()`'s new tabs, since the listener
 * lives on the one underlying WebSocket connection). `fetchPausedQueue` collects
 * `Fetch.requestPaused` events for whichever check currently has the `Fetch` domain enabled;
 * `consoleCapturedMessages` collects every `Runtime.consoleAPICalled` event's params (mirroring the
 * existing DEBUG stderr line, but retained in memory so a check can assert a specific
 * `console.error`, for example `performGroupMove`'s stranded-compensation log, actually fired,
 * rather than only ever grepping this script's own stdout after the fact).
 */
const fetchPausedQueue = [];
const consoleCapturedMessages = [];

/** Shifts the next `Fetch.requestPaused` event off `fetchPausedQueue`, waiting up to `timeoutMs` if
 * the queue is empty. Mirrors `panel-95.mjs`'s own `waitForNextPausedRequest`. */
async function waitForNextPausedRequest(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fetchPausedQueue.length > 0) return fetchPausedQueue.shift();
    await sleep(50);
  }
  throw new Error(
    `no Fetch.requestPaused event observed within ${timeoutMs}ms`,
  );
}

// ---------------------------------------------------------------------------
// Fixtures. MSD-A..D are selection-eligible per Board.tsx's own predicate
// (column === "todo" && groupId == null && source !== "group"); MSD-Z sits in
// "done" so the direct-move target column is never empty. No fixture carries
// a tmuxSession (see header note). No fixture ever seeds a selectedIds-shaped
// object; selection is only ever produced by real DOM interaction.
// ---------------------------------------------------------------------------

const MSD_A_ID = "panel100-a";
const MSD_A_IDENTIFIER = "MSD-A";
const MSD_B_ID = "panel100-b";
const MSD_B_IDENTIFIER = "MSD-B";
const MSD_C_ID = "panel100-c";
const MSD_C_IDENTIFIER = "MSD-C";
const MSD_D_ID = "panel100-d";
const MSD_D_IDENTIFIER = "MSD-D";
const MSD_Z_ID = "panel100-z";
const MSD_Z_IDENTIFIER = "MSD-Z";

const TOP_LEVEL_IDENTIFIERS = [
  MSD_A_IDENTIFIER,
  MSD_B_IDENTIFIER,
  MSD_C_IDENTIFIER,
  MSD_D_IDENTIFIER,
  MSD_Z_IDENTIFIER,
];

function baseCardFields(id, identifier, title, column) {
  return {
    id,
    issueId: `${id}-issue`,
    identifier,
    title,
    description: null,
    priority: 3,
    column,
    groupId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** Four selection-eligible `todo` cards plus one `done` card so the direct-move target column is
 * never empty. Deliberately NO `tmuxSession` and NO `selectedIds`-shaped seeding anywhere. */
function allFixtureCards() {
  return [
    baseCardFields(
      MSD_A_ID,
      MSD_A_IDENTIFIER,
      "panel-100 MSD-A fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_B_ID,
      MSD_B_IDENTIFIER,
      "panel-100 MSD-B fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_C_ID,
      MSD_C_IDENTIFIER,
      "panel-100 MSD-C fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_D_ID,
      MSD_D_IDENTIFIER,
      "panel-100 MSD-D fixture card",
      "todo",
    ),
    baseCardFields(
      MSD_Z_ID,
      MSD_Z_IDENTIFIER,
      "panel-100 MSD-Z fixture card",
      "done",
    ),
  ];
}

/**
 * Boot once against the still-empty sandbox home so the store creates the real sqlite schema (the
 * panel-93..99.mjs seeding idiom, never a hand-duplicated schema), kill that boot, then insert
 * every fixture row directly via `node:sqlite` in the same pass.
 */
async function seedFixtureCards(home, cards) {
  const dbPath = join(home, ".dispatch", "board.db");
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const warmup = bootServerAt(home);
    try {
      await waitForReady(SANDBOX_PORT);
    } finally {
      await killAndWait(warmup);
    }
    const deadline = Date.now() + 5_000;
    while ((await isPortListening(SANDBOX_PORT)) && Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
    }
    const db = new DatabaseSync(dbPath);
    try {
      const hasCardsTable =
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'",
          )
          .get() != null;
      if (!hasCardsTable) {
        console.log(
          `seedFixtureCards: schema not yet created after warmup attempt ${attempt}/${ATTEMPTS}, retrying`,
        );
        continue;
      }
      const insert = db.prepare(
        `INSERT INTO cards (id, data) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      );
      for (const card of cards) insert.run(card.id, JSON.stringify(card));
      return;
    } finally {
      db.close();
    }
  }
  throw new Error(
    `seedFixtureCards: sqlite schema never appeared after ${ATTEMPTS} warmup-boot attempts`,
  );
}

/** Standup-only: confirms the initial board paint reached every fixture identifier before any
 * check runs. */
async function waitForBoardRootLoaded(cdp, sessionId, identifiers) {
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const probe = `
    (function () {
      var root = document.getElementById("root");
      if (!root) return false;
      var text = root.textContent;
      return ${JSON.stringify(identifiers)}.every(function (id) { return text.indexOf(id) !== -1; });
    })()
  `;
  while (Date.now() < deadline) {
    try {
      if (await evalValue(cdp, sessionId, probe)) return;
    } catch {
      // page mid-navigation, keep polling
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `initial board load never rendered every fixture identifier within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Opens a BRAND NEW Chrome target/tab against the sandbox root, attaches to it, enables the same
 * domains and viewport `main()` sets up on the original tab, and waits for the board to paint.
 * Returns the NEW `sessionId`. Used between a break's TRIP leg and its RESTORE leg (both of which
 * run a full multi-drag check a second time): empirically, this harness's headless renderer
 * occasionally stops responding to `Runtime.evaluate` mid-check after several consecutive real
 * drags in one long-lived page session (observed as an indefinite hang with zero further
 * console/exception output). A same-tab `Page.navigate` reload does NOT recover from this, since by
 * the time the renderer is unresponsive, the reload command is queued in the SAME stuck renderer
 * and never completes either (confirmed empirically: it hits its own polling timeout). A genuinely
 * fresh target/renderer process sidesteps whatever degraded the old one; the old (possibly stuck)
 * tab is deliberately left open rather than torn down here (closing it risks the SAME hang this
 * function exists to avoid), and is cleaned up regardless once `main()`'s `finally` block kills the
 * whole Chrome process at the end of this script's run.
 */
/**
 * Tracks the targetId of the last board tab handed out (by `main()`'s own standup `Target.
 * createTarget` call, or by a prior `freshBoardSession()`), so this call can close it once the NEW
 * target is confirmed loaded. `Target.closeTarget` is a browser-process-level command, independent
 * of whether the closed target's own renderer is responsive, so it reliably reaps even a genuinely
 * stuck tab. This plan's own `group-modal-prefill`/`atomic-rollback` checks add several more real
 * drags (and, for `atomic-rollback`, a `Page.reload`) per full-suite run than any prior plan; left
 * unclosed, the accumulating stuck tabs measurably starved the LAST fresh session in a run of
 * enough CPU to render within `RENDER_TIMEOUT_MS`, a load-bearing finding for this plan.
 */
let lastKnownTargetId = null;

async function freshBoardSession(cdp, identifiers) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url: `http://127.0.0.1:${SANDBOX_PORT}/`,
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Console.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await waitForBoardRootLoaded(cdp, sessionId, identifiers);
  if (lastKnownTargetId != null) {
    await cdp
      .send("Target.closeTarget", { targetId: lastKnownTargetId })
      .catch(() => {});
  }
  lastKnownTargetId = targetId;
  return sessionId;
}

function statRealBoardDb() {
  const p = join(homedir(), ".dispatch", "board.db");
  try {
    const st = statSync(p);
    return { path: p, exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { path: p, exists: false, mtimeMs: null, size: null };
  }
}

function fmtStat(s) {
  return s.exists ? `mtimeMs=${s.mtimeMs} size=${s.size}` : "(absent)";
}

async function assertSandboxPortsFree() {
  for (const port of [SANDBOX_PORT, CDP_PORT]) {
    if (await isPortListening(port)) {
      const { stdout } = await execFileP("lsof", [
        "-nP",
        `-iTCP:${port}`,
      ]).catch((err) => ({ stdout: err.stdout ?? "" }));
      throw new Error(
        `PANEL-100-STALE-PORT: :${port} is already held before this run started, a prior run of ` +
          `this file likely leaked a process. Kill it and confirm the port refuses a connection ` +
          `before rerunning:\n${stdout}`,
      );
    }
  }
}

async function checkPortsHeld() {
  try {
    const args = [SANDBOX_PORT, CDP_PORT].flatMap((p) => ["-i", `:${p}`]);
    const { stdout } = await execFileP("lsof", args).catch((err) => ({
      stdout: err.stdout ?? "",
    }));
    const held = stdout.trim() !== "";
    if (held)
      console.error(
        `ASSERTION: sandbox ports still held after teardown:\n${stdout}`,
      );
    return held;
  } catch {
    return false;
  }
}

function readFlag(argv, name) {
  const idx = argv.indexOf(name);
  return idx >= 0 ? (argv[idx + 1] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Navigation and DOM-lookup helpers, shared by every check and the drag
// primitive. Every selector below keys on rendered leaf text or DOM
// structure, never on an aria-label prefix attribute (Trap 3).
// ---------------------------------------------------------------------------

/** Locates a card root ANYWHERE on the board (searches every `[data-column]`), the same idiom
 * `panel-99.mjs`'s own `panel99FindCardRoot` uses. Throws on zero matches and on more than one. */
const FIND_CARD_SRC = `
  function panel100FindCardRoot(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var columns = Array.prototype.slice.call(root.querySelectorAll("[data-column]"));
    var matches = [];
    columns.forEach(function (col) {
      var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
      if (!scrollContainer) return;
      var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
        return el.tagName === "DIV";
      });
      cardRoots.forEach(function (el) {
        if (el.textContent.indexOf(identifier) !== -1) matches.push(el);
      });
    });
    if (matches.length === 0) throw new Error("panel100: card " + identifier + " not found on board");
    if (matches.length > 1) throw new Error("panel100: identifier " + identifier + " matched " + matches.length + " card roots");
    return matches[0];
  }
`;

/** Locates a card root SCOPED to one column, the exact convention `100-01-PLAN.md`'s <interfaces>
 * block locks (copied from `density-91.mjs:505-540`). Throws on zero matches and on more than one
 * match, never returns an ambiguous element. */
const FIND_CARD_IN_COLUMN_SRC = `
  function panel100FindCardInColumn(column, identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var col = root.querySelector('[data-column="' + column + '"]');
    if (!col) throw new Error("panel100: column not found: " + column);
    var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
    if (!scrollContainer) throw new Error("panel100: scroll container not found in column " + column);
    var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
      return el.tagName === "DIV";
    });
    var matches = cardRoots.filter(function (el) { return el.textContent.indexOf(identifier) !== -1; });
    if (matches.length === 0) throw new Error("panel100: card " + identifier + " not found in column " + column);
    if (matches.length > 1) throw new Error("panel100: identifier " + identifier + " matched " + matches.length + " card roots in column " + column);
    return matches[0];
  }
`;

/** Reports which column (its `data-column` value) currently contains `identifier`'s card root, or
 * `null` if it is in none of them (never throws "not found", since a mid-drag card genuinely may be
 * transiently absent from every column's DOM list for zero polls). */
const FIND_CARD_COLUMN_SRC = `
  function panel100CardColumnOf(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var columns = Array.prototype.slice.call(root.querySelectorAll("[data-column]"));
    var found = null;
    columns.forEach(function (col) {
      var scrollContainer = col.querySelector(":scope > .scroll-stable-y");
      if (!scrollContainer) return;
      var cardRoots = Array.prototype.filter.call(scrollContainer.children, function (el) {
        return el.tagName === "DIV";
      });
      var matches = cardRoots.filter(function (el) { return el.textContent.indexOf(identifier) !== -1; });
      if (matches.length > 0) found = col.getAttribute("data-column");
    });
    return found;
  }
`;

/**
 * Locates the rendered `DragOverlay` node while a drag is active: an element carrying BOTH
 * `aria-hidden="true"` and `inert` (the exact pair `Board.tsx:368` spreads onto the overlay's
 * `CardView` root via `domProps`), whose text contains the dragged identifier, and whose subtree is
 * OUTSIDE every `[data-column]` container (this dnd-kit version renders `DragOverlay` in normal
 * React tree flow, not a `document.body` portal, verified against the installed `core.esm.js`,
 * which has no `createPortal` call in `DragOverlay`'s own source). Returns the OUTERMOST such node
 * (never an inner descendant that also happens to match), or `null` if none is found. Never throws
 * on absence; the caller (`assertDragActivated`) is the one place that decides absence is fatal.
 */
const FIND_OVERLAY_SRC = `
  function panel100FindOverlayNode(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var candidates = Array.prototype.filter.call(
      root.querySelectorAll('[aria-hidden="true"][inert]'),
      function (el) {
        return el.textContent.indexOf(identifier) !== -1 &&
          !el.closest("[data-column]") &&
          !el.closest("#activity-drawer");
      }
    );
    if (candidates.length === 0) return null;
    var outer = candidates.filter(function (el) {
      return !candidates.some(function (other) { return other !== el && other.contains(el); });
    });
    if (outer.length !== 1) {
      throw new Error("panel100: overlay node for " + identifier + " ambiguous, matched " + outer.length + " outermost candidates");
    }
    return outer[0];
  }
`;

/**
 * Locates `GroupStartModal`'s members container: `Modal` renders via `createPortal` straight onto
 * `document.body` (verified, `Modal.tsx`'s own `createPortal(..., document.body)` call), OUTSIDE
 * `#root` entirely, so this walks `document` directly rather than scoping to `#root` the way every
 * card/column locator above does. The container is identified structurally, never by an
 * attribute this phase's own break mutates (Trap 3): it is the `[role="dialog"]`'s descendant `div`
 * whose FIRST element child's text matches `Members (<n>)` (`GroupStartModal.tsx`'s
 * `Field section` label, always the members list's own first sibling). Returns `null`, never
 * throws, since the modal may legitimately not be open yet while a check polls for it.
 */
const FIND_MODAL_MEMBERS_SRC = `
  function panel100FindGroupModalMembersContainer() {
    var dialog = document.querySelector('[role="dialog"][aria-label="New group"]');
    if (!dialog) return null;
    var divs = Array.prototype.slice.call(dialog.querySelectorAll("div"));
    for (var i = 0; i < divs.length; i++) {
      var el = divs[i];
      var first = el.firstElementChild;
      if (first && /^Members \\(\\d+\\)$/.test((first.textContent || "").trim())) return el;
    }
    return null;
  }
`;

/** Reads the modal's Members label plus the identifier text of every row below it (`MemberRow.tsx`'s
 * `Field mono` span, always each row's own first child), or `null` if the modal is not open. */
async function readGroupModalMembers(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `${FIND_MODAL_MEMBERS_SRC}(function () {
      var container = panel100FindGroupModalMembersContainer();
      if (!container) return null;
      var rows = Array.prototype.slice.call(container.children).slice(1);
      return {
        label: container.firstElementChild.textContent.trim(),
        identifiers: rows.map(function (row) {
          var first = row.firstElementChild;
          return first ? (first.textContent || "").trim() : null;
        }),
      };
    })()`,
  );
}

/** Centre point and geometry of a card root scoped to `column`, throwing per
 * `FIND_CARD_IN_COLUMN_SRC`'s own zero/many-match discipline. */
async function findCardRect(cdp, sessionId, column, identifier) {
  return evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_IN_COLUMN_SRC}(function () {
      var el = panel100FindCardInColumn(${JSON.stringify(column)}, ${JSON.stringify(identifier)});
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
    })()`,
  );
}

/** A point inside `[data-column="<column>"]` that is NOT on top of any card: the column rect's
 * horizontal centre, at a y a fixed distance below the column's own sticky header (the same
 * sticky-header derivation `density-91.mjs`'s `MEASURE_EXPR` uses), so the drop resolves to the
 * column droppable rather than a specific card's droppable/sortable target. */
async function columnDropPoint(cdp, sessionId, column) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var root = document.getElementById("root");
      if (!root) throw new Error("panel100: board root #root not found");
      var col = root.querySelector('[data-column="' + ${JSON.stringify(column)} + '"]');
      if (!col) throw new Error("panel100: column not found: " + ${JSON.stringify(column)});
      var header = null;
      for (var i = 0; i < col.children.length; i++) {
        var child = col.children[i];
        if (getComputedStyle(child).position === "sticky") { header = child; break; }
      }
      if (!header) throw new Error("panel100: sticky header not found in column " + ${JSON.stringify(column)});
      var colRect = col.getBoundingClientRect();
      var headerRect = header.getBoundingClientRect();
      return { x: colRect.left + colRect.width / 2, y: headerRect.bottom + 24 };
    })()`,
  );
}

/**
 * `mousePressed` at the card's centre, then four `mouseMoved` steps interpolating to `target` with
 * `buttons: 1` and a 20ms sleep between each (the `panel-mount-92.mjs:756-805` recipe, proven there
 * for a plain `onPointerDown` resize handle and applied here, for the first time in this repo,
 * against a real dnd-kit `useDraggable`/`MouseSensor` card). Deliberately issues NO
 * `mouseReleased`, the caller decides when the drag ends. Asserts NUMERICALLY that the first
 * interpolated step displaces more than 5px, since `Board.tsx`'s `{ distance: 5 }` activation
 * constraint never fires for a shorter first move, throwing rather than silently proceeding with a
 * drag that never activates.
 */
async function beginDrag(cdp, sessionId, column, identifier, target) {
  const rect = await findCardRect(cdp, sessionId, column, identifier);
  const x0 = rect.x;
  const y0 = rect.y;
  const x1 = target.x;
  const y1 = target.y;
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: x0,
      y: y0,
      button: "left",
      buttons: 1,
      clickCount: 1,
    },
    sessionId,
  );
  const fracs = [0.25, 0.5, 0.75, 1];
  let firstStepDisplacement = null;
  for (let i = 0; i < fracs.length; i++) {
    const frac = fracs[i];
    const x = x0 + (x1 - x0) * frac;
    const y = y0 + (y1 - y0) * frac;
    if (i === 0) firstStepDisplacement = Math.hypot(x - x0, y - y0);
    await cdp.send(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x, y, buttons: 1 },
      sessionId,
    );
    await sleep(20);
  }
  if (firstStepDisplacement == null || firstStepDisplacement <= 5) {
    throw new Error(
      `beginDrag: ${identifier}, first interpolated move step displaced only ${firstStepDisplacement}px, ` +
        `must exceed 5px to clear dnd-kit's { distance: 5 } activation constraint (Board.tsx), ` +
        `the drag would never activate`,
    );
  }
  return { x: x1, y: y1 };
}

/**
 * `mouseMoved` to `point` while the button is held (`buttons: 1`), for callers that need to
 * relocate an already-activated drag to a DIFFERENT column than the one `beginDrag` targeted before
 * releasing (e.g. the harmless same-column drops this phase's own checks use: drag "toward" one
 * column for the mid-drag reading, then move back over `todo` before `endDrag`, so the drop actually
 * resolves against `todo`'s droppable rather than wherever the LAST real `mousemove` landed). dnd-kit
 * tracks collision purely from the most recent `mousemove` coordinates, never from `mouseReleased`'s
 * own x/y, so `endDrag` alone at a different point than the drag's last move does NOT change where
 * the drop resolves; this bridges that gap.
 */
async function moveDragTo(cdp, sessionId, point) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: point.x, y: point.y, buttons: 1 },
    sessionId,
  );
  // A single large jump (e.g. from over "done" back to over "todo") observably raced dnd-kit's own
  // collision re-measurement in this harness: MSD-A landed in an UNRELATED intermediate column
  // ("in_review") because `endDrag` fired before the post-jump collision recompute had settled. A
  // second identical dispatch, after a real settle sleep, forces one more measurement pass against
  // the STABLE final coordinates before the caller is allowed to release the button.
  await sleep(150);
  await cdp.send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: point.x, y: point.y, buttons: 1 },
    sessionId,
  );
  await sleep(150);
}

/** `mouseReleased` at `point`, then a settle sleep so the resulting `onDragEnd`/optimistic-update
 * work has a chance to run before the caller reads any post-drop DOM state. */
async function endDrag(cdp, sessionId, point) {
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    },
    sessionId,
  );
  await sleep(150);
}

/**
 * THE LOAD-BEARING SELF-PROOF (see header). Called while the mouse button is still down (between
 * `beginDrag` and `endDrag`). Reads, in one `Runtime.evaluate` round trip: (a) whether a
 * `DragOverlay` node for `identifier` exists outside every `[data-column]` container, and (b) the
 * SOURCE card root's computed `opacity`. THROWS, never records a violation and returns, if the
 * overlay is absent or the opacity is not exactly `"0.4"`, naming the identifier and both readings.
 * A silent "no overlay, carry on" here would turn every later check in this phase into a dead
 * instrument, since they all call this first.
 */
async function assertDragActivated(cdp, sessionId, identifier) {
  const reading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${FIND_OVERLAY_SRC}(function () {
      var card = panel100FindCardRoot(${JSON.stringify(identifier)});
      var overlay = panel100FindOverlayNode(${JSON.stringify(identifier)});
      return {
        cardOpacity: getComputedStyle(card).opacity,
        overlayFound: overlay != null,
      };
    })()`,
  );
  if (!reading.overlayFound) {
    throw new Error(
      `assertDragActivated: ${identifier}, no DragOverlay node found outside any [data-column] ` +
        `container while the mouse button is held down; the drag never activated ` +
        `(cardOpacity measured ${JSON.stringify(reading.cardOpacity)})`,
    );
  }
  if (reading.cardOpacity !== "0.4") {
    throw new Error(
      `assertDragActivated: ${identifier}, source card root opacity expected "0.4" ` +
        `(CardView.tsx's dimmed rendering, driven only by useDraggable().isDragging), measured ` +
        `${JSON.stringify(reading.cardOpacity)}; the drag never activated (overlayFound=${reading.overlayFound})`,
    );
  }
  return reading;
}

/**
 * The full single-card drag: `beginDrag`, `assertDragActivated` (throws if the drag never really
 * started), `endDrag`, then polls `cardColumnOf` until it reads `toColumn` or `RENDER_TIMEOUT_MS`
 * elapses. THROWS naming both `fromColumn` and `toColumn`, plus the last observed column, if the
 * card never settles into `toColumn`.
 */
async function dragCardToColumn(
  cdp,
  sessionId,
  fromColumn,
  identifier,
  toColumn,
) {
  const target = await columnDropPoint(cdp, sessionId, toColumn);
  const point = await beginDrag(cdp, sessionId, fromColumn, identifier, target);
  await assertDragActivated(cdp, sessionId, identifier);
  await endDrag(cdp, sessionId, point);

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(identifier)})`,
    );
    if (last === toColumn) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `dragCardToColumn: ${identifier} never settled into column "${toColumn}" (dragged from ` +
      `"${fromColumn}"), last observed column: ${JSON.stringify(last)}`,
  );
}

/** Finds a `"<n> selected"` span anywhere in the document (`SelectionBar.tsx`'s own text, which
 * only mounts at `count >= 2`). Used to prove NOTHING in this plan's baseline checks ever
 * constructs a selection, since every fixture card here is dragged or moved individually. */
const FIND_SELECTION_TEXT_SRC = `
  function panel100FindSelectionText() {
    var spans = Array.prototype.slice.call(document.querySelectorAll("span"));
    var match = spans.find(function (s) { return /^\\d+ selected$/.test((s.textContent || "").trim()); });
    return match ? match.textContent : null;
  }
`;

/** Polls `cardColumnOf` until it reads `toColumn` or `timeoutMs` elapses, returning the LAST
 * observed value either way (never throws). Unlike `dragCardToColumn`'s own poll, this is used by
 * checks that must report a wrong MEASURED column as a named violation rather than an exception,
 * so a `--break` leg's trip output never degrades to an opaque "not found"/timeout message. */
async function pollUntilColumn(
  cdp,
  sessionId,
  identifier,
  toColumn,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(identifier)})`,
    );
    if (last === toColumn) return last;
    await sleep(POLL_INTERVAL_MS);
  }
  return last;
}

/** Polls until `identifier`'s card renders a button whose text contains "Move to" (`CardView.tsx`,
 * gated `isCarousel && onMoveTo`), i.e. until the narrow-viewport carousel layout has actually
 * activated after a `Emulation.setDeviceMetricsOverride` resize. */
async function waitForMoveToButton(cdp, sessionId, identifier) {
  const probe = `${FIND_CARD_SRC}(function () {
    var card = panel100FindCardRoot(${JSON.stringify(identifier)});
    var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
    return buttons.some(function (b) { return (b.textContent || "").indexOf("Move to") !== -1; });
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel100: "Move to..." button for ${identifier} never appeared within ${RENDER_TIMEOUT_MS}ms (isCarousel may not have activated)`,
  );
}

/** Clicks `identifier`'s "Move to..." button (a native `.click()`, so React's delegated `onClick`
 * fires exactly as a real mouse click would, the same idiom `panel-99.mjs`'s own
 * `clickCardByIdentifier` uses). Throws if the button cannot be found; this is a setup step, not
 * the assertion under test. */
async function clickMoveToButton(cdp, sessionId, identifier) {
  await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}(function () {
      var card = panel100FindCardRoot(${JSON.stringify(identifier)});
      var buttons = Array.prototype.slice.call(card.querySelectorAll("button"));
      var btn = buttons.find(function (b) { return (b.textContent || "").indexOf("Move to") !== -1; });
      if (!btn) throw new Error("panel100: Move to... button not found for " + ${JSON.stringify(identifier)});
      btn.click();
      return true;
    })()`,
  );
}

/** Polls until `MoveToPicker`'s own `role="group" aria-label="Move <identifier> to"` container
 * (`MoveToPicker.tsx:85`) is present. */
async function waitForPickerGroup(cdp, sessionId, identifier) {
  const probe = `(function () {
    return document.querySelector('[role="group"][aria-label="Move ' + ${JSON.stringify(identifier)} + ' to"]') != null;
  })()`;
  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await evalValue(cdp, sessionId, probe)) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `panel100: MoveToPicker group for ${identifier} never appeared within ${RENDER_TIMEOUT_MS}ms`,
  );
}

/**
 * Clicks the picker entry whose rendered text equals `columnLabel` (e.g. `"Done"`, the exact
 * `COLUMN_LABELS` string `MoveToPicker.tsx` renders, imported from `lib/event-copy.js`) inside
 * `identifier`'s already-open picker group. Returns `true` if the entry was found and clicked,
 * `false` if the group or the entry is absent, NEVER throws: the `keyboard-unchanged` break
 * deliberately detaches the "Done" entry before calling this, and the resulting check must fall
 * through to its own column-poll (reporting a named wrong MEASURED column) rather than an opaque
 * exception, matching `single-card-unchanged`'s own break discipline.
 */
async function clickPickerColumn(cdp, sessionId, identifier, columnLabel) {
  return evalValue(
    cdp,
    sessionId,
    `(function () {
      var group = document.querySelector('[role="group"][aria-label="Move ' + ${JSON.stringify(identifier)} + ' to"]');
      if (!group) return false;
      var buttons = Array.prototype.slice.call(group.querySelectorAll("button"));
      var btn = buttons.find(function (b) { return (b.textContent || "").trim() === ${JSON.stringify(columnLabel)}; });
      if (!btn) return false;
      btn.click();
      return true;
    })()`,
  );
}

// ---------------------------------------------------------------------------
// Checks. The two DRAG-05 baseline checks this plan pins: single-card drag
// and the carousel keyboard "Move to..." path must behave exactly as they
// do today, unaffected by every later plan in this phase. Both checks and
// both break legs run against the UNCHANGED tree (this plan touches no
// src/ file), so the expected outcome is already known and the break legs
// below prove the instrument itself, not a regression.
// ---------------------------------------------------------------------------

/**
 * Shared body for `single-card-unchanged`: with no selection anywhere on the board, drags MSD-A
 * from `todo` to `done` via the real drag primitive and asserts every DRAG-05 "unchanged" property
 * at once. `preDragHook`, when provided, runs AFTER the drop-target point is captured but BEFORE
 * `beginDrag` (i.e. before `mousedown`), letting `runBreakSingleCardUnchanged` remove the `done`
 * droppable's DOM node before dnd-kit ever measures it. This timing is load-bearing, empirically
 * proven by this file's own diagnostic run: dnd-kit caches each droppable's rect at
 * `handleDragStart` and does not re-measure a node it removed AFTER activation, so a mid-drag
 * removal (the timing this plan's own interfaces block first described) leaves the CACHED
 * pre-removal rect live for collision purposes and the drop silently SUCCEEDS server-side, a false
 * negative for this break. Removing the node before the drag starts means dnd-kit's very first
 * measurement reads a detached node's `getBoundingClientRect()`, which browsers return as an
 * all-zero rect, so no drop point can ever intersect it.
 */
async function performSingleCardDragCheck(
  cdp,
  sessionId,
  violations,
  preDragHook,
) {
  const preText = await evalValue(
    cdp,
    sessionId,
    `${FIND_SELECTION_TEXT_SRC}panel100FindSelectionText()`,
  );
  if (preText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${preText}" selection text present before the drag started`,
    );
  }

  const target = await columnDropPoint(cdp, sessionId, "done");

  if (preDragHook) await preDragHook(cdp, sessionId);

  const point = await beginDrag(
    cdp,
    sessionId,
    "todo",
    MSD_A_IDENTIFIER,
    target,
  );
  await assertDragActivated(cdp, sessionId, MSD_A_IDENTIFIER);

  const midReading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_IN_COLUMN_SRC}${FIND_OVERLAY_SRC}${FIND_SELECTION_TEXT_SRC}(function () {
      var overlay = panel100FindOverlayNode(${JSON.stringify(MSD_A_IDENTIFIER)});
      var source = panel100FindCardInColumn("todo", ${JSON.stringify(MSD_A_IDENTIFIER)});
      if (!overlay) return { overlayFound: false, selectionText: panel100FindSelectionText() };
      var overlayRect = overlay.getBoundingClientRect();
      var sourceRect = source.getBoundingClientRect();
      var candidates = [overlay].concat(Array.prototype.slice.call(overlay.querySelectorAll("*")));
      var faceCount = 0;
      candidates.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (getComputedStyle(el).borderRadius === "6px" && r.width > 0 && r.height > 0) faceCount++;
      });
      return {
        overlayFound: true,
        overlayWidth: overlayRect.width,
        sourceWidth: sourceRect.width,
        faceCount: faceCount,
        selectionText: panel100FindSelectionText(),
      };
    })()`,
  );

  if (!midReading.overlayFound) {
    violations.push(
      `single-card-unchanged: DragOverlay node for MSD-A unexpectedly absent mid-flight (assertDragActivated should have caught this)`,
    );
  } else {
    if (midReading.faceCount !== 1) {
      violations.push(
        `single-card-unchanged: overlay face count expected 1, measured ${midReading.faceCount}`,
      );
    }
    if (Math.abs(midReading.overlayWidth - midReading.sourceWidth) > 1) {
      violations.push(
        `single-card-unchanged: overlay width expected within 1px of source card width ${midReading.sourceWidth}, measured ${midReading.overlayWidth}`,
      );
    }
  }
  if (midReading.selectionText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${midReading.selectionText}" selection text present mid-drag`,
    );
  }

  await endDrag(cdp, sessionId, point);

  const finalA = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_A_IDENTIFIER,
    "done",
    RENDER_TIMEOUT_MS,
  );
  if (finalA !== "done") {
    violations.push(
      `single-card-unchanged: MSD-A expected column "done", measured ${JSON.stringify(finalA)}`,
    );
  }
  for (const id of [MSD_B_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (col !== "todo") {
      violations.push(
        `single-card-unchanged: ${id} expected column "todo", measured ${JSON.stringify(col)}`,
      );
    }
  }

  const postText = await evalValue(
    cdp,
    sessionId,
    `${FIND_SELECTION_TEXT_SRC}panel100FindSelectionText()`,
  );
  if (postText != null) {
    violations.push(
      `single-card-unchanged: unexpected "${postText}" selection text present after the drag ended`,
    );
  }
}

/** DRAG-05 baseline: dragging a single, unselected card moves exactly that card, no selection
 * text ever appears, and the overlay stays byte-for-byte today's single-card shape (one face, the
 * source card's own width). */
async function checkSingleCardUnchanged(cdp, sessionId, violations) {
  await performSingleCardDragCheck(cdp, sessionId, violations, null);
}

/**
 * Shared body for `keyboard-unchanged`: resizes to the carousel breakpoint, opens MSD-B's "Move
 * to..." picker, clicks its "Done" entry, and asserts MSD-B alone changed column. Snapshots
 * MSD-A/C/D's columns BEFORE acting and compares against those exact values afterward (rather than
 * assuming they start in `todo`), so this check stays correct regardless of whether
 * `single-card-unchanged` already moved MSD-A to `done` earlier in the same run. `preClickHook`,
 * when provided, runs after the picker group is confirmed open and BEFORE the "Done" entry is
 * clicked, letting `runBreakKeyboardUnchanged` detach that entry first.
 */
async function performKeyboardCheckBody(
  cdp,
  sessionId,
  violations,
  preClickHook,
) {
  const before = {};
  for (const id of [MSD_A_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    before[id] = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
  }

  await waitForMoveToButton(cdp, sessionId, MSD_B_IDENTIFIER);
  await clickMoveToButton(cdp, sessionId, MSD_B_IDENTIFIER);
  await waitForPickerGroup(cdp, sessionId, MSD_B_IDENTIFIER);

  if (preClickHook) await preClickHook(cdp, sessionId);

  await clickPickerColumn(cdp, sessionId, MSD_B_IDENTIFIER, "Done");

  const finalB = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_B_IDENTIFIER,
    "done",
    RENDER_TIMEOUT_MS,
  );
  if (finalB !== "done") {
    violations.push(
      `keyboard-unchanged: MSD-B expected column "done", measured ${JSON.stringify(finalB)}`,
    );
  }
  for (const id of [MSD_A_IDENTIFIER, MSD_C_IDENTIFIER, MSD_D_IDENTIFIER]) {
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (col !== before[id]) {
      violations.push(
        `keyboard-unchanged: ${id} expected column ${JSON.stringify(before[id])} (unmoved), measured ${JSON.stringify(col)}`,
      );
    }
  }
}

/** DRAG-05 baseline: the carousel "Move to..." keyboard-accessible path moves exactly the one
 * card it targets, leaving every other card's column untouched. Restores the 1600x1000 viewport
 * in a `finally` so no later check in the same run ever inherits the narrow carousel layout. */
async function checkKeyboardUnchanged(cdp, sessionId, violations) {
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  try {
    await performKeyboardCheckBody(cdp, sessionId, violations, null);
  } finally {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 100 plan 05: real ctrl-click selection, the stacked-overlay check,
// the overlay-unchanged-n1 check, and the a11y check (DRAG-03). Every
// selection below is built by real Input.dispatchMouseEvent ctrl-clicks,
// never by writing selectedIds/React state directly (RESEARCH Pitfall 2,
// 99-REVIEW.md CR-02's own root cause for this milestone). Every deck/overlay
// lookup reuses a structural locator, never an aria-label prefix and never a
// data-* attribute this phase's own code writes (Trap 3).
//
// RUN ORDER IS LOAD-BEARING: these three checks are registered BEFORE
// single-card-unchanged/keyboard-unchanged in CHECKS below, deliberately.
// single-card-unchanged permanently drags MSD-A into "done" and
// keyboard-unchanged permanently moves MSD-B into "done" (that IS what those
// two DRAG-05 baseline checks assert), so within one full-suite invocation
// (`node scripts/panel-100.mjs`, one seed, one board session, every
// registered check run back to back in CHECKS' own key order) MSD-A/MSD-B
// would no longer be selection-eligible (Card.tsx's ctrl-click branch
// requires `card.column === "todo"`) by the time a later check tried to
// ctrl-click them. Every check in this block only ever performs SAME-COLUMN
// (todo-to-todo) harmless drops, so MSD-A..D stay in "todo" throughout, but
// that guarantee only holds if this block's checks run first.
// ---------------------------------------------------------------------------

/**
 * Locates the TRUE dnd-kit `DragOverlay` portal node: the element whose computed `position` is
 * `fixed` (matching `PositionedOverlay`'s own inline `position: 'fixed'` base style,
 * `node_modules/@dnd-kit/core/dist/core.esm.js:3630-3676`), whose subtree contains `identifier`, and
 * which has no `[data-column]` ancestor. Distinct from `FIND_OVERLAY_SRC` (plan 01), which finds the
 * `aria-hidden`/`inert` node THIS PHASE's own JSX sets (the deck container or the bare `CardView`
 * root); this one finds dnd-kit's own wrapper one level further out, load-bearing for
 * `overlay-unchanged-n1`'s "no intervening wrapper" assertion, which needs to inspect what is
 * DIRECTLY inside dnd-kit's real overlay node. Never keys on an attribute this phase's own code
 * writes.
 */
const FIND_FIXED_OVERLAY_SRC = `
  function panel100FindFixedOverlayNode(identifier) {
    var root = document.getElementById("root");
    if (!root) throw new Error("panel100: board root #root not found");
    var candidates = Array.prototype.filter.call(
      root.querySelectorAll("*"),
      function (el) {
        // Cheap string search FIRST, expensive getComputedStyle() only on the tiny surviving set:
        // scanning every element in the tree with getComputedStyle() up front (forcing a style
        // recalc per element) measurably degraded this harness under repeated drags in one long
        // session.
        return el.textContent.indexOf(identifier) !== -1 &&
          !el.closest("[data-column]") &&
          !el.closest("#activity-drawer") &&
          getComputedStyle(el).position === "fixed";
      }
    );
    if (candidates.length === 0) return null;
    var outer = candidates.filter(function (el) {
      return !candidates.some(function (other) { return other !== el && other.contains(el); });
    });
    if (outer.length !== 1) {
      throw new Error("panel100: fixed overlay node for " + identifier + " ambiguous, matched " + outer.length + " outermost candidates");
    }
    return outer[0];
  }
`;

/** Finds a `"<n> selected"` span's current text, or `null` if none is mounted (`SelectionBar.tsx`
 * only mounts at `count >= 2`). */
async function readSelectionText(cdp, sessionId) {
  return evalValue(
    cdp,
    sessionId,
    `${FIND_SELECTION_TEXT_SRC}panel100FindSelectionText()`,
  );
}

/**
 * A REAL multi-select click: `mousePressed` then `mouseReleased` at the card's centre with
 * `modifiers: 4` (CDP's Meta/Command bit) and `clickCount: 1`, matching `Card.tsx`'s own
 * eligibility branch (`event.metaKey || event.ctrlKey`, gated on `column === "todo" && groupId ==
 * null && source !== "group"`). Never writes `selectedIds` or any React state directly (RESEARCH
 * Pitfall 2, `99-REVIEW.md` CR-02's own root cause for this milestone).
 *
 * USES META (Cmd), NOT CTRL, DELIBERATELY: an instrumented diagnostic run of this file
 * (`cdp-click-test.mjs`, a throwaway isolated-page harness) proved that on this macOS Chrome build
 * (151.0.7922.170, `--headless=new`), `Input.dispatchMouseEvent`'s `modifiers: 2` (Ctrl) bit
 * SUPPRESSES the native `click` event synthesis entirely, on EVERY element tested, even a plain
 * unstyled `<div>` on a `data:` URL with zero app code involved: `mousedown`/`mouseup` both fire
 * with `ctrlKey: true`, but no `click` DOM event ever follows, exactly macOS's own long-standing
 * "Control+click == secondary click" convention (Chrome routes it toward a context-menu gesture,
 * not a left-click), so React's `onClick` (which only ever fires from a genuine `click` event) never
 * sees it. `modifiers: 4` (Meta/Command), verified against the same isolated page, produces a normal
 * `click` with `metaKey: true`, and `Card.tsx`'s own eligibility check already accepts EITHER
 * modifier for exactly this cross-platform reason. This file's own `100-01-PLAN.md`-era
 * `<interfaces>` note ("CDP's `modifiers` bit for Ctrl is 2") is correct about the bit VALUE but
 * silent on this platform-specific interception; documented here so a later plan does not
 * rediscover the same 45-minute trap.
 */
async function ctrlClickCard(cdp, sessionId, column, identifier) {
  const rect = await findCardRect(cdp, sessionId, column, identifier);
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 4,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: rect.x,
      y: rect.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 4,
    },
    sessionId,
  );
  await sleep(120);
}

/** A real `Escape` keydown/keyup pair via CDP (`Board.tsx`'s own `window.addEventListener("keydown",
 * ...)` handler turns this into `setSelectedIds(new Set())`), never a direct state write. */
async function clearSelectionViaEscape(cdp, sessionId) {
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },
    sessionId,
  );
  await cdp.send(
    "Input.dispatchKeyEvent",
    {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
      nativeVirtualKeyCode: 27,
    },
    sessionId,
  );
  await sleep(150);
}

/**
 * Ctrl-clicks every identifier in column "todo" in order, THROWS (never records a violation and
 * continues, per T-100-16) unless the resulting `SelectionBar` text is exactly `"<identifiers.length>
 * selected"`. A selection the harness fabricated, or a click that silently failed to register, would
 * make every later assertion in this file meaningless (RESEARCH Pitfall 2).
 */
async function selectCardsByIdentifier(cdp, sessionId, identifiers) {
  for (const identifier of identifiers) {
    await ctrlClickCard(cdp, sessionId, "todo", identifier);
  }
  const text = await readSelectionText(cdp, sessionId);
  const expected = `${identifiers.length} selected`;
  if (text !== expected) {
    throw new Error(
      `selectCardsByIdentifier: expected SelectionBar text "${expected}" after ctrl-clicking ${JSON.stringify(identifiers)}, measured ${JSON.stringify(text)}`,
    );
  }
}

/**
 * `stacked-overlay` leg body: drags MSD-B toward `done` (the release always lands back on `todo`, a
 * harmless same-column drop, so nothing ever actually moves), reads the deck's geometry and badge
 * while the button is down, and asserts against the SHARED overlay lookup (`FIND_OVERLAY_SRC`, plan
 * 01), never an aria-label or a data-* value this phase's own code writes. `mutateHook`/`restoreHook`,
 * when provided, run immediately after `assertDragActivated` proves the deck exists (mutate) and
 * immediately after this leg's own reading captures the trip (restore), mirroring plan 01's
 * `preDragHook` discipline.
 */
async function performStackedOverlayLeg(
  cdp,
  sessionId,
  violations,
  legLabel,
  expectedN,
  expectedBackFaceCount,
  mutateHook,
  restoreHook,
) {
  const doneTarget = await columnDropPoint(cdp, sessionId, "done");
  const todoTarget = await columnDropPoint(cdp, sessionId, "todo");
  await beginDrag(cdp, sessionId, "todo", MSD_B_IDENTIFIER, doneTarget);
  await assertDragActivated(cdp, sessionId, MSD_B_IDENTIFIER);

  if (mutateHook) await mutateHook(cdp, sessionId);

  const reading = await evalValue(
    cdp,
    sessionId,
    `${FIND_OVERLAY_SRC}(function () {
      var overlay = panel100FindOverlayNode(${JSON.stringify(MSD_B_IDENTIFIER)});
      if (!overlay) throw new Error("panel100: deck overlay not found for MSD-B");
      var kids = Array.prototype.slice.call(overlay.children);
      var backFaces = [];
      var badge = null;
      var cardRoot = null;
      kids.forEach(function (el) {
        var s = getComputedStyle(el);
        var text = (el.textContent || "").trim();
        if (s.position === "absolute" && s.borderRadius === "6px" && el.children.length === 0 && text === "") {
          backFaces.push(el);
        } else if (s.position === "absolute" && /^\\d+$/.test(text)) {
          badge = el;
        } else if (s.position === "relative" && text.indexOf(${JSON.stringify(MSD_B_IDENTIFIER)}) !== -1) {
          cardRoot = el;
        }
      });
      var probe = document.createElement("div");
      probe.style.backgroundColor = "var(--accent)";
      document.body.appendChild(probe);
      var expectedAccentBackground = getComputedStyle(probe).backgroundColor;
      probe.remove();
      var frontRect = cardRoot ? cardRoot.getBoundingClientRect() : null;
      var faceReadings = backFaces.map(function (el) {
        var r = el.getBoundingClientRect();
        return {
          transform: getComputedStyle(el).transform,
          zIndex: getComputedStyle(el).zIndex,
          textContent: el.textContent,
          rect: { left: r.left, top: r.top, width: r.width, height: r.height },
        };
      });
      // The whole DragOverlay subtree inherits pointer-events:none, which makes
      // elementFromPoint blind to it; re-enabling it on the deck container alone for the
      // duration of this one hit test is the only way to read real paint order, and
      // pointer-events has no effect on painting so the reading is unperturbed.
      var restorePointerEvents = overlay.style.pointerEvents;
      var hadInert = overlay.hasAttribute("inert");
      overlay.style.pointerEvents = "auto";
      if (hadInert) overlay.removeAttribute("inert");
      var probePointerEvents = cardRoot ? getComputedStyle(cardRoot).pointerEvents : null;
      var hit = frontRect
        ? document.elementFromPoint(frontRect.left + frontRect.width / 2, frontRect.top + frontRect.height / 2)
        : null;
      if (hadInert) overlay.setAttribute("inert", "");
      overlay.style.pointerEvents = restorePointerEvents;
      var hitRole = "outside the deck overlay";
      if (hit == null) hitRole = "nothing";
      else if (hit === cardRoot || (cardRoot && cardRoot.contains(hit))) hitRole = "the front CardView face";
      else if (backFaces.indexOf(hit) !== -1) hitRole = "the deck back face at index " + backFaces.indexOf(hit);
      else if (hit === overlay) hitRole = "the bare deck container";
      else if (overlay.contains(hit)) hitRole = "some other deck overlay descendant";
      return {
        cardRootFound: cardRoot != null,
        backFaceCount: backFaces.length,
        faces: faceReadings,
        frontRect: frontRect ? { left: frontRect.left, top: frontRect.top, width: frontRect.width, height: frontRect.height } : null,
        frontOnTop: cardRoot != null && hit != null && (hit === cardRoot || cardRoot.contains(hit)),
        frontZIndex: cardRoot ? getComputedStyle(cardRoot).zIndex : null,
        hitRole: hitRole,
        hitTag: hit ? hit.tagName.toLowerCase() : null,
        probePointerEvents: probePointerEvents,
        deckIsolation: getComputedStyle(overlay).isolation,
        deckZIndex: getComputedStyle(overlay).zIndex,
        badgeFound: badge != null,
        badgeText: badge ? badge.textContent : null,
        badgePosition: badge ? getComputedStyle(badge).position : null,
        badgeHeight: badge ? getComputedStyle(badge).height : null,
        badgeBorderRadius: badge ? getComputedStyle(badge).borderRadius : null,
        badgeBackgroundColor: badge ? getComputedStyle(badge).backgroundColor : null,
        expectedAccentBackground: expectedAccentBackground,
      };
    })()`,
  );

  if (restoreHook) await restoreHook(cdp, sessionId);

  if (!reading.cardRootFound) {
    violations.push(
      `stacked-overlay: ${legLabel}, front CardView root not classified within the deck overlay for MSD-B`,
    );
  }
  if (reading.backFaceCount !== expectedBackFaceCount) {
    violations.push(
      `stacked-overlay: ${legLabel}, expected ${expectedBackFaceCount} back faces, measured ${reading.backFaceCount}`,
    );
  }
  const faceExpectations = [
    {
      label: "8px back face",
      transform: "matrix(1, 0, 0, 1, 8, 8)",
      zIndex: "1",
      dx: 8,
      dy: 8,
    },
    {
      label: "4px back face",
      transform: "matrix(1, 0, 0, 1, 4, 4)",
      zIndex: "2",
      dx: 4,
      dy: 4,
    },
  ].slice(expectedBackFaceCount === 2 ? 0 : 1);
  for (let i = 0; i < faceExpectations.length; i++) {
    const exp = faceExpectations[i];
    const face = reading.faces[i];
    if (!face) {
      violations.push(
        `stacked-overlay: ${legLabel}, ${exp.label} missing at deck child index ${i}`,
      );
      continue;
    }
    if (face.transform !== exp.transform) {
      violations.push(
        `stacked-overlay: ${legLabel}, ${exp.label} transform expected ${JSON.stringify(exp.transform)}, measured ${JSON.stringify(face.transform)}`,
      );
    }
    if (face.zIndex !== exp.zIndex) {
      violations.push(
        `stacked-overlay: ${legLabel}, ${exp.label} z-index expected ${JSON.stringify(exp.zIndex)} (100-UI-SPEC.md layer table), measured ${JSON.stringify(face.zIndex)}`,
      );
    }
    if (face.textContent !== "") {
      violations.push(
        `stacked-overlay: ${legLabel}, ${exp.label} expected empty textContent, measured ${JSON.stringify(face.textContent)}`,
      );
    }
    if (reading.frontRect) {
      const expLeft = reading.frontRect.left + exp.dx;
      const expTop = reading.frontRect.top + exp.dy;
      const badRect =
        Math.abs(face.rect.left - expLeft) > 0.5 ||
        Math.abs(face.rect.top - expTop) > 0.5 ||
        Math.abs(face.rect.width - reading.frontRect.width) > 0.5 ||
        Math.abs(face.rect.height - reading.frontRect.height) > 0.5;
      if (badRect) {
        violations.push(
          `stacked-overlay: ${legLabel}, ${exp.label} rect expected left=${expLeft.toFixed(2)} top=${expTop.toFixed(2)} width=${reading.frontRect.width.toFixed(2)} height=${reading.frontRect.height.toFixed(2)} (front rect translated by (${exp.dx},${exp.dy})), measured left=${face.rect.left.toFixed(2)} top=${face.rect.top.toFixed(2)} width=${face.rect.width.toFixed(2)} height=${face.rect.height.toFixed(2)}`,
        );
      }
    }
  }
  if (reading.frontZIndex !== "3") {
    violations.push(
      `stacked-overlay: ${legLabel}, front CardView face z-index expected "3" (100-UI-SPEC.md layer table), measured ${JSON.stringify(reading.frontZIndex)}`,
    );
  }
  if (reading.deckIsolation !== "isolate" && reading.deckZIndex === "auto") {
    violations.push(
      `stacked-overlay: ${legLabel}, the deck container establishes no stacking context (isolation ${JSON.stringify(reading.deckIsolation)}, z-index ${JSON.stringify(reading.deckZIndex)}), so the layer table's z-indexes escape into the DragOverlay's own stacking context and no longer order the deck`,
    );
  }
  if (reading.cardRootFound && !reading.frontOnTop) {
    violations.push(
      `stacked-overlay: ${legLabel}, paint order, the element painted at the deck's centre point expected to be the front CardView face, measured ${reading.hitRole} (<${reading.hitTag}>, probe pointer-events ${JSON.stringify(reading.probePointerEvents)}); front z-index ${JSON.stringify(reading.frontZIndex)}, back face z-indexes ${JSON.stringify(reading.faces.map((f) => f.zIndex))}`,
    );
  }
  if (!reading.badgeFound) {
    violations.push(
      `stacked-overlay: ${legLabel}, count badge not found in the deck overlay`,
    );
  } else {
    if (reading.badgeText !== String(expectedN)) {
      violations.push(
        `stacked-overlay: ${legLabel}, badge text expected ${JSON.stringify(String(expectedN))}, measured ${JSON.stringify(reading.badgeText)}`,
      );
    }
    if (reading.badgePosition !== "absolute") {
      violations.push(
        `stacked-overlay: ${legLabel}, badge position expected "absolute", measured ${JSON.stringify(reading.badgePosition)}`,
      );
    }
    if (reading.badgeHeight !== "20px") {
      violations.push(
        `stacked-overlay: ${legLabel}, badge height expected "20px", measured ${JSON.stringify(reading.badgeHeight)}`,
      );
    }
    if (reading.badgeBorderRadius !== "10px") {
      violations.push(
        `stacked-overlay: ${legLabel}, badge border-radius expected "10px", measured ${JSON.stringify(reading.badgeBorderRadius)}`,
      );
    }
    if (reading.badgeBackgroundColor !== reading.expectedAccentBackground) {
      violations.push(
        `stacked-overlay: ${legLabel}, badge background-color expected ${JSON.stringify(reading.expectedAccentBackground)} (resolved --accent), measured ${JSON.stringify(reading.badgeBackgroundColor)}`,
      );
    }
  }

  await moveDragTo(cdp, sessionId, todoTarget);
  await endDrag(cdp, sessionId, todoTarget);

  for (const id of [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
    MSD_D_IDENTIFIER,
  ]) {
    const col = await pollUntilColumn(cdp, sessionId, id, "todo", 2000);
    if (col !== "todo") {
      violations.push(
        `stacked-overlay: ${legLabel}, ${id} expected column "todo" after the harmless same-column drop, measured ${JSON.stringify(col)}`,
      );
    }
  }
}

/**
 * `stacked-overlay`: selects MSD-A/B/C (N=3, real ctrl-clicks), runs leg A (N=3, expects 2 back
 * faces + badge "3"), drops to N=2 for leg A2 (1 back face, badge "2"), returns to N=3, adds MSD-D
 * (N=4), runs leg B (N=4, still 2 back faces, badge "4" not "3"), then ctrl-clicks MSD-D again to
 * return to a clean 3-selection. `legAMutateHook`/`legARestoreHook` are `runBreakStackedOverlay`'s
 * only injection point, applied to leg A alone (leg B always runs clean, sufficient once leg A has
 * already proven the instrument can fail).
 *
 * Leg A2 is 100-REVIEW WR-07's fix. N=2 is the deck's ONLY conditional boundary,
 * `DECK_BACK_OFFSETS_PX.slice(...)` in `Board.tsx`, and legs A and B both expect 2 back faces, so
 * that branch had zero coverage and `faceExpectations`'s own `slice(expectedBackFaceCount === 2 ? 0
 * : 1)` could never take its `1` arm: inverting the product's ternary passed the whole suite.
 */
async function checkStackedOverlay(
  cdp,
  sessionId,
  violations,
  legAMutateHook = null,
  legARestoreHook = null,
) {
  await selectCardsByIdentifier(cdp, sessionId, [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
  ]);

  await performStackedOverlayLeg(
    cdp,
    sessionId,
    violations,
    "leg A (N=3)",
    3,
    2,
    legAMutateHook,
    legARestoreHook,
  );

  await ctrlClickCard(cdp, sessionId, "todo", MSD_C_IDENTIFIER);
  const legA2SetupText = await readSelectionText(cdp, sessionId);
  if (legA2SetupText !== "2 selected") {
    throw new Error(
      `checkStackedOverlay: leg A2 setup expected SelectionBar text "2 selected" after ctrl-clicking MSD-C off, measured ${JSON.stringify(legA2SetupText)}`,
    );
  }

  await performStackedOverlayLeg(
    cdp,
    sessionId,
    violations,
    "leg A2 (N=2)",
    2,
    1,
    null,
    null,
  );

  await ctrlClickCard(cdp, sessionId, "todo", MSD_C_IDENTIFIER);
  const legA2RestoreText = await readSelectionText(cdp, sessionId);
  if (legA2RestoreText !== "3 selected") {
    throw new Error(
      `checkStackedOverlay: leg A2 teardown expected SelectionBar text "3 selected" after ctrl-clicking MSD-C back on, measured ${JSON.stringify(legA2RestoreText)}`,
    );
  }

  await ctrlClickCard(cdp, sessionId, "todo", MSD_D_IDENTIFIER);
  const legBSetupText = await readSelectionText(cdp, sessionId);
  if (legBSetupText !== "4 selected") {
    throw new Error(
      `checkStackedOverlay: leg B setup expected SelectionBar text "4 selected" after ctrl-clicking MSD-D, measured ${JSON.stringify(legBSetupText)}`,
    );
  }

  await performStackedOverlayLeg(
    cdp,
    sessionId,
    violations,
    "leg B (N=4)",
    4,
    2,
    null,
    null,
  );

  await ctrlClickCard(cdp, sessionId, "todo", MSD_D_IDENTIFIER);
  const afterText = await readSelectionText(cdp, sessionId);
  if (afterText !== "3 selected") {
    violations.push(
      `stacked-overlay: cleanup, expected SelectionBar text "3 selected" after returning MSD-D to unselected, measured ${JSON.stringify(afterText)}`,
    );
  }
}

/**
 * `overlay-unchanged-n1` leg body: drags MSD-A toward `done` (release always lands back on `todo`,
 * harmless), and while the button is down asserts the overlay is exactly today's byte-for-byte
 * single-card shape via `FIND_FIXED_OVERLAY_SRC` (the TRUE dnd-kit fixed-position node, one level
 * outside this phase's own `aria-hidden`/`inert` node): exactly one direct child, that child IS the
 * bare `CardView` root (no intervening deck wrapper), no absolutely-positioned inset:0 descendant (a
 * leaked back face) and no badge-shaped descendant anywhere in the overlay's subtree, and the
 * overlay's own card face has the same descendant-element count as the RESTING MSD-A card root read
 * in the same page state. `mutateHook`/`restoreHook` mirror `performStackedOverlayLeg`'s own
 * discipline.
 */
async function performOverlayUnchangedLeg(
  cdp,
  sessionId,
  violations,
  legLabel,
  mutateHook,
  restoreHook,
) {
  const doneTarget = await columnDropPoint(cdp, sessionId, "done");
  const todoTarget = await columnDropPoint(cdp, sessionId, "todo");
  await beginDrag(cdp, sessionId, "todo", MSD_A_IDENTIFIER, doneTarget);
  await assertDragActivated(cdp, sessionId, MSD_A_IDENTIFIER);

  if (mutateHook) await mutateHook(cdp, sessionId);

  const reading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_IN_COLUMN_SRC}${FIND_FIXED_OVERLAY_SRC}(function () {
      var fixedNode = panel100FindFixedOverlayNode(${JSON.stringify(MSD_A_IDENTIFIER)});
      if (!fixedNode) throw new Error("panel100: fixed overlay node not found for MSD-A");
      var kids = Array.prototype.slice.call(fixedNode.children);
      var child0 = kids[0];
      var child0Style = child0 ? getComputedStyle(child0) : null;
      var descendants = Array.prototype.slice.call(fixedNode.querySelectorAll("*"));
      var hasAbsoluteInsetZero = descendants.some(function (el) {
        var s = getComputedStyle(el);
        return s.position === "absolute" && s.top === "0px" && s.right === "0px" && s.bottom === "0px" && s.left === "0px";
      });
      var hasBadgeLike = descendants.some(function (el) {
        var s = getComputedStyle(el);
        var text = (el.textContent || "").trim();
        return s.position === "absolute" && /^\\d+$/.test(text);
      });
      var restingCard = panel100FindCardInColumn("todo", ${JSON.stringify(MSD_A_IDENTIFIER)});
      // Board.tsx's overlay CardView (both the N<=1 branch and the deck branch's front face) has
      // never wired a "multiSelected" prop, pre-existing and byte-for-byte unchanged by this phase
      // (100-03-SUMMARY.md's own diff), so the resting card's checkmark badge
      // (CardView.tsx:222-244, position:absolute borderRadius:50% 14x14) is the ONE legitimate,
      // out-of-scope descendant-count asymmetry the N=1 leg can hit (MSD-A selected alone). Excluded
      // from BOTH sides identically so a genuine deck/badge intrusion (a DIFFERENT shape, see
      // hasAbsoluteInsetZero/hasBadgeLike above) still trips this comparison.
      function countExcludingMultiSelectedBadge(cardRoot) {
        var count = cardRoot.querySelectorAll("*").length;
        var kids2 = Array.prototype.slice.call(cardRoot.children);
        var badge = kids2.find(function (el) {
          var s = getComputedStyle(el);
          return s.position === "absolute" && s.borderRadius === "50%" && s.width === "14px" && s.height === "14px";
        });
        if (badge) count -= 1 + badge.querySelectorAll("*").length;
        return count;
      }
      return {
        childCount: kids.length,
        child0IsCardRoot: !!(
          child0Style &&
          child0Style.position === "relative" &&
          child0Style.borderRadius === "6px" &&
          child0.textContent.indexOf(${JSON.stringify(MSD_A_IDENTIFIER)}) !== -1
        ),
        hasAbsoluteInsetZero: hasAbsoluteInsetZero,
        hasBadgeLike: hasBadgeLike,
        overlayCardDescCount: child0 ? countExcludingMultiSelectedBadge(child0) : null,
        restingDescCount: countExcludingMultiSelectedBadge(restingCard),
        totalFixedNodeDescCount: descendants.length,
      };
    })()`,
  );

  if (restoreHook) await restoreHook(cdp, sessionId);

  if (reading.childCount !== 1) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, expected exactly 1 face-level element directly under the fixed overlay node, measured ${reading.childCount}`,
    );
  }
  if (!reading.child0IsCardRoot) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, the overlay's single child is not the bare CardView root (expected no intervening wrapper)`,
    );
  }
  if (reading.hasAbsoluteInsetZero) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, found an unexpected absolutely-positioned inset:0 descendant (a deck back face) inside the N<=1 overlay`,
    );
  }
  if (reading.hasBadgeLike) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, found an unexpected badge-shaped descendant (absolute position, bare-integer text) inside the N<=1 overlay`,
    );
  }
  if (reading.overlayCardDescCount !== reading.restingDescCount) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, overlay card descendant-element count expected ${reading.restingDescCount} (same as the resting MSD-A card root in todo), measured ${reading.overlayCardDescCount}`,
    );
  }
  const expectedFixedNodeTotal = 1 + reading.overlayCardDescCount;
  if (reading.totalFixedNodeDescCount !== expectedFixedNodeTotal) {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, fixed overlay node's own descendant-element count expected ${expectedFixedNodeTotal} (the card root itself plus its own subtree, nothing else), measured ${reading.totalFixedNodeDescCount}`,
    );
  }

  await moveDragTo(cdp, sessionId, todoTarget);
  await endDrag(cdp, sessionId, todoTarget);
  const col = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_A_IDENTIFIER,
    "todo",
    2000,
  );
  if (col !== "todo") {
    violations.push(
      `overlay-unchanged-n1: ${legLabel}, MSD-A expected column "todo" after the harmless same-column drop, measured ${JSON.stringify(col)}`,
    );
  }
}

/**
 * `overlay-unchanged-n1`: clears any selection (real `Escape`), runs the N=0 leg (no selection at
 * all), ctrl-clicks MSD-A alone (N=1, `dragSelectionIds` returns `null` at `size < 2`, the exact
 * off-by-one boundary this check pins), runs the N=1 leg, then clears selection again so the next
 * check (`a11y`) starts clean. `leg0MutateHook`/`leg0RestoreHook` are `runBreakOverlayUnchangedN1`'s
 * only injection point, applied to the simpler N=0 leg alone.
 */
async function checkOverlayUnchangedN1(
  cdp,
  sessionId,
  violations,
  leg0MutateHook = null,
  leg0RestoreHook = null,
) {
  await clearSelectionViaEscape(cdp, sessionId);
  const clearedText = await readSelectionText(cdp, sessionId);
  if (clearedText != null) {
    violations.push(
      `overlay-unchanged-n1: setup, expected no SelectionBar text after Escape, measured ${JSON.stringify(clearedText)}`,
    );
  }

  await performOverlayUnchangedLeg(
    cdp,
    sessionId,
    violations,
    "N=0 leg",
    leg0MutateHook,
    leg0RestoreHook,
  );

  await ctrlClickCard(cdp, sessionId, "todo", MSD_A_IDENTIFIER);
  const n1Text = await readSelectionText(cdp, sessionId);
  if (n1Text != null) {
    violations.push(
      `overlay-unchanged-n1: setup, expected no SelectionBar text at N=1 (SelectionBar mounts only at count >= 2), measured ${JSON.stringify(n1Text)}`,
    );
  }

  await performOverlayUnchangedLeg(
    cdp,
    sessionId,
    violations,
    "N=1 leg",
    null,
    null,
  );

  for (const id of [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
    MSD_D_IDENTIFIER,
  ]) {
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (col !== "todo") {
      violations.push(
        `overlay-unchanged-n1: after check, ${id} expected column "todo", measured ${JSON.stringify(col)}`,
      );
    }
  }

  await clearSelectionViaEscape(cdp, sessionId);
  const finalText = await readSelectionText(cdp, sessionId);
  if (finalText != null) {
    violations.push(
      `overlay-unchanged-n1: after check, unexpected ${JSON.stringify(finalText)} selection text still present`,
    );
  }
}

/**
 * `a11y`: selects MSD-A/B/C (N=3), samples `SelectionBar` text, drags MSD-B toward `done` (release
 * always lands back on `todo`, harmless), and while the button is down asserts the deck container
 * carries `aria-hidden="true"` and `inert` with the badge inside that hidden subtree, the
 * `DndLiveRegion` announces `"Picked up 3 selected tickets."`, MSD-A/MSD-C (selected, not grabbed)
 * are `opacity: 0.4` while MSD-D (unselected) stays `1`, and the `SelectionBar` text is still exactly
 * `"3 selected"`. Samples a THIRD time after the drop; all three samples are reported together on any
 * mismatch, since the checker addendum's whole point is continuous availability, not just the ends.
 * `mutateHook`/`restoreHook` mirror the other two checks' own discipline.
 */
async function checkA11y(
  cdp,
  sessionId,
  violations,
  mutateHook = null,
  restoreHook = null,
) {
  // dnd-kit's live region reflects only the LATEST announcement: React updates the SAME Text node's
  // `.nodeValue` in place (the `<div>{announcement}</div>` structure never changes shape, only the
  // string does), and the pointer's very first post-activation collision measurement resolves `over`
  // (even to the card's OWN source column) within the SAME synchronous render/commit sequence that
  // set "Picked up N selected tickets.", so the browser never paints the intermediate value and a
  // plain point-in-time DOM read (or even a MutationObserver callback that reads `live.textContent`
  // AFTER the fact) only ever observes the FINAL value. `characterDataOldValue: true` is the fix:
  // each individual characterData MutationRecord's `oldValue` captures the value that was ACTUALLY
  // live for that specific mutation step, letting this harness reconstruct the full sequence of
  // values the live region held, not just whichever one happened to still be current when read.
  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var live = document.querySelector('div[role="status"][aria-live="assertive"][id^="DndLiveRegion"]');
      if (!live) throw new Error("panel100: DndLiveRegion node not found to install the announcement observer");
      window.__panel100LiveRegionHistory = [];
      if (!window.__panel100LiveRegionObserverInstalled) {
        var observer = new MutationObserver(function (mutations) {
          mutations.forEach(function (m) {
            if (m.type === "characterData" && m.oldValue != null) {
              window.__panel100LiveRegionHistory.push(m.oldValue);
            }
          });
          window.__panel100LiveRegionHistory.push(live.textContent);
        });
        observer.observe(live, {
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        });
        window.__panel100LiveRegionObserverInstalled = true;
      }
      return true;
    })()`,
  );

  await selectCardsByIdentifier(cdp, sessionId, [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
  ]);
  const sample1 = await readSelectionText(cdp, sessionId);

  const doneTarget = await columnDropPoint(cdp, sessionId, "done");
  const todoTarget = await columnDropPoint(cdp, sessionId, "todo");
  await beginDrag(cdp, sessionId, "todo", MSD_B_IDENTIFIER, doneTarget);
  await assertDragActivated(cdp, sessionId, MSD_B_IDENTIFIER);

  if (mutateHook) await mutateHook(cdp, sessionId);

  const sample2 = await readSelectionText(cdp, sessionId);

  const reading = await evalValue(
    cdp,
    sessionId,
    `${FIND_CARD_SRC}${FIND_FIXED_OVERLAY_SRC}(function () {
      // Locates the deck container via the TRUE dnd-kit fixed-position wrapper's own single child,
      // never via the [aria-hidden="true"][inert] selector FIND_OVERLAY_SRC itself uses: this
      // check's own break REMOVES aria-hidden from the deck container, and keying the lookup on
      // that same attribute would make the locator itself blind the instant the attribute changes
      // (Trap 3, the standing rule every check in this phase must honor).
      var fixedNode = panel100FindFixedOverlayNode(${JSON.stringify(MSD_B_IDENTIFIER)});
      if (!fixedNode) throw new Error("panel100: fixed overlay node not found for MSD-B");
      var overlay = fixedNode.children[0];
      if (!overlay) throw new Error("panel100: deck overlay not found for MSD-B");
      var kids = Array.prototype.slice.call(overlay.children);
      var badge = kids.find(function (el) {
        var s = getComputedStyle(el);
        var text = (el.textContent || "").trim();
        return s.position === "absolute" && /^\\d+$/.test(text);
      });
      function opacityOf(identifier) {
        var el = panel100FindCardRoot(identifier);
        return getComputedStyle(el).opacity;
      }
      return {
        deckAriaHidden: overlay.getAttribute("aria-hidden"),
        deckInert: overlay.hasAttribute("inert"),
        badgeFound: badge != null,
        badgeInsideHidden: badge ? badge.closest('[aria-hidden="true"]') === overlay : false,
        opacityA: opacityOf(${JSON.stringify(MSD_A_IDENTIFIER)}),
        opacityC: opacityOf(${JSON.stringify(MSD_C_IDENTIFIER)}),
        opacityD: opacityOf(${JSON.stringify(MSD_D_IDENTIFIER)}),
        liveRegionHistory: window.__panel100LiveRegionHistory || [],
      };
    })()`,
  );

  if (restoreHook) await restoreHook(cdp, sessionId);

  if (reading.deckAriaHidden !== "true") {
    violations.push(
      `a11y: deck container aria-hidden expected "true", measured ${JSON.stringify(reading.deckAriaHidden)}`,
    );
  }
  if (!reading.deckInert) {
    violations.push(
      `a11y: deck container expected the inert attribute present, measured absent`,
    );
  }
  if (!reading.badgeFound) {
    violations.push(`a11y: count badge not found in the deck overlay`);
  } else if (!reading.badgeInsideHidden) {
    violations.push(
      `a11y: badge's closest [aria-hidden="true"] ancestor is not the deck container, the count is not inside the hidden subtree`,
    );
  }
  if (reading.opacityA !== "0.4") {
    violations.push(
      `a11y: MSD-A (selected, not grabbed) expected opacity "0.4", measured ${JSON.stringify(reading.opacityA)}`,
    );
  }
  if (reading.opacityC !== "0.4") {
    violations.push(
      `a11y: MSD-C (selected, not grabbed) expected opacity "0.4", measured ${JSON.stringify(reading.opacityC)}`,
    );
  }
  if (reading.opacityD !== "1") {
    violations.push(
      `a11y: MSD-D (not selected) expected opacity "1", measured ${JSON.stringify(reading.opacityD)}`,
    );
  }
  const expectedLive = "Picked up 3 selected tickets.";
  if (!reading.liveRegionHistory.includes(expectedLive)) {
    violations.push(
      `a11y: live region announcement history expected to include ${JSON.stringify(expectedLive)}, measured ${JSON.stringify(reading.liveRegionHistory)}`,
    );
  }

  await moveDragTo(cdp, sessionId, todoTarget);
  await endDrag(cdp, sessionId, todoTarget);

  const endHistory = await evalValue(
    cdp,
    sessionId,
    `window.__panel100LiveRegionHistory || []`,
  );
  const expectedEndLive = "3 tickets returned to their original position.";
  if (!endHistory.includes(expectedEndLive)) {
    violations.push(
      `a11y: drag-end live region announcement expected to include ${JSON.stringify(expectedEndLive)} (this drop is a same-column no-op, nothing moved), measured ${JSON.stringify(endHistory)}`,
    );
  }

  const sample3 = await readSelectionText(cdp, sessionId);
  const samples = { sample1, sample2, sample3 };
  for (const [name, value] of Object.entries(samples)) {
    if (value !== "3 selected") {
      violations.push(
        `a11y: SelectionBar text mismatch, ${name} expected "3 selected", measured ${JSON.stringify(value)}; ` +
          `all samples: sample1=${JSON.stringify(sample1)} sample2=${JSON.stringify(sample2)} sample3=${JSON.stringify(sample3)}`,
      );
    }
  }

  for (const id of [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
    MSD_D_IDENTIFIER,
  ]) {
    const col = await pollUntilColumn(cdp, sessionId, id, "todo", 2000);
    if (col !== "todo") {
      violations.push(
        `a11y: ${id} expected column "todo" after the harmless same-column drop, measured ${JSON.stringify(col)}`,
      );
    }
  }

  await clearSelectionViaEscape(cdp, sessionId);
}

// ---------------------------------------------------------------------------
// group-modal-prefill (DRAG-04). Enables Fetch on the move pattern BEFORE the
// drop so the check can prove a negative (zero paused move requests), drags
// MSD-B onto in_progress (the only reachable "start a session" target,
// RESEARCH Pitfall 1), and reads the resulting GroupStartModal's Members
// list, which Modal.tsx portals straight onto document.body, outside #root.
// ---------------------------------------------------------------------------

/**
 * `group-modal-prefill` leg body: selects MSD-A/B/C, enables `Fetch` on the move pattern, drags
 * MSD-B onto `in_progress`, and asserts the resulting `GroupStartModal` lists exactly those three
 * identifiers with MSD-D absent, and that zero `Fetch.requestPaused` events arrived for the move
 * endpoint (the direct proof no doomed `todo` to `in_progress` request was ever fired, catching
 * RESEARCH Pitfall 3). Closes the modal via a real `Escape` keypress (`Modal.tsx`'s own binding,
 * `Board.tsx`'s own selection-clearing Escape effect is a no-op while `groupModalMembers != null`),
 * then asserts all four MSD fixtures still read `todo` and clears the selection for the next check.
 * `mutateHook`, when provided, runs immediately BEFORE the drop (mirroring `preDragHook`'s timing
 * discipline), letting `runBreakGroupModalPrefill` install a `MutationObserver` that detaches the
 * modal's first `MemberRow` node the instant it appears. `restoreHook` runs immediately after this
 * leg's own reading captures the trip, mirroring `stacked-overlay`'s own restore-hook timing.
 */
async function performGroupModalPrefillLeg(
  cdp,
  sessionId,
  violations,
  mutateHook = null,
  restoreHook = null,
) {
  await selectCardsByIdentifier(cdp, sessionId, [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
  ]);

  fetchPausedQueue.length = 0;
  await cdp.send(
    "Fetch.enable",
    {
      patterns: [{ urlPattern: "*/api/cards/*/move", requestStage: "Request" }],
    },
    sessionId,
  );

  if (mutateHook) await mutateHook(cdp, sessionId);

  const target = await columnDropPoint(cdp, sessionId, "in_progress");
  const point = await beginDrag(
    cdp,
    sessionId,
    "todo",
    MSD_B_IDENTIFIER,
    target,
  );
  await assertDragActivated(cdp, sessionId, MSD_B_IDENTIFIER);
  await endDrag(cdp, sessionId, point);

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  let reading = null;
  while (Date.now() < deadline) {
    reading = await readGroupModalMembers(cdp, sessionId);
    if (reading != null) break;
    await sleep(POLL_INTERVAL_MS);
  }

  if (reading == null) {
    violations.push(
      `group-modal-prefill: New group modal never appeared within ${RENDER_TIMEOUT_MS}ms after the In Progress drop`,
    );
  } else {
    const expected = [MSD_A_IDENTIFIER, MSD_B_IDENTIFIER, MSD_C_IDENTIFIER]
      .slice()
      .sort();
    const measured = (reading.identifiers ?? []).slice().sort();
    if (JSON.stringify(measured) !== JSON.stringify(expected)) {
      violations.push(
        `group-modal-prefill: modal member identifier set expected ${JSON.stringify(expected)}, measured ${JSON.stringify(measured)}`,
      );
    }
    if ((reading.identifiers ?? []).includes(MSD_D_IDENTIFIER)) {
      violations.push(
        `group-modal-prefill: modal unexpectedly includes MSD-D, which was never part of the dragged selection`,
      );
    }
    if (reading.label !== "Members (3)") {
      violations.push(
        `group-modal-prefill: modal Members label expected "Members (3)", measured ${JSON.stringify(reading.label)}`,
      );
    }
  }

  if (restoreHook) await restoreHook(cdp, sessionId);

  // A short grace window, not the full FETCH_PAUSE_TIMEOUT_MS: this is a same-machine loopback
  // fetch, so if performGroupMove's in_progress branch were wrongly wired to fire N moveCard calls
  // anyway, the resulting requests would already be paused well within a couple hundred ms of the
  // drop. Waiting the full 10s here would only slow every passing run for no added coverage.
  const NO_MOVE_GRACE_MS = 1200;
  await sleep(NO_MOVE_GRACE_MS);
  if (fetchPausedQueue.length > 0) {
    violations.push(
      `group-modal-prefill: expected zero Fetch.requestPaused events on the move endpoint during the In Progress drop, measured ${fetchPausedQueue.length}`,
    );
    for (const paused of fetchPausedQueue.splice(0)) {
      await cdp
        .send(
          "Fetch.continueRequest",
          { requestId: paused.requestId },
          sessionId,
        )
        .catch(() => {});
    }
  }

  await clearSelectionViaEscape(cdp, sessionId);
  await sleep(300);
  const stillOpen = await evalValue(
    cdp,
    sessionId,
    `document.querySelector('[role="dialog"][aria-label="New group"]') != null`,
  );
  if (stillOpen) {
    violations.push(
      `group-modal-prefill: New group modal still present after a real Escape keypress`,
    );
  }

  for (const id of [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
    MSD_D_IDENTIFIER,
  ]) {
    const col = await pollUntilColumn(cdp, sessionId, id, "todo", 2000);
    if (col !== "todo") {
      violations.push(
        `group-modal-prefill: ${id} expected column "todo" after the modal closed, measured ${JSON.stringify(col)}`,
      );
    }
  }

  await cdp.send("Fetch.disable", {}, sessionId);
  await clearSelectionViaEscape(cdp, sessionId);
}

async function checkGroupModalPrefill(cdp, sessionId, violations) {
  await performGroupModalPrefillLeg(cdp, sessionId, violations, null, null);
}

/**
 * `group-modal-prefill` break: installs a `MutationObserver` (BEFORE the drop, watching
 * `document.body`'s subtree) that detaches the modal's FIRST `MemberRow` node the instant the
 * members container appears, stashing the captured node plus its parent/next-sibling on `window`
 * so the restore hook can reinsert the exact same node object (never a recreated lookalike). The
 * trip must report a member-set mismatch naming the expected three identifiers and the measured
 * two, never "modal not found" (the modal DID appear, only one of its rows did not survive).
 */
async function runBreakGroupModalPrefill(cdp, sessionId) {
  console.log(
    "\n--break group-modal-prefill: detaching the modal's first MemberRow node the instant it appears",
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `${FIND_MODAL_MEMBERS_SRC}(function () {
        var observer = new MutationObserver(function () {
          var container = panel100FindGroupModalMembersContainer();
          if (!container) return;
          var rows = Array.prototype.slice.call(container.children).slice(1);
          if (rows.length === 0) return;
          var firstRow = rows[0];
          window.__panel100BreakMemberRowNode = firstRow;
          window.__panel100BreakMemberRowParent = container;
          window.__panel100BreakMemberRowNextSibling = firstRow.nextSibling;
          firstRow.remove();
          observer.disconnect();
          window.__panel100BreakMemberRowObserver = null;
        });
        window.__panel100BreakMemberRowObserver = observer;
        observer.observe(document.body, { childList: true, subtree: true });
        return true;
      })()`,
    );
  };
  const restoreHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var node = window.__panel100BreakMemberRowNode;
        var parent = window.__panel100BreakMemberRowParent;
        var nextSibling = window.__panel100BreakMemberRowNextSibling;
        if (node && parent && document.contains(parent) && !document.contains(node)) {
          if (nextSibling && document.contains(nextSibling)) {
            parent.insertBefore(node, nextSibling);
          } else {
            parent.appendChild(node);
          }
        }
        delete window.__panel100BreakMemberRowNode;
        delete window.__panel100BreakMemberRowParent;
        delete window.__panel100BreakMemberRowNextSibling;
        if (window.__panel100BreakMemberRowObserver) {
          window.__panel100BreakMemberRowObserver.disconnect();
          window.__panel100BreakMemberRowObserver = null;
        }
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  await performGroupModalPrefillLeg(
    cdp,
    sessionId,
    tripViolations,
    mutateHook,
    restoreHook,
  );
  console.log(
    `--break group-modal-prefill TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) =>
        v.indexOf("modal member identifier set expected") !== -1 &&
        v.indexOf('["MSD-A","MSD-B","MSD-C"]') !== -1,
    ) && !tripViolations.some((v) => v.indexOf("never appeared") !== -1);

  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  const restoreViolations = [];
  await checkGroupModalPrefill(cdp, restoreSessionId, restoreViolations);
  console.log(
    `--break group-modal-prefill RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

// ---------------------------------------------------------------------------
// atomic-rollback (DRAG-05). Drags MSD-B onto "done" for a real cross-column
// move, fails exactly MSD-B's own initial POST /move via CDP, and drains the
// resulting compensating requests. Leg 1 is the plan's own base scenario
// (both compensations succeed cleanly); leg 2 is the plan-checker's own
// required addition, forcing the FIRST compensating request to fail once and
// proving its retry is what actually saves the card, on the client and after
// a full page reload. Neither leg edits src/; every failure is CDP-decided.
// ---------------------------------------------------------------------------

/** Moves every `identifiers` entry currently NOT in "todo" back to "todo" via a real single-card
 * drag (`dragCardToColumn`, no selection required). Used after a break trip or after `leg 3` let a
 * real server-side move land (`atomic-rollback`'s "release all three" leg, or a permanently-stranded
 * compensation), so the following restore-verification run's own `selectCardsByIdentifier` finds
 * every fixture back in its selection-eligible column.
 *
 * Re-reads the card's column and re-drags up to `REPAIR_MAX_ATTEMPTS` times rather than trusting one
 * drag: a full-board-width `done` -> `todo` drag resolves `over` from dnd-kit's own rect-intersection
 * against droppable rects measured at activation, and was observed landing one column short
 * (`in_progress`) after `leg 3`'s page reload. This is fixture repair, not an assertion, so
 * converging on `todo` is the whole contract; the final failure still throws with the last observed
 * column named. */
const REPAIR_MAX_ATTEMPTS = 3;

async function repairCardsToTodo(cdp, sessionId, identifiers) {
  for (const id of identifiers) {
    for (let attempt = 1; attempt <= REPAIR_MAX_ATTEMPTS; attempt++) {
      const col = await evalValue(
        cdp,
        sessionId,
        `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
      );
      if (col == null || col === "todo") break;
      try {
        await dragCardToColumn(cdp, sessionId, col, id, "todo");
        break;
      } catch (err) {
        if (attempt === REPAIR_MAX_ATTEMPTS) throw err;
        console.log(
          `repairCardsToTodo: ${id} attempt ${attempt}/${REPAIR_MAX_ATTEMPTS} did not land in "todo", retrying: ${err.message}`,
        );
      }
    }
  }
}

/**
 * `atomic-rollback` leg body. Drags MSD-B onto `done` for a real cross-column move (never a
 * harmless same-column drop, the whole point here is a genuine attempted batch move), collects the
 * three initial paused `POST /move` requests, and fails exactly MSD-B's own request (unless
 * `releaseAllInitial`, the base break's own scenario) while continuing the other two.
 *
 * Without `releaseAllInitial`, drains the two resulting compensating requests (asserting each
 * targets `todo`) and, depending on `strandCompensation`/`retryCompensationOnce`, either lets both
 * through immediately (the plan's own base scenario), or fails the FIRST one once and decides its
 * retry's fate: continued (`retryCompensationOnce`, the plan-checker's required addition, proving
 * the retry is what actually saves the card) or failed again (`strandCompensation`, the required
 * break leg, permanently stranding that one card server-side).
 *
 * Returns `{ strandedIdentifier }`, the one card a `strandCompensation` run left permanently
 * server-side `done`, or `null`, so a caller can repair the fixture before reusing this board
 * session.
 */
async function performAtomicRollbackLeg(
  cdp,
  sessionId,
  violations,
  legLabel,
  opts = {},
) {
  const {
    mutateHook = null,
    restoreHook = null,
    releaseAllInitial = false,
    strandCompensation = false,
    retryCompensationOnce = false,
  } = opts;

  const consoleStart = consoleCapturedMessages.length;

  await selectCardsByIdentifier(cdp, sessionId, [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
  ]);

  fetchPausedQueue.length = 0;
  await cdp.send(
    "Fetch.enable",
    {
      patterns: [{ urlPattern: "*/api/cards/*/move", requestStage: "Request" }],
    },
    sessionId,
  );

  if (mutateHook) await mutateHook(cdp, sessionId);

  const target = await columnDropPoint(cdp, sessionId, "done");
  const point = await beginDrag(
    cdp,
    sessionId,
    "todo",
    MSD_B_IDENTIFIER,
    target,
  );
  await assertDragActivated(cdp, sessionId, MSD_B_IDENTIFIER);
  await endDrag(cdp, sessionId, point);

  const initialPaused = [];
  for (let i = 0; i < 3; i++) {
    initialPaused.push(await waitForNextPausedRequest(FETCH_PAUSE_TIMEOUT_MS));
  }
  for (const paused of initialPaused) {
    if (!releaseAllInitial && paused.request.url.indexOf(MSD_B_ID) !== -1) {
      await cdp.send(
        "Fetch.failRequest",
        { requestId: paused.requestId, errorReason: "Failed" },
        sessionId,
      );
    } else {
      await cdp.send(
        "Fetch.continueRequest",
        { requestId: paused.requestId },
        sessionId,
      );
    }
  }

  // `releaseAllInitial` (the base `atomic-rollback` break's own scenario) never fails anything, so
  // `performGroupMove`'s `results.every(fulfilled)` branch returns immediately: no rollback, no
  // alert, no compensating requests at all. Deliberately falls through into the SAME "expect todo,
  // expect the alert" assertions every other leg uses below, rather than a bespoke "expect done, no
  // alert" branch: a break's whole point is running the check's OWN real assertions against a
  // broken scenario and watching them correctly report the resulting violations, never asserting
  // the broken scenario's own (wrong) outcome as if it were the goal.
  let strandedIdentifier = null;
  let strandedId = null;
  if (!releaseAllInitial) {
    const compensating = [];
    for (let i = 0; i < 2; i++) {
      compensating.push(await waitForNextPausedRequest(FETCH_PAUSE_TIMEOUT_MS));
    }
    for (const paused of compensating) {
      const body = paused.request.postData
        ? JSON.parse(paused.request.postData)
        : null;
      if (!body || body.column !== "todo") {
        violations.push(
          `atomic-rollback: ${legLabel}, compensating request body expected {"column":"todo"}, measured ${JSON.stringify(body)}`,
        );
      }
    }
    // The column half of "can a compensating call target the wrong thing?" is asserted above; this
    // is the card half. Compensation must target exactly the two cards whose FORWARD move landed
    // (MSD-A and MSD-C, since MSD-B's own request is the one failed above). A regression that
    // compensated the wrong card, keying off the wrong index or building the target list from the
    // whole selection instead of the moved subset, would emit two well-formed {"column":"todo"}
    // bodies and pass the loop above unnoticed.
    const expectedCompensationIds = [MSD_A_ID, MSD_C_ID];
    const compensatedIds = compensating
      .map((p) => (/cards\/([^/]+)\/move/.exec(p.request.url) ?? [])[1] ?? null)
      .sort();
    if (
      JSON.stringify(compensatedIds) !==
      JSON.stringify([...expectedCompensationIds].sort())
    ) {
      violations.push(
        `atomic-rollback: ${legLabel}, compensating requests expected to target exactly ${JSON.stringify([...expectedCompensationIds].sort())} (the two cards whose forward move succeeded), measured ${JSON.stringify(compensatedIds)}`,
      );
    }

    if (strandCompensation || retryCompensationOnce) {
      const targeted = compensating[0];
      strandedId =
        targeted.request.url.indexOf(MSD_A_ID) !== -1 ? MSD_A_ID : MSD_C_ID;
      strandedIdentifier =
        strandedId === MSD_A_ID ? MSD_A_IDENTIFIER : MSD_C_IDENTIFIER;
      await cdp.send(
        "Fetch.failRequest",
        { requestId: targeted.requestId, errorReason: "Failed" },
        sessionId,
      );
      await cdp.send(
        "Fetch.continueRequest",
        { requestId: compensating[1].requestId },
        sessionId,
      );
      const retryPaused = await waitForNextPausedRequest(
        FETCH_PAUSE_TIMEOUT_MS,
      );
      const retryId =
        (/cards\/([^/]+)\/move/.exec(retryPaused.request.url) ?? [])[1] ?? null;
      if (retryId !== strandedId) {
        violations.push(
          `atomic-rollback: ${legLabel}, the compensation retry expected to re-target the card whose compensating call failed (${strandedId}), measured ${JSON.stringify(retryId)}`,
        );
      }
      const retryBody = retryPaused.request.postData
        ? JSON.parse(retryPaused.request.postData)
        : null;
      if (!retryBody || retryBody.column !== "todo") {
        violations.push(
          `atomic-rollback: ${legLabel}, compensation retry body expected {"column":"todo"}, measured ${JSON.stringify(retryBody)}`,
        );
      }
      if (strandCompensation) {
        await cdp.send(
          "Fetch.failRequest",
          { requestId: retryPaused.requestId, errorReason: "Failed" },
          sessionId,
        );
      } else {
        await cdp.send(
          "Fetch.continueRequest",
          { requestId: retryPaused.requestId },
          sessionId,
        );
      }
    } else {
      for (const paused of compensating) {
        await cdp.send(
          "Fetch.continueRequest",
          { requestId: paused.requestId },
          sessionId,
        );
      }
    }
  } else {
    await sleep(800);
  }

  await sleep(800);

  const expectedAlertText = "Couldn't move 3 tickets";
  const alertTextNow = await evalValue(
    cdp,
    sessionId,
    `(function () { var el = document.querySelector('[role="alert"]'); return el ? el.textContent.trim() : null; })()`,
  );
  if (alertTextNow !== expectedAlertText) {
    violations.push(
      `atomic-rollback: ${legLabel}, [role="alert"] text expected ${JSON.stringify(expectedAlertText)}, measured ${JSON.stringify(alertTextNow)}`,
    );
  }

  if (restoreHook) await restoreHook(cdp, sessionId);

  for (const id of [MSD_A_IDENTIFIER, MSD_B_IDENTIFIER, MSD_C_IDENTIFIER]) {
    // A permanently-stranded card's client column is not a stable read here: the board's own SSE
    // resync (`Board.tsx`'s `useEffect` on the `board` prop) eventually overwrites the optimistic
    // client-side revert with the server's real (still-"done") truth once a snapshot lands, so this
    // one card's "immediately after rollback" state is racy by design, exactly why the plan routes
    // detection through the alert-stays-open and console assertions below instead of a column read.
    if (strandCompensation && id === strandedIdentifier) continue;
    const col = await pollUntilColumn(cdp, sessionId, id, "todo", 2000);
    if (col !== "todo") {
      violations.push(
        `atomic-rollback: ${legLabel}, ${id} expected column "todo" immediately after rollback, measured ${JSON.stringify(col)}`,
      );
    }
  }
  const colD = await pollUntilColumn(
    cdp,
    sessionId,
    MSD_D_IDENTIFIER,
    "todo",
    1000,
  );
  if (colD !== "todo") {
    violations.push(
      `atomic-rollback: ${legLabel}, MSD-D expected column "todo" (never part of the dragged batch), measured ${JSON.stringify(colD)}`,
    );
  }

  await sleep(3600);
  const alertAfterWait = await evalValue(
    cdp,
    sessionId,
    `(function () { var el = document.querySelector('[role="alert"]'); return el ? el.textContent.trim() : null; })()`,
  );
  if (strandCompensation) {
    if (alertAfterWait == null) {
      violations.push(
        `atomic-rollback: ${legLabel}, expected [role="alert"] to stay visible past 3200ms for a stranded compensation, measured absent`,
      );
    }
    const consoleHasStranded = consoleCapturedMessages
      .slice(consoleStart)
      .some((params) => {
        const serialized = JSON.stringify(params.args);
        return (
          serialized.indexOf(strandedId) !== -1 &&
          serialized.toLowerCase().indexOf("stranded") !== -1
        );
      });
    if (!consoleHasStranded) {
      violations.push(
        `atomic-rollback: ${legLabel}, expected a console.error mentioning "stranded" and card id ${strandedId}, none captured`,
      );
    }
  } else if (alertAfterWait != null) {
    violations.push(
      `atomic-rollback: ${legLabel}, expected [role="alert"] to auto-clear after 3200ms, still measured ${JSON.stringify(alertAfterWait)}`,
    );
  }

  await cdp.send("Fetch.disable", {}, sessionId);
  await cdp.send("Page.reload", {}, sessionId);
  await waitForBoardRootLoaded(cdp, sessionId, TOP_LEVEL_IDENTIFIERS);

  for (const id of [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
    MSD_D_IDENTIFIER,
  ]) {
    const expectStranded = strandCompensation && id === strandedIdentifier;
    const col = await evalValue(
      cdp,
      sessionId,
      `${FIND_CARD_COLUMN_SRC}panel100CardColumnOf(${JSON.stringify(id)})`,
    );
    if (expectStranded) {
      if (col === "todo") {
        violations.push(
          `atomic-rollback: ${legLabel}, ${id} (the stranded card) expected a non-"todo" server column after a full page reload (the compensation never landed), measured "todo"`,
        );
      }
    } else if (col !== "todo") {
      violations.push(
        `atomic-rollback: ${legLabel}, ${id} expected column "todo" after a full page reload, measured ${JSON.stringify(col)}`,
      );
    }
  }

  await clearSelectionViaEscape(cdp, sessionId);
  return { strandedIdentifier };
}

/**
 * `atomic-rollback`'s three legs. Leg 3 is 100-REVIEW CR-02's fix: before it existed, the two
 * assertions that guard the permanently-stranded path (the alert outliving its 3200ms auto-clear,
 * and the `console.error` naming the card) ran ONLY inside
 * `runBreakAtomicRollbackStrandedCompensation`'s trip leg, where they are expected to FAIL, so
 * deleting `Board.tsx`'s whole stranded-suppression path left every run green. Leg 3 runs that same
 * scenario in the configuration where both assertions must PASS, which is what turns the break into
 * a real self-check. It genuinely strands one card server-side, so it repairs the fixture before
 * returning.
 */
async function checkAtomicRollback(cdp, sessionId, violations, opts = {}) {
  await performAtomicRollbackLeg(
    cdp,
    sessionId,
    violations,
    "leg 1 (clean rollback)",
    opts,
  );
  if (opts.releaseAllInitial) return;
  await performAtomicRollbackLeg(
    cdp,
    sessionId,
    violations,
    "leg 2 (compensation retry succeeds)",
    { retryCompensationOnce: true },
  );
  const leg3 = await performAtomicRollbackLeg(
    cdp,
    sessionId,
    violations,
    "leg 3 (compensation permanently fails)",
    { strandCompensation: true },
  );
  if (leg3.strandedIdentifier) {
    await repairCardsToTodo(cdp, sessionId, [leg3.strandedIdentifier]);
  }
}

/**
 * `atomic-rollback` break: releases ALL THREE initial move requests successfully via
 * `Fetch.continueRequest`, so no failure is ever injected. The check must then report both the
 * wrong columns (all three measured `done`, expected `todo`) and the absent alert. Since the real
 * server genuinely persists this move, the restore leg first drags MSD-A/B/C back to `todo` for
 * real (`repairCardsToTodo`) before re-running the actual `checkAtomicRollback` check.
 */
async function runBreakAtomicRollback(cdp, sessionId) {
  console.log(
    "\n--break atomic-rollback: releasing all three initial move requests successfully, no failure ever injected",
  );
  const tripViolations = [];
  await performAtomicRollbackLeg(cdp, sessionId, tripViolations, "trip", {
    releaseAllInitial: true,
  });
  console.log(
    `--break atomic-rollback TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) =>
        v.indexOf('expected column "todo" immediately after rollback') !== -1,
    ) &&
    tripViolations.some(
      (v) => v.indexOf('[role="alert"] text expected') !== -1,
    );

  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  await repairCardsToTodo(cdp, restoreSessionId, [
    MSD_A_IDENTIFIER,
    MSD_B_IDENTIFIER,
    MSD_C_IDENTIFIER,
  ]);
  const restoreViolations = [];
  await checkAtomicRollback(cdp, restoreSessionId, restoreViolations, {});
  console.log(
    `--break atomic-rollback RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `atomic-rollback-toast` break: with the injection working normally (MSD-B's own initial move
 * still fails, both compensations still succeed), a `MutationObserver` removes the `[role="alert"]`
 * node the instant it appears. The check must report the alert missing while the column assertions
 * still pass, proving the toast assertion is not being masked by the column ones.
 */
async function runBreakAtomicRollbackToast(cdp, sessionId) {
  console.log(
    '\n--break atomic-rollback-toast: removing the [role="alert"] node the instant it appears, injection still working normally',
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var observer = new MutationObserver(function () {
          var el = document.querySelector('[role="alert"]');
          if (!el) return;
          window.__panel100BreakAlertNode = el;
          window.__panel100BreakAlertParent = el.parentNode;
          window.__panel100BreakAlertNextSibling = el.nextSibling;
          el.remove();
          observer.disconnect();
          window.__panel100BreakAlertObserver = null;
        });
        window.__panel100BreakAlertObserver = observer;
        observer.observe(document.body, { childList: true, subtree: true });
        return true;
      })()`,
    );
  };
  const restoreHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var node = window.__panel100BreakAlertNode;
        var parent = window.__panel100BreakAlertParent;
        var nextSibling = window.__panel100BreakAlertNextSibling;
        if (node && parent && document.contains(parent) && !document.contains(node)) {
          if (nextSibling && document.contains(nextSibling)) {
            parent.insertBefore(node, nextSibling);
          } else {
            parent.appendChild(node);
          }
        }
        delete window.__panel100BreakAlertNode;
        delete window.__panel100BreakAlertParent;
        delete window.__panel100BreakAlertNextSibling;
        if (window.__panel100BreakAlertObserver) {
          window.__panel100BreakAlertObserver.disconnect();
          window.__panel100BreakAlertObserver = null;
        }
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  await checkAtomicRollback(cdp, sessionId, tripViolations, {
    mutateHook,
    restoreHook,
  });
  console.log(
    `--break atomic-rollback-toast TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) => v.indexOf('[role="alert"] text expected') !== -1,
    ) &&
    !tripViolations.some(
      (v) =>
        v.indexOf('expected column "todo" immediately after rollback') !== -1,
    );

  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  const restoreViolations = [];
  await checkAtomicRollback(cdp, restoreSessionId, restoreViolations, {});
  console.log(
    `--break atomic-rollback-toast RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `atomic-rollback-stranded-compensation` break, the plan-checker's own required additional leg.
 * `Board.tsx`'s own compensation-retry logic (plan 04) already handles a permanently-stranded card
 * correctly, on purpose: this is genuinely-correct product behavior, not a bug, so a bare scenario
 * variation (failing the compensating call AND its retry) produces a clean check pass, not a
 * violation, exactly proving the retry mechanism itself works. Proving the CHECK's OWN detection
 * signals are load-bearing therefore needs a DOM/JS-level mutation on top of a real stranding
 * scenario: this suppresses BOTH detection surfaces the check reads, a `MutationObserver` that
 * removes `[role="alert"]` the instant it appears (mirroring `atomic-rollback-toast`'s technique),
 * and a monkey-patched `window.console.error` that swallows any call whose text mentions
 * "stranded" (so this harness's own `Runtime.consoleAPICalled` capture never observes it), while
 * the underlying stranding still genuinely occurs server-side. The trip must report both the
 * missing alert and the missing console message.
 *
 * 100-REVIEW CR-02: this break only became a real self-check once `checkAtomicRollback` grew its own
 * `leg 3 (compensation permanently fails)`, which runs this exact scenario in the configuration
 * where both assertions must PASS. Before that leg existed, neither the default run nor this break
 * exercised the stranded path in a passing configuration, so deleting `Board.tsx`'s whole
 * `strandedCompensationRef` suppression left every path green.
 */
async function runBreakAtomicRollbackStrandedCompensation(cdp, sessionId) {
  console.log(
    "\n--break atomic-rollback-stranded-compensation: suppressing the alert and console.error detection signals while a real permanent compensation failure still occurs",
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var origError = window.console.error.bind(window.console);
        window.console.error = function () {
          var args = Array.prototype.slice.call(arguments);
          if (args.some(function (a) { return typeof a === "string" && a.indexOf("stranded") !== -1; })) return;
          return origError.apply(window.console, args);
        };
        var observer = new MutationObserver(function () {
          var el = document.querySelector('[role="alert"]');
          if (!el) return;
          el.remove();
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  const tripResult = await performAtomicRollbackLeg(
    cdp,
    sessionId,
    tripViolations,
    "trip (detection signals suppressed)",
    { strandCompensation: true, mutateHook },
  );
  console.log(
    `--break atomic-rollback-stranded-compensation TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) =>
        v.indexOf('expected [role="alert"] to stay visible past 3200ms') !== -1,
    ) &&
    tripViolations.some(
      (v) => v.indexOf('expected a console.error mentioning "stranded"') !== -1,
    );

  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  if (tripResult.strandedIdentifier) {
    await repairCardsToTodo(cdp, restoreSessionId, [
      tripResult.strandedIdentifier,
    ]);
  }
  const restoreViolations = [];
  await checkAtomicRollback(cdp, restoreSessionId, restoreViolations, {});
  console.log(
    `--break atomic-rollback-stranded-compensation RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

const CHECKS = {
  "stacked-overlay": checkStackedOverlay,
  "overlay-unchanged-n1": checkOverlayUnchangedN1,
  a11y: checkA11y,
  "group-modal-prefill": checkGroupModalPrefill,
  "atomic-rollback": checkAtomicRollback,
  "single-card-unchanged": checkSingleCardUnchanged,
  "keyboard-unchanged": checkKeyboardUnchanged,
};

// ---------------------------------------------------------------------------
// Breaks. Neither break edits a file under src/: both mutate the live DOM
// mid-flow, in a way `Board.tsx`'s own unchanged code cannot recover from,
// proving the check reports a wrong MEASURED value rather than degrading to
// an opaque "not found"/exception. Both drive the SAME check body the real
// run uses, restore the captured original state, and re-confirm PASS.
// ---------------------------------------------------------------------------

/**
 * `single-card-unchanged` break: BEFORE the drag starts (mousedown never yet dispatched), removes
 * the `done` column's droppable container node, the exact element `useDroppable({ id: "done" })`
 * attaches its ref to (`Column.tsx:252-256`). A same-size PLACEHOLDER div is inserted in its place
 * first, so removing the real node causes NO layout reflow of the sibling columns and the
 * already-captured drop point stays geometrically valid, landing on inert placeholder space, never
 * on a neighbouring column that shifted into the gap.
 *
 * TIMING IS LOAD-BEARING, proven by this file's own instrumented diagnostic run: dnd-kit caches
 * each droppable's rect at `handleDragStart` (drag activation) and does not re-measure a node
 * removed AFTER that point, so removing `done` MID-DRAG (the first shape this break was written
 * against) leaves the STALE pre-removal rect live for collision purposes, the drop SILENTLY
 * SUCCEEDS server-side, and the resulting React commit into the now-detached `done` subtree leaves
 * the whole page visibly stuck (`DragOverlay` never clears, `MSD-A` vanishes from every attached
 * column). Removing `done` BEFORE the drag starts means dnd-kit's very first measurement reads a
 * detached node's `getBoundingClientRect()`, which browsers return as an all-zero rect, so no drop
 * point can ever intersect it and `over` correctly resolves to nothing.
 *
 * React never reconciles this raw DOM surgery (it only observes state changes), so its own
 * `droppableContainers` map keeps a stale reference to the now-detached `done` node throughout.
 * The restore leg reinserts the CAPTURED node itself (never a recreated lookalike, the Dead
 * Instrument #8 discipline) and discards the placeholder.
 */
async function runBreakSingleCardUnchanged(cdp, sessionId) {
  console.log(
    "\n--break single-card-unchanged: removing the done column's droppable container node before the drag starts (placeholder holds its layout space)",
  );
  const tripViolations = [];
  const preDragHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var col = document.querySelector('[data-column="done"]');
        if (!col) throw new Error("panel100 break: done column node not found");
        var rect = col.getBoundingClientRect();
        var computedFlex = getComputedStyle(col).flex;
        var placeholder = document.createElement("div");
        placeholder.setAttribute("data-panel100-break-placeholder", "true");
        placeholder.style.cssText = "flex: " + computedFlex + "; width: " + rect.width + "px; min-width: " + rect.width + "px;";
        col.parentNode.insertBefore(placeholder, col);
        window.__panel100BreakDoneNode = col;
        window.__panel100BreakDoneParent = col.parentNode;
        window.__panel100BreakPlaceholder = placeholder;
        col.remove();
        return true;
      })()`,
    );
  };
  await performSingleCardDragCheck(cdp, sessionId, tripViolations, preDragHook);
  console.log(
    `--break single-card-unchanged TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) =>
      v.indexOf('MSD-A expected column "done"') !== -1 &&
      v.indexOf("not found") === -1,
  );

  await evalValue(
    cdp,
    sessionId,
    `(function () {
      var node = window.__panel100BreakDoneNode;
      var placeholder = window.__panel100BreakPlaceholder;
      if (!node || !placeholder) throw new Error("panel100 break: restore state missing for done column");
      placeholder.parentNode.insertBefore(node, placeholder);
      placeholder.remove();
      delete window.__panel100BreakDoneNode;
      delete window.__panel100BreakDoneParent;
      delete window.__panel100BreakPlaceholder;
      return true;
    })()`,
  );
  const restoreViolations = [];
  await performSingleCardDragCheck(cdp, sessionId, restoreViolations, null);
  console.log(
    `--break single-card-unchanged RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `keyboard-unchanged` break: once MSD-B's `MoveToPicker` group is open, stashes and detaches its
 * "Done" entry button before `clickPickerColumn` runs. `clickPickerColumn` finds no matching
 * button and returns `false` without throwing, so `performKeyboardCheckBody` falls through to its
 * own column-poll, which observes MSD-B still in its pre-click column, exactly the "wrong measured
 * column, not not found" trip this break is required to produce. The restore leg reinserts the
 * CAPTURED button node itself while the picker (still open at the 900px breakpoint) has not yet
 * unmounted, then a fresh `checkKeyboardUnchanged` run re-opens the picker and re-confirms PASS.
 */
async function runBreakKeyboardUnchanged(cdp, sessionId) {
  console.log(
    "\n--break keyboard-unchanged: detaching the Done entry from MSD-B's MoveToPicker portal before the click",
  );
  const tripViolations = [];
  let restoreOutcome = "not-run";
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  try {
    const preClickHook = async (cdpArg, sessionIdArg) => {
      await evalValue(
        cdpArg,
        sessionIdArg,
        `(function () {
          var group = document.querySelector('[role="group"][aria-label="Move MSD-B to"]');
          if (!group) throw new Error("panel100 break: MoveToPicker group not found for MSD-B");
          var buttons = Array.prototype.slice.call(group.querySelectorAll("button"));
          var btn = buttons.find(function (b) { return (b.textContent || "").trim() === "Done"; });
          if (!btn) throw new Error("panel100 break: Done entry not found in MoveToPicker for MSD-B");
          window.__panel100BreakDoneBtn = btn;
          window.__panel100BreakDoneBtnParent = btn.parentNode;
          window.__panel100BreakDoneBtnNext = btn.nextSibling;
          btn.remove();
          return true;
        })()`,
      );
    };
    await performKeyboardCheckBody(
      cdp,
      sessionId,
      tripViolations,
      preClickHook,
    );
    console.log(
      `--break keyboard-unchanged TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
    );

    restoreOutcome = await evalValue(
      cdp,
      sessionId,
      `(function () {
        var btn = window.__panel100BreakDoneBtn;
        var parent = window.__panel100BreakDoneBtnParent;
        if (!btn || !parent || !document.contains(parent)) {
          delete window.__panel100BreakDoneBtn;
          delete window.__panel100BreakDoneBtnParent;
          delete window.__panel100BreakDoneBtnNext;
          return "parent-gone";
        }
        parent.insertBefore(btn, window.__panel100BreakDoneBtnNext || null);
        delete window.__panel100BreakDoneBtn;
        delete window.__panel100BreakDoneBtnParent;
        delete window.__panel100BreakDoneBtnNext;
        return "restored";
      })()`,
    );
  } finally {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  }

  const tripFired = tripViolations.some(
    (v) =>
      v.indexOf('MSD-B expected column "done"') !== -1 &&
      v.indexOf("not found") === -1,
  );

  const restoreViolations = [];
  await checkKeyboardUnchanged(cdp, sessionId, restoreViolations);
  console.log(
    `--break keyboard-unchanged RESTORE leg (restoreOutcome=${restoreOutcome}): ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `stacked-overlay` break: mid-drag (mouse still down, deck confirmed present via
 * `assertDragActivated`), rewrites the 4px back face's OWN inline `transform` to
 * `translate(4px, 10px)`, stashing the captured original value on `window`. The trip must report a
 * named transform mismatch AND a named rect mismatch, never "face not found" (the face is still
 * there, only its offset is wrong). The restore leg puts the captured value back on the SAME node
 * while the drag is still active, before `endDrag`.
 */
async function runBreakStackedOverlay(cdp, sessionId) {
  console.log(
    "\n--break stacked-overlay: rewriting the 4px back face's inline transform to translate(4px, 10px) mid-drag",
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `${FIND_OVERLAY_SRC}(function () {
        var overlay = panel100FindOverlayNode(${JSON.stringify(MSD_B_IDENTIFIER)});
        if (!overlay) throw new Error("panel100 break: deck overlay not found for MSD-B");
        var kids = Array.prototype.slice.call(overlay.children);
        var target = kids.find(function (el) {
          var s = getComputedStyle(el);
          return s.position === "absolute" && s.borderRadius === "6px" && el.children.length === 0 &&
            (el.textContent || "").trim() === "" && s.transform === "matrix(1, 0, 0, 1, 4, 4)";
        });
        if (!target) throw new Error("panel100 break: 4px back face not found for MSD-B");
        window.__panel100BreakFaceNode = target;
        window.__panel100BreakFaceOriginalTransform = target.style.transform;
        target.style.transform = "translate(4px, 10px)";
        return true;
      })()`,
    );
  };
  const restoreHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var node = window.__panel100BreakFaceNode;
        if (node && document.contains(node)) {
          node.style.transform = window.__panel100BreakFaceOriginalTransform;
        }
        delete window.__panel100BreakFaceNode;
        delete window.__panel100BreakFaceOriginalTransform;
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  await checkStackedOverlay(
    cdp,
    sessionId,
    tripViolations,
    mutateHook,
    restoreHook,
  );
  console.log(
    `--break stacked-overlay TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) =>
        v.indexOf("4px back face transform expected") !== -1 &&
        v.indexOf('"matrix(1, 0, 0, 1, 4, 4)"') !== -1,
    ) &&
    tripViolations.some((v) => v.indexOf("4px back face rect expected") !== -1);

  // A fresh tab before the restore leg both (a) discards checkStackedOverlay's deliberate leftover
  // 3-selection (task 1's own "return the board to a 3-selection for the next check" cleanup, which
  // would otherwise make the restore leg's ctrl-clicks TOGGLE MSD-A/B/C OFF instead of re-selecting
  // them) and (b) sidesteps this harness's renderer occasionally stalling between two consecutive
  // full multi-drag check runs in one tab, see `freshBoardSession`'s own header.
  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  const restoreViolations = [];
  await checkStackedOverlay(
    cdp,
    restoreSessionId,
    restoreViolations,
    null,
    null,
  );
  console.log(
    `--break stacked-overlay RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `overlay-unchanged-n1` break: mid-drag (N=0 leg, deck confirmed present via `assertDragActivated`),
 * inserts one `position: absolute` inset:0 intruder `<div>` as a SIBLING of the overlay's own card
 * root, directly under the fixed dnd-kit overlay node (simulating a leaked back face inside the
 * N<=1 overlay, exactly the regression shape `overlay-unchanged-n1`'s own comment calls "the N<=1
 * overlay having drifted"). Deliberately a SIBLING, not a descendant reached by mutating INSIDE the
 * actively-dragged `CardView` subtree: that subtree is under React's own live reconciliation for the
 * whole duration of the drag, and an earlier draft of this break that appended a child directly
 * inside it produced intermittent hangs/crashes (a raw DOM mutation racing a concurrent React
 * commit). The fixed overlay node's OWN children only change at drag start/end, never per-frame, so
 * inserting a sibling there is safe. The trip must report BOTH the absolutely-positioned inset:0
 * descendant violation AND a descendant-element-count mismatch (the intruder is a real extra node,
 * not a removed one, so "not found" never fires).
 */
async function runBreakOverlayUnchangedN1(cdp, sessionId) {
  console.log(
    "\n--break overlay-unchanged-n1: inserting an absolutely positioned inset:0 intruder div as a sibling of the N<=1 overlay's card root, mid-drag",
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `${FIND_FIXED_OVERLAY_SRC}(function () {
        var fixedNode = panel100FindFixedOverlayNode(${JSON.stringify(MSD_A_IDENTIFIER)});
        if (!fixedNode) throw new Error("panel100 break: fixed overlay node not found for MSD-A");
        var intruder = document.createElement("div");
        intruder.setAttribute("data-panel100-break-intruder", "true");
        intruder.style.cssText = "position: absolute; top: 0; right: 0; bottom: 0; left: 0;";
        fixedNode.appendChild(intruder);
        window.__panel100BreakIntruder = intruder;
        return true;
      })()`,
    );
  };
  const restoreHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var node = window.__panel100BreakIntruder;
        if (node && document.contains(node)) node.remove();
        delete window.__panel100BreakIntruder;
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  await checkOverlayUnchangedN1(
    cdp,
    sessionId,
    tripViolations,
    mutateHook,
    restoreHook,
  );
  console.log(
    `--break overlay-unchanged-n1 TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired =
    tripViolations.some(
      (v) =>
        v.indexOf("N=0 leg") !== -1 &&
        v.indexOf("absolutely-positioned inset:0 descendant") !== -1,
    ) &&
    tripViolations.some(
      (v) =>
        v.indexOf("N=0 leg") !== -1 &&
        (v.indexOf("descendant-element count expected") !== -1 ||
          v.indexOf("expected exactly 1 face-level element") !== -1),
    );

  // A fresh tab sidesteps this harness's renderer occasionally stalling between two consecutive
  // full multi-drag check runs, see `freshBoardSession`'s own header.
  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  const restoreViolations = [];
  await checkOverlayUnchangedN1(
    cdp,
    restoreSessionId,
    restoreViolations,
    null,
    null,
  );
  console.log(
    `--break overlay-unchanged-n1 RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

/**
 * `a11y` break: mid-drag (deck confirmed present via `assertDragActivated`), removes the
 * `aria-hidden` attribute from the deck container, stashing the captured original value on `window`.
 * The trip must report that the badge's closest `[aria-hidden="true"]` ancestor is no longer the
 * deck container (the count is no longer inside the hidden subtree), never "not found" (the badge
 * itself is untouched, only its hidden-subtree membership breaks).
 */
async function runBreakA11y(cdp, sessionId) {
  console.log(
    "\n--break a11y: removing the aria-hidden attribute from the deck container mid-drag",
  );
  const mutateHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `${FIND_OVERLAY_SRC}(function () {
        var overlay = panel100FindOverlayNode(${JSON.stringify(MSD_B_IDENTIFIER)});
        if (!overlay) throw new Error("panel100 break: deck overlay not found for MSD-B");
        window.__panel100BreakDeckNode = overlay;
        window.__panel100BreakDeckAriaHidden = overlay.getAttribute("aria-hidden");
        overlay.removeAttribute("aria-hidden");
        return true;
      })()`,
    );
  };
  const restoreHook = async (cdpArg, sessionIdArg) => {
    await evalValue(
      cdpArg,
      sessionIdArg,
      `(function () {
        var node = window.__panel100BreakDeckNode;
        var original = window.__panel100BreakDeckAriaHidden;
        if (node && document.contains(node) && original != null) {
          node.setAttribute("aria-hidden", original);
        }
        delete window.__panel100BreakDeckNode;
        delete window.__panel100BreakDeckAriaHidden;
        return true;
      })()`,
    );
  };

  const tripViolations = [];
  await checkA11y(cdp, sessionId, tripViolations, mutateHook, restoreHook);
  console.log(
    `--break a11y TRIP leg FAIL output:\n${tripViolations.join("\n")}`,
  );
  const tripFired = tripViolations.some(
    (v) =>
      v.indexOf("badge's closest") !== -1 &&
      v.indexOf("not the deck container") !== -1,
  );

  // A fresh tab sidesteps this harness's renderer occasionally stalling between two consecutive
  // full multi-drag check runs, see `freshBoardSession`'s own header.
  const restoreSessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
  const restoreViolations = [];
  await checkA11y(cdp, restoreSessionId, restoreViolations, null, null);
  console.log(
    `--break a11y RESTORE leg: ${restoreViolations.length === 0 ? "PASS" : `FAIL:\n${restoreViolations.join("\n")}`}`,
  );
  return {
    tripFired,
    restoreClean: restoreViolations.length === 0,
    tripViolations,
  };
}

const BREAKS = {
  "stacked-overlay": runBreakStackedOverlay,
  "overlay-unchanged-n1": runBreakOverlayUnchangedN1,
  a11y: runBreakA11y,
  "group-modal-prefill": runBreakGroupModalPrefill,
  "atomic-rollback": runBreakAtomicRollback,
  "atomic-rollback-toast": runBreakAtomicRollbackToast,
  "atomic-rollback-stranded-compensation":
    runBreakAtomicRollbackStrandedCompensation,
  "single-card-unchanged": runBreakSingleCardUnchanged,
  "keyboard-unchanged": runBreakKeyboardUnchanged,
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const checkName = readFlag(argv, "--check");
  if (checkName != null && !CHECKS[checkName]) {
    console.error(
      `unknown check "${checkName}", valid: ${Object.keys(CHECKS).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }
  const breakName = readFlag(argv, "--break");
  if (breakName != null && !BREAKS[breakName]) {
    console.error(
      `unknown break "${breakName}", valid: ${Object.keys(BREAKS).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }

  await assertNoLiveService();
  await assertSandboxPortsFree();
  assertBuilt();

  const realBefore = statRealBoardDb();
  console.log(`\nLIVE ${realBefore.path} BEFORE: ${fmtStat(realBefore)}`);

  const home = makeSandboxHome(`run-${process.pid}`);
  const violations = [];
  let server = null;
  let chromeChild = null;
  let cdp = null;
  let portsHeld = false;
  let breakResult = null;

  try {
    const pathPrefix = writeStubClaudeBinary(home);
    console.log(`standup: stub claude planted, ${join(pathPrefix, "claude")}`);

    await seedFixtureCards(home, allFixtureCards());
    console.log("standup: five fixture cards seeded via node:sqlite");

    server = bootServerAt(home, pathPrefix);
    await waitForReady(SANDBOX_PORT);
    console.log(
      `standup: sandbox server ready on :${SANDBOX_PORT}, pid=${server.pid}`,
    );

    chromeChild = spawn(
      findChrome(),
      [
        "--headless=new",
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`)}`,
        "--no-first-run",
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
    await waitForCdpUp();

    cdp = await connectCDP();
    const { targetId } = await cdp.send("Target.createTarget", {
      url: `http://127.0.0.1:${SANDBOX_PORT}/`,
    });
    lastKnownTargetId = targetId;
    let { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Console.enable", {}, sessionId);
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );

    cdp.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === "Runtime.consoleAPICalled") {
        console.error(
          `DEBUG console.${msg.params.type}: ${JSON.stringify(msg.params.args)}`,
        );
        consoleCapturedMessages.push(msg.params);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        console.error(
          `page exception: ${JSON.stringify(msg.params.exceptionDetails)}`,
        );
      }
      if (msg.method === "Fetch.requestPaused") {
        fetchPausedQueue.push(msg.params);
      }
    });

    await waitForBoardRootLoaded(cdp, sessionId, TOP_LEVEL_IDENTIFIERS);
    console.log("standup: board painted, all five fixture identifiers present");

    if (breakName != null) {
      breakResult = await BREAKS[breakName](cdp, sessionId);
    } else {
      const names = checkName != null ? [checkName] : Object.keys(CHECKS);
      for (let i = 0; i < names.length; i++) {
        const n = names[i];
        if (i > 0) {
          // A fresh tab per check in a multi-check run sidesteps this harness's renderer
          // occasionally stalling after several consecutive real drags in one long-lived page
          // session (see `freshBoardSession`'s own header); the very first check reuses the
          // already-loaded standup session, no need to pay the extra reload cost twice.
          sessionId = await freshBoardSession(cdp, TOP_LEVEL_IDENTIFIERS);
        }
        console.log(`\n=== running check: ${n} ===`);
        const before = violations.length;
        try {
          await CHECKS[n](cdp, sessionId, violations);
        } catch (err) {
          violations.push(
            `${n}: run failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
          );
        }
        const added = violations.length - before;
        console.log(
          added === 0 ? `PASS (${n})` : `FAIL (${n}): ${added} violation(s)`,
        );
      }
      if (names.length === 0) {
        console.log(
          "\nno checks registered yet in this file, standup/teardown only",
        );
      }
    }
  } finally {
    if (cdp) cdp.close();
    await killAndWait(chromeChild);
    await killAndWait(server);
    rmSync(home, { recursive: true, force: true });
    rmSync(join(tmpdir(), `${SANDBOX_PREFIX}chrome-${process.pid}`), {
      recursive: true,
      force: true,
    });
    portsHeld = await checkPortsHeld();
  }

  const realAfter = statRealBoardDb();
  console.log(`\nLIVE ${realAfter.path} AFTER: ${fmtStat(realAfter)}`);
  if (
    realBefore.exists !== realAfter.exists ||
    realBefore.mtimeMs !== realAfter.mtimeMs ||
    realBefore.size !== realAfter.size
  ) {
    console.log(
      `FAIL: the real ${realAfter.path} changed during this run. before=${fmtStat(realBefore)} after=${fmtStat(realAfter)}`,
    );
    process.exit(1);
  }

  if (portsHeld) {
    console.log(
      "\nFAIL: a sandbox resource (port) was still held after teardown",
    );
    process.exit(1);
  }

  if (breakName != null) {
    console.log(
      `\n--break ${breakName} summary: tripFired=${breakResult.tripFired} restoreClean=${breakResult.restoreClean}`,
    );
    if (!breakResult.tripFired) {
      console.log(
        `FAIL (self-check): the trip leg did NOT report the expected violation for "${breakName}", the check is a dead instrument.`,
      );
      process.exit(1);
    }
    if (!breakResult.restoreClean) {
      console.log(
        `FAIL (self-check): the restore leg for "${breakName}" still reports a violation after restoring the captured original value.`,
      );
      process.exit(1);
    }
    console.log(
      `PASS (--break ${breakName} self-check): trip leg correctly reported the violation, restore leg re-passed clean.`,
    );
    process.exit(0);
  }

  if (violations.length > 0) {
    console.log(`\nFAIL: ${violations.length} violation(s)`);
    for (const v of violations) console.log(`  ${v}`);
    process.exit(1);
  }

  console.log("\nPASS");
  process.exit(0);
}

main().catch((err) => {
  console.error(`panel-100 failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
