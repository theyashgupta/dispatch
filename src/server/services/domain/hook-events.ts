import {
  markerKey,
  parseLastMarker,
  type Marker,
} from "../../adapters/markers/parse.js";
import { store } from "../../store/board.store.js";
import { getHooksRuntime } from "../infra/config-holder.js";

/**
 * Tool names whose `PreToolUse` fires the structural Needs-Input safety net (HOOK-03) and whose
 * matching `PostToolUse` fires the symmetric flip-back — the single source of truth for the pause
 * class: both event branches here read it AND `bootstrap/hook-setup.ts` derives the registered
 * `PreToolUse` matcher from it, so the "enters on tool X", "leaves on tool X", and "matcher
 * delivers tool X" contracts can never drift apart (a set edited without the matcher would
 * half-wire: catch-all PostToolUse flips back on a tool the enter side never covered).
 * Live-verified (48-DIAGNOSIS.md) for `AskUserQuestion`; `ExitPlanMode` (48-IN-03, allow-list #8)
 * is live-verified in Phase 57 — see 57-01-SUMMARY.md for the sandbox probe evidence (PreToolUse
 * synthesizes the needs_input marker with a clean display reason, PostToolUse flips it back).
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export const PAUSE_TOOL_NAMES = new Set(["AskUserQuestion", "ExitPlanMode"]);

/**
 * Composite key for every per-session throttle/dedup map below (Phase 91, HOOK-01): a card owns
 * N sessions, and one sibling's death must never reap or reset another still-live sibling's
 * throttle window. An authenticated hook event always supplies a real `sessionId` — a hook
 * event never reaches {@link applyHookEvent} without one, since `registerHookToken` refuses to
 * register an orphan session id in the first place. The reap chokepoint may pass `undefined`
 * (a corrupt/pre-entity card `clearHookToken` could not resolve a target for) — the composite
 * key still forms, just with no live entry to ever match it.
 */
function throttleKey(cardId: string, sessionId: string | undefined): string {
  return `${cardId}:${sessionId}`;
}

/**
 * Composite-keyed ({@link throttleKey}) epoch ms of the last hook-driven activity stamp — the 2s
 * throttle state. Channel policy lives HERE, never in the store (setOutputChanged's JSDoc forbids
 * coalescing there). In-memory only: a backend restart just allows one early stamp, which is
 * harmless. Entries are reaped by reapActivityThrottle when a session's hook channel dies,
 * matching the reaping discipline of the watcher's per-session maps.
 */
const lastActivityStampMs = new Map<string, number>();

/**
 * Minimum ms between hook-driven PostToolUse activity stamps per session. Matches the pane
 * watcher's 2000ms tick, so hook-path dot latency is never worse than the pane path's while a
 * parallel tool-call burst can no longer enqueue several board.json writes + SSE frames per
 * second. Stop is EXEMPT: it fires once per turn (inherently rate-limited) and is the turn's
 * final event, so a throttled Stop would permanently drop the stamp for the turn's actual
 * final output — no later event exists to self-heal it, unlike the leading-edge drops the
 * throttle is designed for.
 */
const ACTIVITY_THROTTLE_MS = 2000;

/**
 * Drop a session's activity-throttle entry when its hook channel dies. Wired into the store's
 * token-release chokepoint at boot (composed with the token registry unregister), so every
 * session-clearing mutation reaps the entry at the moment it clears the hook fields and the
 * map cannot grow for the process lifetime. A stale entry could never wrongly suppress a
 * future stamp — this is map-hygiene parity with the watcher's per-session maps, not a
 * correctness guard. Composite-keyed ({@link throttleKey}) so a dead sibling's release can never
 * reset a surviving sibling's own throttle window.
 */
export function reapActivityThrottle(
  cardId: string,
  sessionId: string | undefined,
): void {
  const key = throttleKey(cardId, sessionId);
  lastActivityStampMs.delete(key);
  preToolUseSeq.delete(key);
}

/**
 * Composite-keyed ({@link throttleKey}) map of `"recorded|incoming"` tuple to the epoch ms it
 * last logged — the `session_id mismatch` dedupe state. Nested one level deeper than
 * {@link lastActivityStampMs} so the whole per-session bucket drops in O(1) at session death via
 * {@link reapMismatchThrottle}, matching that same map's reap discipline rather than a separate
 * TTL-sweep timer. `recorded` is first-event-wins for a session's life, so in practice at most
 * one tuple exists per session — but a token-holding client sending a distinct `incoming` on
 * every event would otherwise grow the inner map unboundedly for the life of a single session,
 * which the outer reap alone cannot bound; see {@link MISMATCH_MAX_TUPLES_PER_CARD}.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
const mismatchLoggedAt = new Map<string, Map<string, number>>();

/** Suppression window for a repeated identical `session_id mismatch` tuple. */
const MISMATCH_LOG_WINDOW_MS = 60_000;

/**
 * Upper bound on distinct `(recorded, incoming)` tuples tracked per session within a single live
 * session, enforced by evicting the oldest (lowest `lastLoggedMs`) entry before insertion would
 * exceed it. Bounds the inner map DURING a session, not only at session death.
 */
const MISMATCH_MAX_TUPLES_PER_CARD = 16;

/**
 * Drop a session's mismatch-dedupe bucket when its hook channel dies. Wired into the same
 * session-death chokepoint as {@link reapActivityThrottle} so the outer map is bounded by
 * construction — no separate timer. Composite-keyed ({@link throttleKey}), matching
 * {@link reapActivityThrottle}.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export function reapMismatchThrottle(
  cardId: string,
  sessionId: string | undefined,
): void {
  mismatchLoggedAt.delete(throttleKey(cardId, sessionId));
}

/**
 * Composite-keyed ({@link throttleKey}) monotonic counter used ONLY as the fallback discriminator
 * for a synthesized `PreToolUse` marker when the payload carries no usable `tool_use_id` (HOOK-03
 * follow-up): `markerKey` is entirely derived from `Marker.reason`, so a SECOND same-session pause
 * with the identical fixed reason text ("waiting on AskUserQuestion") would dedup against the
 * first pause's still-standing `lastMarker` — `flipBack` deliberately never clears it — and
 * silently never flip the card for a genuinely new, still-blocking pause. Incrementing this per
 * call gives every fallback-path pause a distinct reason/markerKey without touching
 * `board.store.ts`'s dedup guard or `flipBack`'s contract at all. Values carry no meaning beyond
 * distinctness, and distinctness must hold ACROSS channel lifetimes, not just within one: entries
 * are reaped at the token-release chokepoint alongside `lastActivityStampMs`, but a session's
 * `lastMarker` survives every session-clearing mutator, so a counter restarting at a fixed seed
 * would reproduce the dead channel's key on the new channel's first fallback pause and be
 * dedup-swallowed — hence {@link resolvePreToolUseDiscriminator} seeds a fresh entry from
 * `Date.now()`, never `0`.
 */
const preToolUseSeq = new Map<string, number>();

/**
 * Map a Stop hook event onto the board: parse the final assistant message for its last
 * status marker and apply it through the single-writer store, attributed to the session that
 * emitted it. A marker-free message is a silent no-op — every turn ends with Stop and most
 * carry no marker.
 *
 * @remarks The dedup key written here MUST be `markerKey(parseLastMarker(message))` verbatim
 * (the exact kind-space-reason format from parse.ts) so the untouched pane watcher's
 * sameMarkerKey prefix dedup sees a hook-applied marker as already consumed and never
 * re-fires it. The hook channel is edge-triggered, so no dedup heuristics live here; the
 * level-triggered watcher carries that burden. Reusing parseLastMarker also inherits the
 * kickoff-placeholder guard and last-match-wins over multi-line messages.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function applyStopEvent(
  cardId: string,
  sessionId: string,
  lastAssistantMessage: string,
): Promise<void> {
  const marker = parseLastMarker(lastAssistantMessage);
  if (!marker) return;
  const column = marker.kind === "NEEDS_INPUT" ? "needs_input" : "agent_done";
  const eventType =
    marker.kind === "NEEDS_INPUT" ? "status_needs_input" : "status_agent_done";
  const reason = marker.reason === "" ? undefined : marker.reason;
  await store.applyMarker(
    cardId,
    sessionId,
    column,
    reason,
    markerKey(marker),
    eventType,
  );
}

/**
 * Map a UserPromptSubmit hook event onto flipBack: the user replied, definitionally. Binds
 * ONLY to the event name plus token-derived card/session identity — payload message-text keys
 * are unstable across CLI releases and are never read. flipBack re-checks the column inside the
 * store queue, so the kickoff paste's own UserPromptSubmit no-ops mid-saga.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function applyPromptSubmit(
  cardId: string,
  sessionId: string,
): Promise<void> {
  await store.flipBack(cardId, sessionId);
}

/**
 * Map a PreToolUse event for a pause-class tool (HOOK-03) directly onto Needs Input: the tool
 * call itself IS the signal, so no marker text is parsed — a `Marker`-shaped object is synthesized
 * and routed through the SAME `markerKey()`/`applyMarker` path `applyStopEvent` uses, so the pane
 * channel's dedup sees a hook-synthesized marker exactly as it would a parsed one and the two
 * channels' key formats can never drift apart. `applyMarker`'s own guards (no-op on the To Do
 * and Done columns, duplicate-key dedup) are the only column logic needed here.
 *
 * @remarks `discriminator` MUST vary per distinct pause (the live `tool_use_id`, or the
 * {@link preToolUseSeq} fallback) and is folded into the KEY-source `marker.reason` — the ONLY
 * input `markerKey` reads — so a second, genuinely new pause in the same session never dedups
 * against the first pause's still-standing `lastMarker` (`flipBack` deliberately never clears
 * it). The SAME pause retried with the SAME `tool_use_id` still produces the SAME key, so the
 * existing dedup guard continues to suppress a true duplicate fire. 48-IN-02 (allow-list #7):
 * the DISPLAYED reason passed to `store.applyMarker` is deliberately a SEPARATE, clean string
 * (`waiting on <toolName>`, no discriminator) — the raw `tool_use_id`/fallback counter is
 * internal dedup plumbing, not something the user should see on the card. The key-source and
 * the display string are allowed to diverge because `markerKey()` is called on `marker` (the
 * discriminated one), never on the clean display string.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
async function applyPreToolUseEvent(
  cardId: string,
  sessionId: string,
  toolName: string,
  discriminator: string,
): Promise<void> {
  const marker: Marker = {
    kind: "NEEDS_INPUT",
    reason: `waiting on ${toolName} (${discriminator})`,
  };
  const displayReason = `waiting on ${toolName}`;
  await store.applyMarker(
    cardId,
    sessionId,
    "needs_input",
    displayReason,
    markerKey(marker),
    "status_needs_input",
  );
}

/**
 * Resolve the per-invocation discriminator a synthesized `PreToolUse` marker's `reason` folds in
 * (HOOK-03 follow-up): the payload's own `tool_use_id` when present and well-formed — validated
 * with the same string-plus-bounded-charset shape as `session_id` below, never trusted blindly —
 * else the next value from the composite-keyed ({@link throttleKey}) {@link preToolUseSeq}
 * fallback, seeded from `Date.now()` on first miss so a fresh hook channel can never reproduce a
 * dead channel's key (see {@link preToolUseSeq}). Either path is distinct per call and across
 * channel lifetimes, which is the only property {@link applyPreToolUseEvent} depends on; a
 * retried event carrying the SAME `tool_use_id` deliberately resolves to the SAME discriminator,
 * so the existing `lastMarker` dedup guard still suppresses a true duplicate fire.
 */
function resolvePreToolUseDiscriminator(
  key: string,
  toolUseId: unknown,
): string {
  if (typeof toolUseId === "string" && /^[\w-]{1,256}$/.test(toolUseId)) {
    return toolUseId;
  }
  const next = (preToolUseSeq.get(key) ?? Date.now()) + 1;
  preToolUseSeq.set(key, next);
  return `#${next}`;
}

/**
 * The single channel-policy entry point for every authenticated hook event, owning in order:
 * the pane-mode no-op guard (a straggler session injected before a config flip to `pane` must
 * mutate NOTHING — no latch, no stamp, no marker/flip; the route still authenticates), the
 * write-once hook-routed latch (`WR-05`: the SOLE site that stamps `hookRoutedAt`, and the reason
 * the latch is evidence rather than a prediction — an authenticated event is the only proof that
 * this session's hook transport actually delivers, so a version-capable session whose hook script
 * can never reach the port keeps full pane routing instead of losing every status channel; the
 * read-before-enqueue guard prevents per-event write churn, and the store's mutator refuses a
 * token-less session so the race with a queued session-clearing mutation can never latch a dead
 * session), the activity stamp on
 * PostToolUse/Stop only (the user's own typing is not agent
 * output, so UserPromptSubmit never stamps; PostToolUse is throttled, Stop is exempt — see
 * ACTIVITY_THROTTLE_MS), and the Stop/UserPromptSubmit/PreToolUse/PostToolUse board mapping.
 * `tool_name` (HOOK-03) is validated (string + exact membership in {@link PAUSE_TOOL_NAMES})
 * before use, unlike the throttle's `hook_event_name`-only binding — an untrusted payload can
 * never synthesize a marker or flip a card for a tool dispatch never registered a matcher for.
 * `tool_use_id` (also validated, see {@link resolvePreToolUseDiscriminator}) makes each PreToolUse
 * pause's synthesized marker distinct so a second same-session pause is never deduped against the
 * first's still-standing `lastMarker`. Unknown events end after the latch/stamp as no-ops.
 * @remarks `sessionId` (Phase 91) is the SOLE source of session identity, resolved by the route
 * exclusively from `resolveHookToken` — a body-claimed session id is never trusted, matching the
 * existing card-identity policy. The hook-routed latch gate and the `session_id` mismatch
 * comparison both read the RESOLVED session's own fields (`sessions.find(s => s.id === sessionId)`),
 * never the card's flat mirror — a sibling that already routed, or already recorded a Claude
 * session id, must never suppress or short-circuit this session's own first-event evidence.
 * @see docs/ARCHITECTURE.md#hooks-status-channel
 */
export async function applyHookEvent(
  cardId: string,
  sessionId: string,
  body:
    | {
        hook_event_name?: unknown;
        last_assistant_message?: unknown;
        session_id?: unknown;
        tool_name?: unknown;
        tool_use_id?: unknown;
      }
    | undefined,
): Promise<void> {
  if (getHooksRuntime()?.statusChannel === "pane") return;

  const session = store
    .getCard(cardId)
    ?.sessions?.find((s) => s.id === sessionId);
  if (session?.hookRoutedAt == null) {
    await store.markHookRouted(cardId, sessionId, new Date().toISOString());
  }

  const key = throttleKey(cardId, sessionId);
  const sid = body?.session_id;
  if (typeof sid === "string" && /^[\w-]{1,256}$/.test(sid)) {
    const recorded = store
      .getCard(cardId)
      ?.sessions?.find((s) => s.id === sessionId)?.claudeSessionId;
    if (recorded == null) {
      await store.setClaudeSessionId(cardId, sessionId, sid);
    } else if (recorded !== sid) {
      const mismatchKey = `${recorded}|${sid}`;
      const perSession = mismatchLoggedAt.get(key) ?? new Map<string, number>();
      const last = perSession.get(mismatchKey);
      const now = Date.now();
      if (last === undefined || now - last >= MISMATCH_LOG_WINDOW_MS) {
        console.warn(
          `[hook] session_id mismatch card=${cardId} recorded=${recorded} incoming=${sid}`,
        );
        if (
          !perSession.has(mismatchKey) &&
          perSession.size >= MISMATCH_MAX_TUPLES_PER_CARD
        ) {
          let oldestKey: string | undefined;
          let oldestMs = Infinity;
          for (const [k, ms] of perSession) {
            if (ms < oldestMs) {
              oldestMs = ms;
              oldestKey = k;
            }
          }
          if (oldestKey !== undefined) perSession.delete(oldestKey);
        }
        perSession.set(mismatchKey, now);
        mismatchLoggedAt.set(key, perSession);
      }
    }
  }

  const event = body?.hook_event_name;
  const toolName =
    typeof body?.tool_name === "string" && PAUSE_TOOL_NAMES.has(body.tool_name)
      ? body.tool_name
      : undefined;

  if (event === "PostToolUse" || event === "Stop") {
    const now = Date.now();
    const last = lastActivityStampMs.get(key);
    if (
      event === "Stop" ||
      last === undefined ||
      now - last >= ACTIVITY_THROTTLE_MS
    ) {
      lastActivityStampMs.set(key, now);
      await store.setOutputChanged(cardId, new Date().toISOString());
    }
  }

  if (event === "Stop" && typeof body?.last_assistant_message === "string") {
    await applyStopEvent(cardId, sessionId, body.last_assistant_message);
  } else if (event === "UserPromptSubmit") {
    await applyPromptSubmit(cardId, sessionId);
  } else if (event === "PreToolUse" && toolName !== undefined) {
    const discriminator = resolvePreToolUseDiscriminator(
      key,
      body?.tool_use_id,
    );
    await applyPreToolUseEvent(cardId, sessionId, toolName, discriminator);
  }

  if (event === "PostToolUse" && toolName !== undefined) {
    await store.flipBack(cardId, sessionId);
  }
}
