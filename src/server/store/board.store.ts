import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ActivityEvent,
  BoardSnapshot,
  Card,
  Column,
  EventType,
  PreviewInfo,
  PrInfo,
  ProbeUnknown,
  Session,
  SessionFields,
  SourceIssue,
  StartError,
  TerminalError,
} from "../../shared/types.js";
import { DEFAULT_CLEANUP_DELAY_DAYS } from "../../shared/types.js";
import type { CardSearchResult } from "../../shared/search.js";
import { type BoardDb, type BoardMeta, openBoardDb } from "./board-db.js";
import {
  APPLY_MARKER_EXCLUDED_SOURCES,
  FLIP_BACK_CLEARS_LAST_MARKER,
  FLIP_BACK_SOURCES,
  isManualMoveAllowed,
} from "../../shared/column-transitions.js";
import { isStartingCard, reconcile } from "./mapping.js";

const BOARD_DIR = path.join(os.homedir(), ".dispatch");
export const BOARD_PATH = path.join(BOARD_DIR, "board.json");

/** Milliseconds in a day, for resolving `cleanupDelayMs` from a day count (`LIFE-02`). */
const MS_PER_DAY = 86_400_000;

/**
 * To Do ordering. Promotion recency is the PRIMARY tier BY DESIGN: any card carrying
 * `promotedAt` sorts before every non-promoted card, newest-promoted first — the locked
 * user decision is "promoted lands at the TOP of To Do", and with Inbox as the sole
 * entry path onto the board every To Do card eventually carries `promotedAt` (the field
 * is deliberately never cleared), so the column converges to pure promotion-recency
 * order in the steady state. The original locked priority ordering (CONTEXT.md -> Data
 * & Sync Semantics: Linear priority urgent->low, with 1 urgent .. 4 low ascending and
 * 0 (none) LAST — treated as +Infinity per RESEARCH assumption A2 — tie-broken by
 * updatedAt DESCENDING) governs ONLY never-promoted legacy cards, below the promoted
 * tier. Pure — the single authoritative place the To Do order is expressed. Invoked by
 * snapshot() on the read path. A plain `updatedAt` bump was rejected for the promoted
 * tier — it only wins ties within the SAME priority bucket, so a promoted low-priority
 * card would still sort below an unpromoted high-priority card, contradicting "lands
 * at the TOP of To Do".
 */
export function compareTodoOrder(a: Card, b: Card): number {
  const ap = a.promotedAt != null;
  const bp = b.promotedAt != null;
  if (ap !== bp) return ap ? -1 : 1;
  if (ap && bp) return b.promotedAt!.localeCompare(a.promotedAt!);
  const pa = a.priority === 0 ? Number.POSITIVE_INFINITY : a.priority;
  const pb = b.priority === 0 ? Number.POSITIVE_INFINITY : b.priority;
  if (pa !== pb) return pa - pb;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/**
 * Is this Done card still awaiting its deferred cleanup? Byte-identical to the predicate
 * `Column.tsx`'s client-side `doneGroups` split already applies — this is that same logic moved
 * server-side (`BOARD-08`) so the wire window can partition awaiting-first before slicing.
 */
export function isAwaitingCleanup(card: Card): boolean {
  return card.tmuxSession != null || card.workspacePath != null;
}

/**
 * Done-column paging order (`BOARD-08`): awaiting-cleanup cards sort before cleaned ones, then
 * newest-updated first, then `id` as a total-order tiebreak. The `id` tiebreak is load-bearing —
 * it is what makes a larger `doneLimit` a strict superset of a smaller one, so growing the window
 * (Plan 82-03's "Load more") can never skip or repeat a row the way raw offset pagination would
 * (RESEARCH Pitfall 3), without needing cursor semantics at all.
 */
export function compareDoneOrder(a: Card, b: Card): number {
  const aw = isAwaitingCleanup(a);
  const bw = isAwaitingCleanup(b);
  if (aw !== bw) return aw ? -1 : 1;
  const byUpdated = b.updatedAt.localeCompare(a.updatedAt);
  if (byUpdated !== 0) return byUpdated;
  return a.id.localeCompare(b.id);
}

/**
 * Strip a card's secrets before it leaves the process — the SINGLE sanctioned place a card loses
 * them. Every new read path (windowed `snapshot()`, and any future one) must call this rather than
 * duplicate the strip, so the redaction boundary can never drift. Three responsibilities:
 * (1) remove the card's own secret field; (2) remove `sessions` outright — the full array is
 * server-side only and carries every session's own secret field; (3) resolve the ACTIVE
 * session by `card.activeSessionId` and, when one resolves, FIELD-PICK exactly the six
 * `ActiveSessionWire` keys onto `wireCard.activeSession` — never spread the session object, so the
 * secret is omitted by construction and a future field added to `Session` cannot leak through this
 * path. Operates on the shallow copy only; never mutates the source card's `sessions` array or any
 * session object.
 * @see docs/ARCHITECTURE.md#session-projection-chokepoint
 */
export function redactCard(card: Card): Card {
  const wireCard = { ...card };
  delete wireCard.hookToken;
  delete wireCard.sessions;
  const active = card.sessions?.find((s) => s.id === card.activeSessionId);
  wireCard.activeSession = active
    ? {
        id: active.id,
        tmuxSession: active.tmuxSession,
        ttydPort: active.ttydPort,
        claudeSessionId: active.claudeSessionId,
        workspacePath: active.workspacePath,
        workspace: active.workspace,
      }
    : undefined;
  return wireCard;
}

/**
 * Did a reconcile refresh actually change the card's synced content? reconcile() re-pushes
 * every existing To Do card into upserts as an in-place refresh on every poll (SYNC-02), so a
 * `sync_in` event must fire ONLY when one of the poller-owned fields genuinely differs — else the
 * 60s poll floods the event log with phantom sync-ins for the whole unchanged backlog (CR-01).
 */
function syncedFieldsChanged(prev: Card, next: Card): boolean {
  return (
    prev.title !== next.title ||
    prev.url !== next.url ||
    prev.description !== next.description ||
    prev.priority !== next.priority ||
    prev.updatedAt !== next.updatedAt ||
    prev.goneFromLinear !== next.goneFromLinear ||
    prev.project?.id !== next.project?.id
  );
}

/**
 * The version `load()`'s boot migration pass writes into the meta row's `schemaVersion` field
 * (SESS-04), and the value a later boot compares its own persisted version against to no-op —
 * the idempotency gate that makes a second boot produce the same session count and the same
 * session ids (`NEW-21`). Bump this ONLY when a new migration pass genuinely needs to run again.
 */
const SESSION_SCHEMA_VERSION = 1;

/**
 * Does at least one raw card in `cards` still need {@link migrateCardsToSessionEntity}? Read-only
 * — never mutates — so `load()` can decide whether the reversibility snapshots are worth taking
 * before running the migration pass for real, and skip them outright on a fresh install with zero
 * cards or a board with no session-bearing cards.
 */
function needsSessionEntityMigration(cards: Card[]): boolean {
  return cards.some(
    (card) =>
      card.sessions == null &&
      (card.tmuxSession !== undefined ||
        card.ttydPort !== undefined ||
        card.hookToken !== undefined ||
        card.claudeSessionId !== undefined ||
        card.workspacePath !== undefined ||
        card.workspace !== undefined),
  );
}

/**
 * Migrate every v2.9-shaped card in `cards` into the session-entity shape, in place, returning
 * the count migrated. Per-card idempotent: a card already carrying `sessions` is skipped
 * untouched, so a re-run can never re-mint an id. A card holding at least one of the six session
 * fields gets exactly ONE session record, built as an object literal with the six fields copied
 * straight across — absent fields stay `undefined`, never synthesized, never dropped — and
 * `card.activeSessionId` set to that record's id. A card with none of the six fields gets neither
 * `sessions` nor `activeSessionId` (not an empty array, not a placeholder record) — the "zero
 * session records, no active pointer" invariant. Never writes any flat field, and never writes
 * `card.branch`.
 * @remarks The already-migrated skip and {@link needsSessionEntityMigration}'s counterpart test
 * both use `== null`, not `=== undefined`. A blob carrying `"sessions": null` — a hand edit, a
 * partial future writer, or any producer that normalises an absent array to `null` — satisfies
 * neither `=== undefined` nor its negation, so under a strict check it would be skipped by the
 * migration AND skipped by the needs-migration probe: permanently record-free while still holding
 * flat fields, which is the one card shape {@link BoardStore.setActiveSession}'s projection guard
 * exists to refuse.
 */
function migrateCardsToSessionEntity(cards: Card[]): number {
  let migrated = 0;
  for (const card of cards) {
    if (card.sessions != null) continue;
    const {
      tmuxSession,
      ttydPort,
      hookToken,
      claudeSessionId,
      workspacePath,
      workspace,
    } = card;
    if (
      tmuxSession === undefined &&
      ttydPort === undefined &&
      hookToken === undefined &&
      claudeSessionId === undefined &&
      workspacePath === undefined &&
      workspace === undefined
    ) {
      continue;
    }
    const now = new Date().toISOString();
    const session: Session = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      tmuxSession,
      ttydPort,
      hookToken,
      claudeSessionId,
      workspacePath,
      workspace,
    };
    card.sessions = [session];
    card.activeSessionId = session.id;
    migrated += 1;
  }
  return migrated;
}

class BoardStore extends EventEmitter {
  /** The sole mutable truth. */
  private readonly cards = new Map<string, Card>();
  /** Freshness marker for the last successful Linear sync; null until first sync. */
  private syncedAt: string | null = null;
  /** Non-fatal sync problem from the last poll cycle (e.g. truncated pull); null when healthy. */
  private syncWarning: string | null = null;
  /**
   * Network-level poll-failure flag (transport error, not a data/auth error) — mirrors
   * `syncWarning`'s posture exactly: rides the wire (SSE/REST) so the header can flip to
   * "Reconnecting…" immediately, but is transient runtime state, never persisted to disk.
   * Set true by the poller's TypeError branch, cleared on any successful poll or a
   * RateLimited response (both prove the network is reachable).
   * @see docs/ARCHITECTURE.md#linear-sync
   */
  private syncUnreachable = false;
  /**
   * Static poll interval (ms) surfaced on every snapshot so the client can compute sync
   * staleness. Set once at boot from config via setPollInterval — boot-time static config,
   * NOT a card mutation, so it never goes through the enqueue queue.
   */
  private pollIntervalMs: number | null = null;
  /**
   * Deferred-cleanup delay (ms) `moveCardManual` stamps onto `cleanupDueAt` on a genuine Done
   * arrival (`LIFE-02`). Initialised from the default; the days-based setter below (`LIFE-04`)
   * updates it live at boot and on a Settings save — never retroactively, since only a FUTURE Done
   * arrival reads this field.
   */
  private cleanupDelayMs = DEFAULT_CLEANUP_DELAY_DAYS * MS_PER_DAY;
  /**
   * Editor availability flags surfaced on every snapshot so the client can render VS Code / Cursor
   * buttons. Set once at boot from resolveEditors via setEditors — boot-time static config, NOT a
   * card mutation, so it never goes through the enqueue queue (mirrors pollIntervalMs).
   */
  private editors: { code: boolean; cursor: boolean } = {
    code: false,
    cursor: false,
  };
  /**
   * Registered workspace-folder paths, persisted in board.json and broadcast on every snapshot so
   * the start modal reads them live. Runtime state (unlike the boot-only pollIntervalMs/editors), so
   * every mutation goes through the enqueue queue to broadcast the change.
   */
  private workspaceFolders: string[] = [];
  /** Folder used on the last successful start, preselected in the modal; null when none yet. */
  private lastUsedFolder: string | null = null;
  /**
   * Minted-at-accept counter for `LOCAL-<n>` ticket identifiers (Phase 61), persisted in the meta
   * row alongside every other mutation. Incremented ONLY inside {@link createLocalCard}'s enqueue
   * mutator — the store's existing single-writer queue is the concurrency guard, no separate
   * mutex needed (mirrors every other counter/id-minting decision in this codebase).
   */
  private localTicketCounter = 0;
  /**
   * Minted-at-create counter for `GROUP-<n>` identifiers (Phase 63), persisted in the meta row
   * alongside every other mutation. Incremented ONLY inside {@link createGroupCard}'s enqueue
   * mutator (localTicketCounter precedent) — a SEPARATE counter from localTicketCounter's, per
   * 63-CONTEXT.md Claude's Discretion.
   */
  private groupTicketCounter = 0;
  /**
   * The persisted `meta.schemaVersion` counter (SESS-04), read back in {@link load} and re-emitted
   * by {@link buildMeta} so a migration that already ran stays recorded across every later
   * mutation's persist. Defaults to `0` on a legacy row that predates it.
   */
  private schemaVersion = 0;
  /** Serializes every mutation so mutate -> persist -> emit runs to completion before the next. */
  private queue: Promise<void> = Promise.resolve();
  /**
   * The SQLite persistence handle, opened in load() before any mutation is enqueued. The store
   * itself stays SQL-free — every DB contact lives behind this typed surface in board-db.ts.
   */
  private db!: BoardDb;
  /**
   * Card ids with a start saga currently in flight (CR-01). Transient, in-memory, NOT persisted:
   * no saga survives a restart, so this set is intentionally empty after load(). It is the
   * double-start guard AND the signal reconcile() uses to refuse removing an actively-provisioning
   * To Do card whose Linear issue vanished mid-saga (which would orphan a live session).
   */
  private readonly inFlightStarts = new Set<string>();
  /**
   * Card ids with a Sync-to-Linear request currently in flight (PUSH-01/03). Mirrors
   * `inFlightStarts` EXACTLY: transient, in-memory, NOT persisted — no sync survives a restart, so
   * this set is intentionally empty after load(). Keyed by `card.id`, never a single global flag, so
   * two DIFFERENT local cards may sync concurrently while the SAME card is single-flighted.
   */
  private readonly inFlightSyncs = new Set<string>();
  /**
   * Card ids with a `cleanupWorkspace` teardown currently in flight. Mirrors `inFlightStarts`
   * EXACTLY (transient, in-memory, NOT persisted): a dead process starts with this set empty, and no
   * restart leaves a stale entry behind. Unlike the former scheduler-private `inFlight` set this
   * replaces, it is a SINGLE store-level guard shared by BOTH dispatchers — the manual `/cleanup`
   * route and the automatic due-cleanup scheduler — so the two can never run `cleanupWorkspace`
   * concurrently for the same card (`LIFE-01`/`LIFE-03`).
   */
  private readonly inFlightCleanups = new Set<string>();
  /**
   * Bootstrap-injected releaser for cleared hook tokens. The boundaries DAG forbids
   * store → services, so bootstrap wires services/domain/hook-tokens.ts' unregister function in here
   * (composed with hook-events' activity-throttle reaper, which is why the card id rides along);
   * the no-op default keeps the store safe to use before wiring.
   */
  private releaseHookToken: (token: string, cardId: string) => void = () => {};

  /** Wire the hook-token releaser at boot (bootstrap → store is DAG-legal). */
  setHookTokenReleaser(release: (token: string, cardId: string) => void): void {
    this.releaseHookToken = release;
  }

  /**
   * Clear a card's hookToken AND unregister it from the in-memory token registry in one step —
   * the single chokepoint every session-clearing mutator calls (inside the queue, capturing the
   * field before it is wiped), so a dead session's secret can never keep resolving. Also the
   * ONLY clearing site for the markHookRouted channel latch: every session-death path flows
   * through here, so a relaunched/resumed session always starts hook-silent and re-proves traffic.
   * @remarks Deliberately EXCLUDES `claudeSessionId` — the on-disk Claude transcript outlives a
   * dead tmux session, so a crashed card (markSessionLost calls this) and a failed resume
   * (recordResumeFailure) must KEEP the id to `--resume` back into the original conversation. The
   * field is RESET pre-spawn by the start saga's launch step (resetClaudeSessionId — a fresh
   * kickoff is a new conversation) and CLEARED by Done cleanup (recordCleanupWarning, finishCleanup)
   * with explicit lines; every other session-clearing mutator KEEPS it.
   * @remarks `sessionId` (Phase 91) lets a caller clear a SPECIFIC session's token instead of the
   * card's active one, defaulting to `card.activeSessionId` when omitted — resolved the same way
   * `setActiveSession` resolves its own target, so the two never disagree on which record they
   * mean. The RELEASED token is read off the resolved TARGET session's own `hookToken` — never
   * the card's flat mirror, which may already lag the target on a multi-session card — so a dead
   * sibling's secret stops resolving at the moment this call clears it, not only when the card's
   * active session happens to be the one cleared. The target
   * record's own `hookRoutedAt` is cleared directly on the record (never through
   * `setActiveSession`'s patch — {@link Session.hookRoutedAt} is deliberately unfenced and must
   * never ride that method's six-field mirror). `card.hookRoutedAt` itself stays an unconditional
   * clear here for now, matching this method's six pre-Phase-91 call sites exactly; a later plan
   * gates it on the cleared session being the card's active one.
   */
  private clearHookToken(card: Card, sessionId?: string): void {
    const resolvedId = sessionId ?? card.activeSessionId;
    const target = card.sessions?.find((s) => s.id === resolvedId);
    if (target?.hookToken) this.releaseHookToken(target.hookToken, card.id);
    this.setActiveSession(card, { hookToken: undefined }, sessionId);
    if (target) target.hookRoutedAt = undefined;
    card.hookRoutedAt = undefined;
  }

  /**
   * The single projection chokepoint (`NEW-21`): the six flat session fields on `Card` —
   * `tmuxSession`, `ttydPort`, `hookToken`, `claudeSessionId`, `workspacePath`, `workspace` — are a
   * PROJECTION of the card's ACTIVE session record, and this is the ONLY method in the codebase
   * that may assign them. Every write site funnels its field(s) through this call instead of
   * assigning the card directly.
   * @remarks `updatedAt` means what {@link Session} says it means — the timestamp of the record's
   * last FIELD MUTATION, not of the last mutator call. It is re-stamped only when the patch
   * actually changes a value, so the no-op patches this chokepoint legitimately receives
   * (`clearHookToken` on a card whose token is already `undefined`, `resetClaudeSessionId` on a
   * card with no id, `clearStaleTtydPort` on a card with no port) leave it alone. A consumer using
   * `updatedAt` to detect real change — a diff, a staleness heuristic, a "last activity" line —
   * can therefore trust it. On the mint path it is not re-stamped at all, which is what keeps the
   * same-instant promise below literally true rather than true-unless-the-two-clock-reads-straddle-
   * a-millisecond.
   * @remarks Create-if-absent minting: if no session resolves from `card.activeSessionId` AND
   * `patch` carries at least one defined value, a fresh {@link Session} is minted (opaque
   * `randomUUID()` id, `createdAt`/`updatedAt` stamped to the same instant) and appended to
   * `card.sessions`, with `card.activeSessionId` set to its id in the SAME synchronous block — so
   * no interleaving can ever observe `sessions` without an active pointer, or an active pointer
   * naming a session that does not exist. The mint is guarded by an ALL-UNDEFINED-PATCH check: if
   * no session resolves and every value in `patch` is `undefined`, nothing is minted — without
   * this, `hydrateFromParsed`'s To-Do `ttydPort` correction would mint an empty session record on
   * every To Do card at boot, contradicting the invariant that a card with no session owns zero
   * session records.
   * @remarks The mirror at the end is guarded, not unconditional. If no session resolves AND the
   * patch mints nothing, writing `active?.field` into all six flat fields would set every one of
   * them to `undefined` — a silent, event-free destruction of `workspacePath`/`workspace` that
   * makes the card's session unrecoverable (`SessionLostSection`'s Resume affordance reads
   * `card.workspacePath`; the Restart route 400s on a missing `card.workspace`). No current call
   * site reaches that state — post-migration every card holding flat fields also holds a
   * resolvable record — but that is a property inherited from the migration's completeness, not
   * one this method asserts, so it asserts it: a card holding flat session state with no
   * resolvable record is a corrupt card, and this logs and refuses rather than quietly erasing
   * what is left. Cards with no flat state fall through to the mirror as before, which is what
   * keeps the boot-time To-Do `ttydPort` correction working.
   * @remarks Clear-in-place: a mutator that clears session fields (`markSessionLost`,
   * `recordResumeFailure`, `recordCleanupWarning`, `finishCleanup`) sets those fields to
   * `undefined` ON the existing active session record. It NEVER removes the record from
   * `card.sessions` and NEVER clears `card.activeSessionId` — this reproduces today's exact
   * semantics (one record whose individual fields may legitimately be undefined) and defers the
   * dead-session removal/tombstone question to the phases that own liveness and cleanup.
   * @remarks `targetSessionId` (Phase 91) lets a caller address a SPECIFIC session record instead
   * of the card's active one — defaulting to `card.activeSessionId` when omitted, so every
   * pre-Phase-91 call site keeps its exact prior behaviour. The mint-on-absent branch fires ONLY
   * when `targetSessionId` is omitted: an explicit id that resolves to nothing is a caller bug
   * (a stale or foreign session id), not a mint trigger, and hits the SAME
   * `console.error`-and-refuse branch below rather than silently minting a record under an id the
   * caller does not actually own.
   * @remarks `promoteTarget` (Phase 91) repoints `card.activeSessionId` at the resolved target
   * BEFORE the closing six-field re-derivation, so the promotion and the mirror it feeds land in
   * the SAME synchronous call — no interleaving can ever observe a card whose flat projection
   * still mirrors the just-cleared session. `promoteTarget` is meaningless without an explicit
   * `targetSessionId`; passing it `true` with no target is a caller bug and hits the same
   * `console.error`-and-refuse branch.
   * @see docs/ARCHITECTURE.md#session-projection-chokepoint
   */
  private setActiveSession(
    card: Card,
    patch: Partial<Omit<Session, "id" | "createdAt" | "updatedAt">>,
    targetSessionId?: string,
    promoteTarget = false,
  ): void {
    if (promoteTarget && targetSessionId === undefined) {
      console.error(
        `[store] card ${card.id} — promoteTarget requires an explicit targetSessionId, refusing to project`,
      );
      return;
    }
    const resolvedId = targetSessionId ?? card.activeSessionId;
    let active = card.sessions?.find((s) => s.id === resolvedId);
    const patchHasValue = Object.values(patch).some((v) => v !== undefined);
    let minted = false;
    if (!active && targetSessionId === undefined && patchHasValue) {
      const now = new Date().toISOString();
      active = { id: randomUUID(), createdAt: now, updatedAt: now };
      card.sessions = card.sessions ?? [];
      card.sessions.push(active);
      card.activeSessionId = active.id;
      minted = true;
    }
    if (active) {
      const record = active;
      const entries = Object.entries(patch) as [
        keyof typeof patch,
        Session[keyof typeof patch],
      ][];
      const changed = entries.some(([key, value]) => record[key] !== value);
      Object.assign(record, patch);
      if (changed && !minted) record.updatedAt = new Date().toISOString();
      if (promoteTarget) card.activeSessionId = record.id;
    } else if (
      targetSessionId !== undefined ||
      card.tmuxSession != null ||
      card.workspacePath != null
    ) {
      console.error(
        `[store] card ${card.id} — no session resolves for ${targetSessionId !== undefined ? `explicit target ${targetSessionId}` : "the active pointer, but flat session fields are set"} — refusing to project`,
      );
      return;
    }
    const mirrored = card.sessions?.find((s) => s.id === card.activeSessionId);
    card.tmuxSession = mirrored?.tmuxSession;
    card.ttydPort = mirrored?.ttydPort;
    card.hookToken = mirrored?.hookToken;
    card.claudeSessionId = mirrored?.claudeSessionId;
    card.workspacePath = mirrored?.workspacePath;
    card.workspace = mirrored?.workspace;
  }

  /**
   * Fan a group card's column write out to its members, silently, in the SAME enqueue closure as
   * the group's own `column` assignment (Phase 63, Pattern 1) — a no-op for every ordinary card
   * (`memberIds` absent/empty). Called from exactly the five runtime column-writing mutators
   * (`attachExistingSession`, `applyMarker`, `flipBack`, `moveCardManual`, `completeStart`); never
   * from a cleanup/session-field mutator (members never carry `tmuxSession`/`hookToken`/
   * `workspacePath` — there is no per-member teardown surface to guard) and never from the
   * boot-hydration column write. Emits no event of its own — the locked design is ONE activity
   * event per group move, member mirroring silent.
   */
  private mirrorMemberColumn(card: Card, column: Column): void {
    if (!card.memberIds || card.memberIds.length === 0) return;
    for (const id of card.memberIds) {
      const member = this.cards.get(id);
      if (member) member.column = column;
    }
  }

  /**
   * Enqueue a mutation. The chained promise guarantees single-writer ordering — WAL gives
   * transaction atomicity, NOT the Map read-modify-write serialization or the SSE broadcast
   * ordering, so the queue is retained even though each persist is now transactional. The
   * in-memory Map is the source of truth: the broadcast (step 4) MUST fire even when the
   * persist (step 3) fails, or SSE clients silently diverge from the state that GET /api/board
   * already reports. A failed persist is logged (the log prints only the write error, never
   * snapshot contents — the DB carries per-session hook tokens) and simply retried by the next
   * mutation's write. The persist consumes the FULL card set (`this.cards.values()`, INCLUDING
   * hookToken); the broadcast emits the REDACTED wire snapshot (snapshot()), so secrets reach
   * the DB but never an SSE frame. Errors are caught inside the chain so one failed step can
   * never break the queue for subsequent mutations. Ahead of the write, an hourly best-effort
   * SQLite snapshot is folded into the backup chain (backupTick is itself never-throw, so a
   * backup failure can never fail the write or the broadcast; it is a no-op the rest of the hour).
   * @remarks The mutator RETURNS the events it wants appended (`[]` for a no-op), which persist
   * inserts in the SAME transaction as the card write. The two broadcasts are ASYMMETRIC: the
   * board `change` frame fires unconditionally from the in-memory Map (source of truth), but each
   * `activity` frame fires ONLY after a durable insert (persist returned matching ids) — a persist
   * failure must not advertise an event GET /api/events will never return (Pitfall 5).
   * @remarks `BOARD-08`: `change` is emitted with NO payload — deliberately, since Plan 82-02.
   * Once different SSE connections legitimately want different `doneLimit` windows, a single
   * pre-built snapshot can no longer serve them all; leaving one attached to the event would be a
   * loaded gun; a broadcast listener could accidentally reuse it and silently prune every
   * connection back to the default window (the "load-more amnesia" bug). Every listener must call
   * `store.snapshot({ doneLimit })` itself, once per distinct window.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  private enqueue(mutator: () => Omit<ActivityEvent, "id">[]): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const events = mutator();
        await this.db.backupTick();
        let broadcast: ActivityEvent[] = [];
        try {
          const ids = this.db.persist(
            [...this.cards.values()],
            this.buildMeta(),
            events,
          );
          if (ids.length === events.length) {
            broadcast = events.map((e, i) => ({ ...e, id: ids[i] }));
          }
        } catch (err) {
          console.error(
            "[store] persist failed (in-memory state still broadcast):",
            err,
          );
        }
        this.emit("change");
        for (const ev of broadcast) this.emit("activity", ev);
      })
      .catch((err: unknown) => {
        console.error("[store] mutation failed:", err);
      });
    return this.queue;
  }

  /**
   * Stamp the append `ts` and default the nullable event columns so each mutator stays terse and
   * only spells out the fields its taxonomy row actually carries.
   */
  private event(
    type: EventType,
    partial: Partial<Omit<ActivityEvent, "id" | "type" | "ts">> = {},
  ): Omit<ActivityEvent, "id"> {
    return {
      type,
      ts: new Date().toISOString(),
      cardId: partial.cardId ?? null,
      fromCol: partial.fromCol ?? null,
      toCol: partial.toCol ?? null,
      reason: partial.reason ?? null,
      source: partial.source ?? null,
    };
  }

  /**
   * Assemble the non-card meta row persisted alongside the cards — the same fields
   * persistSnapshot carried in board.json's envelope (syncWarning/pollIntervalMs/editors
   * stay in-memory-only, as they were absent from the persisted shape before).
   */
  private buildMeta(): BoardMeta {
    return {
      syncedAt: this.syncedAt,
      workspaceFolders: this.workspaceFolders,
      lastUsed: this.lastUsedFolder,
      localTicketCounter: this.localTicketCounter,
      groupTicketCounter: this.groupTicketCounter,
      schemaVersion: this.schemaVersion,
    };
  }

  /**
   * Open the board database and hydrate the in-memory Map from it. On first boot with a legacy
   * board.json and an empty DB, import the file's cards + meta in ONE transaction, then rename it
   * to board.json.pre-sqlite (never read again — STORE-02); a fresh install with no board.json
   * and an empty DB hydrates an empty board with no error. A corrupt primary self-heals inside
   * openBoardDb (renamed to board.db.corrupt, restored from the newest clean snapshot with a loud
   * named log — STORE-04), so this path never throws on a bad file. The DB rows feed the SAME
   * hydrateFromParsed used before, so interrupted-provisioning -> retryable startError, the
   * unconditional `terminalError` reset, and the column-guarded `ttydPort` handling (ROBU-01)
   * happen identically on the import and DB-row paths.
   *
   * Between reading the raw rows and hydrating them, the session-entity boot migration runs
   * (SESS-04, `NEW-21`): every v2.9-shaped card gets projected into exactly one `Session` record
   * behind `card.activeSessionId`, BEFORE `hydrateFromParsed` — the point any reader first sees a
   * card — ever runs.
   * @remarks The persisted `meta.schemaVersion` is the idempotency gate: a boot whose persisted
   * version is already at {@link SESSION_SCHEMA_VERSION} takes no snapshot and runs no migration
   * pass at all, so a second boot reproduces the same session count and the same session ids. When
   * migration IS due, the two reversibility snapshots run in the approved order — the cheap
   * never-rotated `snapshotPreV3()` copy FIRST, then the forced `backupTick(true)` fold into the
   * rotating chain — so even if the (contractually never-throwing) forced tick somehow threw, the
   * retained snapshot already landed on disk. Both are skipped only when nothing on the board needs
   * migrating (a fresh install, or a board with no session-bearing card). The migrated in-memory
   * state is persisted through the EXISTING transactional `enqueue`/`persist` path rather than a
   * separate raw-SQL write, so a crash mid-persist rolls back to the unmigrated, version-0 meta row
   * and the next boot re-runs the pass cleanly — a half-migrated database is impossible.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  async load(): Promise<void> {
    this.db = openBoardDb();
    if (this.db.cardCount() === 0 && fs.existsSync(BOARD_PATH)) {
      try {
        const parsed = JSON.parse(
          await fs.promises.readFile(BOARD_PATH, "utf8"),
        ) as Partial<BoardSnapshot>;
        this.db.importParsed(parsed);
        await fs.promises.rename(BOARD_PATH, `${BOARD_PATH}.pre-sqlite`);
        console.log(
          `[store] imported board.json into board.db and renamed it to ${BOARD_PATH}.pre-sqlite.`,
        );
      } catch (err) {
        console.warn(
          `[store] board.json at ${BOARD_PATH} was unreadable/unparseable — skipping import, starting from the database:`,
          (err as Error).message,
        );
      }
    }
    const { cards, meta } = this.db.readAll();
    const persistedSchemaVersion =
      typeof meta.schemaVersion === "number" ? meta.schemaVersion : 0;
    const migrationDue = persistedSchemaVersion < SESSION_SCHEMA_VERSION;
    let migratedCount = 0;
    if (migrationDue) {
      if (needsSessionEntityMigration(cards)) {
        this.db.snapshotPreV3();
        await this.db.backupTick(true);
        migratedCount = migrateCardsToSessionEntity(cards);
      }
      this.schemaVersion = SESSION_SCHEMA_VERSION;
    } else {
      this.schemaVersion = persistedSchemaVersion;
    }
    this.hydrateFromParsed({
      cards,
      syncedAt: meta.syncedAt ?? null,
      workspaceFolders: meta.workspaceFolders,
      lastUsed: meta.lastUsed,
    });
    this.localTicketCounter =
      typeof meta.localTicketCounter === "number" ? meta.localTicketCounter : 0;
    this.groupTicketCounter =
      typeof meta.groupTicketCounter === "number" ? meta.groupTicketCounter : 0;
    console.log(`[store] loaded ${this.cards.size} card(s) from board.db.`);
    if (migrationDue) {
      console.log(
        `[store] session-entity migration: migrated ${migratedCount} card(s), schema version now ${this.schemaVersion}.`,
      );
      await this.enqueue(() => []);
    }
  }

  /**
   * Apply a parsed snapshot to the in-memory Map, shared by the healthy-load and backup-recovery
   * paths so a recovered board hydrates byte-for-byte identically to a healthy one: rebuild the
   * cards Map, rewrite any interrupted in-flight provisioning into a retryable startError, reset
   * the transient `terminalError`/`syncing`, and default syncedAt / workspaceFolders / lastUsed.
   * `ttydPort` is preserved for every card except To Do (ROBU-01, widened by `LIFE-03`) — a To Do
   * card structurally carries no live session post-load, so clearing it there costs nothing, but a
   * Done card can now legitimately hold one for the length of its deferred-cleanup window
   * (`LIFE-02`), exactly like any other active-column card: its port is the one thing boot-time
   * reconcile needs to attempt re-adopting the still-running ttyd instead of it being swept as an
   * orphan. `reconcileSessions()` clears it back via `clearStaleTtydPort` for any candidate whose
   * adoption attempt fails, so a genuinely dead port never lingers past the first reconcile pass.
   *
   * @remarks Also migrates any card stranded on the retired `in_planning` column (KICK-02): a
   * card carrying a live `tmuxSession` resolves to `in_progress` (the session keeps running — a
   * stale name is corrected to sessionLost by the existing boot-time `reconcileSessions()` pass on
   * the very next line of boot code, same as any other dead-session card), a card with none
   * resolves to the "To Do" column. The persisted string is read via an untyped cast because
   * `"in_planning"` is no longer a member of `Column` — no live write path can ever produce it
   * again, so this check needs no re-migration guard. The legacy `mode`/`planReady` fields and
   * `startIntent.targetColumn` are stripped from the loaded object in the same pass (one-way, no
   * back-compat shim) so they never round-trip back into a future persist.
   */
  private hydrateFromParsed(parsed: Partial<BoardSnapshot>): void {
    const loaded = Array.isArray(parsed.cards) ? parsed.cards : [];
    this.cards.clear();
    for (const card of loaded) {
      if (card && typeof card.id === "string") {
        const legacy = card as unknown as Record<string, unknown>;
        if (legacy.column === "in_planning") {
          card.column = card.tmuxSession ? "in_progress" : "todo";
        }
        delete legacy.mode;
        delete legacy.planReady;
        if (
          card.startIntent &&
          typeof card.startIntent === "object" &&
          "targetColumn" in card.startIntent
        ) {
          card.startIntent = { playbook: card.startIntent.playbook };
        }
        if (card.provisioningStep != null) {
          card.startError = {
            step: "interrupted",
            stderr:
              "The server restarted while this start was still provisioning. Any partially-created worktrees or session were left in place — Retry to reconcile and continue.",
            variant: "generic",
          };
          card.provisioningStep = null;
        }
        if (card.column === "todo" && card.ttydPort != null) {
          this.setActiveSession(card, { ttydPort: undefined });
        }
        card.terminalError = null;
        card.syncing = undefined;
        this.cards.set(card.id, card);
      }
    }
    this.syncedAt =
      typeof parsed.syncedAt === "string" ? parsed.syncedAt : null;
    this.workspaceFolders = Array.isArray(parsed.workspaceFolders)
      ? parsed.workspaceFolders
      : [];
    this.lastUsedFolder =
      typeof parsed.lastUsed === "string" ? parsed.lastUsed : null;
  }

  /**
   * Build the FULL persisted snapshot — the exact board.json contents, INCLUDING each card's
   * `hookToken` (the restart-time registry rebuild reads it back from disk). Persist-only:
   * every payload that leaves the process goes through snapshot(), which redacts.
   */
  private persistSnapshot(): BoardSnapshot {
    const all = [...this.cards.values()];
    const todo = all.filter((c) => c.column === "todo").sort(compareTodoOrder);
    const rest = all.filter((c) => c.column !== "todo");
    return {
      cards: [...todo, ...rest],
      syncedAt: this.syncedAt,
      syncWarning: this.syncWarning,
      syncUnreachable: this.syncUnreachable,
      pollIntervalMs: this.pollIntervalMs ?? undefined,
      editors: this.editors,
      workspaceFolders: this.workspaceFolders,
      lastUsed: this.lastUsedFolder,
    };
  }

  /**
   * Build the canonical WIRE snapshot (SSE frames + REST reads) — the single read-path chokepoint
   * for ordering, redaction, AND windowing (`BOARD-08`). The To Do cards are sorted with
   * compareTodoOrder on this read path; other columns carry no Phase-1 ordering decision (the
   * frontend re-partitions by `column`, so cross-column concat order is irrelevant). A bare call
   * (`opts` omitted) returns the FULL, un-windowed set — internal readers (e.g.
   * `adapters/terminal-proxy.ts`, `adapters/ttyd.ts`) keep working unchanged; only
   * `opts.doneLimit` windows the Done column, and only the two wire endpoints
   * (`GET /api/board`, `GET /api/stream`) opt in.
   * `doneCounts` is computed from the FULL set on every call regardless of windowing, so the
   * column badge and the Phase 81 awaiting/cleaned split stay truthful even when fewer Done cards
   * ride the wire than exist. A Done GROUP MEMBER rides the wire whenever its parent does — it is
   * dropped only when its parent is a top-level Done card sitting outside the page — so
   * `membersOf()` never sees a half-populated group (RESEARCH Open Question 1).
   * SECURITY: this is the single outbound chokepoint — each kept card is redacted via
   * {@link redactCard}, so the per-session hook-auth secret never rides an SSE frame or a REST
   * response, from the card OR from any session copy (only the persisted board.json carries it).
   * `activeSession` is a field-picked projection, never a spread, so a future `Session` field
   * cannot leak through it. Redact future secret-adjacent card fields there (hookRoutedAt was
   * considered and deliberately rides the wire — a non-secret timestamp).
   * @see docs/ARCHITECTURE.md#sse-transport
   */
  snapshot(opts?: { doneLimit?: number }): BoardSnapshot {
    const snap = this.persistSnapshot();
    const doneTop = snap.cards.filter(
      (c) => c.column === "done" && c.groupId == null,
    );
    const awaitingCount = doneTop.filter(isAwaitingCleanup).length;
    const doneCounts = {
      awaiting: awaitingCount,
      cleaned: doneTop.length - awaitingCount,
      total: doneTop.length,
    };
    let kept = snap.cards;
    if (opts?.doneLimit != null) {
      const outOfWindow = new Set(
        [...doneTop]
          .sort(compareDoneOrder)
          .slice(opts.doneLimit)
          .map((c) => c.id),
      );
      kept = snap.cards.filter(
        (c) =>
          c.column !== "done" ||
          (c.groupId == null && !outOfWindow.has(c.id)) ||
          (c.groupId != null && !outOfWindow.has(c.groupId)),
      );
    }
    return {
      ...snap,
      cards: kept.map(redactCard),
      doneCounts,
    };
  }

  /**
   * Record the static poll interval (ms) at boot so every snapshot (REST + SSE) carries it for
   * the client-side stale-sync computation. Plain setter — boot-time static config, not a card
   * mutation, so it bypasses the enqueue queue.
   */
  setPollInterval(ms: number): void {
    this.pollIntervalMs = ms;
  }

  /**
   * Set the deferred-cleanup delay (`LIFE-04`) applied to FUTURE Done arrivals only. Plain setter,
   * mirroring `setPollInterval` — bypasses the enqueue queue since it mutates no card and emits no
   * snapshot. Never touches an already-stamped `cleanupDueAt`: a card keeps the due date it was
   * given at Done, so changing this value can never reschedule a card already awaiting cleanup.
   */
  setCleanupDelayDays(days: number): void {
    this.cleanupDelayMs = days * MS_PER_DAY;
  }

  /**
   * Record editor availability at boot so every snapshot (REST + SSE) carries it for the client's
   * VS Code / Cursor buttons. Plain setter — boot-time static config, not a card mutation, so it
   * bypasses the enqueue queue (routing it through the queue would broadcast a spurious boot
   * "change" frame).
   */
  setEditors(e: { code: boolean; cursor: boolean }): void {
    this.editors = e;
  }

  /**
   * Flip the network-unreachable flag from the poller's TypeError branch and broadcast it —
   * routed through `enqueue()` (unlike `setPollInterval`/`setEditors`) because this is runtime
   * state that changes throughout the process's life and the header needs to see every flip
   * immediately, not just at boot. Returns no activity events: connectivity blips are not
   * user-facing activity, only a header-state signal.
   */
  setSyncUnreachable(flag: boolean): Promise<void> {
    return this.enqueue(() => {
      this.syncUnreachable = flag;
      return [];
    });
  }

  /** Does a card with this id exist? Synchronous read for REST payload validation. */
  hasCard(id: string): boolean {
    return this.cards.has(id);
  }

  /**
   * Synchronous read of a single card, for the start route's config/identifier checks
   * (mirrors hasCard). Returns the live Map entry (undefined if unknown) — callers must
   * NOT mutate it; all mutations flow through the enqueue-wrapped methods below.
   */
  getCard(id: string): Card | undefined {
    return this.cards.get(id);
  }

  /**
   * Live, unredacted members of a group card, read from the full in-memory set (not the windowed
   * wire snapshot) — the server-side mirror of the client's group-members.ts#membersOf filter.
   * Callers must redact each entry before it leaves the process, exactly like getCard's callers do.
   */
  membersOf(groupId: string): Card[] {
    return [...this.cards.values()].filter((c) => c.groupId === groupId);
  }

  /**
   * Synchronous read of the registered workspace folders + last-used pick, for
   * `GET /workspace-folders` (mirrors getCard — a cheap field read that has no need to build a
   * full, redacted, potentially windowed `BoardSnapshot`).
   */
  getWorkspaceFolders(): { folders: string[]; lastUsed: string | null } {
    return { folders: this.workspaceFolders, lastUsed: this.lastUsedFolder };
  }

  /**
   * Case-insensitive substring search over every card's identifier/title, the one query path
   * `GET /api/search` uses to reach cards the client's windowed board view has never loaded
   * (SCALE-03). Synchronous read over the live `Map` — no SQL and no index, because
   * `board-db.ts` persists cards as opaque JSON blobs and the process already holds every card
   * parsed, so at the phase's 500-card target this is a sub-millisecond two-field scan. Projects
   * each match down to the four-field `CardSearchResult` (never a `Card`/`Partial<Card>`) so no
   * other field — least of all `hookToken` — can ride the response by construction (`T-82-03`).
   * `total` is the FULL match count, not the capped one, so the UI's "Showing top N of total" row
   * stays truthful. Excludes group members (`groupId != null`): every other rendering and mutation
   * path treats a member as unselectable on its own (`Board.tsx`'s column filter,
   * `groupedMemberError` at every mutating route), so search must not be the one path that lets a
   * user open one directly.
   */
  searchCards(
    query: string,
    limit: number,
  ): { results: CardSearchResult[]; total: number } {
    const q = query.toLowerCase();
    const matches = [...this.cards.values()].filter(
      (c) =>
        c.groupId == null &&
        (c.identifier.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q)),
    );
    return {
      results: matches.slice(0, limit).map((c) => ({
        id: c.id,
        identifier: c.identifier,
        title: c.title,
        column: c.column,
      })),
      total: matches.length,
    };
  }

  /**
   * Newest-first read of the append-only activity log for the REST route (`null` cardId = whole
   * board, a string scopes to one card). A pure synchronous read delegated to the BoardDb surface
   * (hasCard/getCard precedent) so the route never imports better-sqlite3; not enqueued.
   */
  listEvents(cardId: string | null, limit: number): ActivityEvent[] {
    return this.db.listEvents(cardId, limit);
  }

  /**
   * Is a start saga currently in flight for this card? Synchronous double-start guard for the
   * orchestrator (CR-01). Not queued/persisted — a purely transient in-memory marker.
   */
  isStarting(id: string): boolean {
    return this.inFlightStarts.has(id);
  }

  /**
   * Mark a start saga as in flight. MUST be called synchronously (no await between the isStarting
   * check and this) so a concurrent poll can never see the card as removable before the marker is
   * set. Not queued/persisted.
   */
  beginStart(id: string): void {
    this.inFlightStarts.add(id);
  }

  /** Clear the in-flight marker when a start saga settles (success or failure). */
  endStart(id: string): void {
    this.inFlightStarts.delete(id);
  }

  /**
   * Is a `cleanupWorkspace` teardown currently in flight for this card? Synchronous shared guard
   * (mirrors `isStarting` exactly) consulted by BOTH the manual `/cleanup` route and the automatic
   * due-cleanup scheduler, so the two can never dispatch concurrently against the same card's
   * worktree-removal/`fs.rm` steps. Not queued/persisted.
   */
  isCleaningUp(id: string): boolean {
    return this.inFlightCleanups.has(id);
  }

  /**
   * Mark a cleanup teardown as in flight. MUST be called synchronously (no await between the
   * `isCleaningUp` check and this) so a concurrent dispatcher can never see the card as cleanable
   * before the marker is set — same discipline as `beginStart`.
   */
  beginCleanup(id: string): void {
    this.inFlightCleanups.add(id);
  }

  /** Clear the in-flight marker when a cleanup dispatch settles (success, warning, or throw). */
  endCleanup(id: string): void {
    this.inFlightCleanups.delete(id);
  }

  /**
   * Is a Sync-to-Linear request currently in flight for this card? Synchronous per-card guard for
   * the sync route (mirrors `isStarting` exactly). Not queued/persisted.
   */
  isSyncing(id: string): boolean {
    return this.inFlightSyncs.has(id);
  }

  /**
   * Mark a sync as in flight. MUST be called synchronously (no await between the isSyncing check
   * and this) so a concurrent request for the SAME card can never race past the guard. Not
   * queued/persisted.
   */
  beginSync(id: string): void {
    this.inFlightSyncs.add(id);
  }

  /** Clear the in-flight marker when a sync attempt settles (success or failure). */
  endSync(id: string): void {
    this.inFlightSyncs.delete(id);
  }

  /**
   * Record the current provisioning step (card line 3). The card stays in "To Do" while
   * provisioning — column is untouched — and any prior startError is cleared so a retry's
   * progress replaces the stale error. No-op if the id is unknown.
   */
  setProvisioning(id: string, step: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.provisioningStep = step;
        card.startError = null;
      }
      return [];
    });
  }

  /**
   * Persist the extra-direction text captured at Start (no column/status change). Written
   * before the saga runs so Retry and the Phase-3 detail panel can reuse it. No-op if unknown.
   */
  setExtraDirection(id: string, text: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.extraDirection = text;
      return [];
    });
  }

  /**
   * Persist the start intent (playbook name) captured at Start, BEFORE the saga runs (the
   * setExtraDirection precedent), so Retry after a failed start and a bare Restart can reproduce
   * the original playbook choice instead of silently degrading to a playbook-less session.
   * No-op if the id is unknown.
   */
  setStartIntent(id: string, intent: { playbook?: string }): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.startIntent = intent;
      return [];
    });
  }

  /**
   * Register a workspace folder (runtime write — broadcasts via the queue). Re-adding an already
   * registered folder is a no-op: the modal treats "add an existing folder" as merely selecting it,
   * so a duplicate must not grow the list or emit a spurious change.
   */
  addWorkspaceFolder(path: string): Promise<void> {
    return this.enqueue(() => {
      if (!this.workspaceFolders.includes(path)) {
        this.workspaceFolders.push(path);
      }
      return [];
    });
  }

  /**
   * Unregister a workspace folder. If it was the last-used folder, retarget lastUsed to the first
   * remaining folder (or null) so the modal never preselects a folder that no longer exists.
   */
  removeWorkspaceFolder(path: string): Promise<void> {
    return this.enqueue(() => {
      this.workspaceFolders = this.workspaceFolders.filter((f) => f !== path);
      if (this.lastUsedFolder === path) {
        this.lastUsedFolder = this.workspaceFolders[0] ?? null;
      }
      return [];
    });
  }

  /**
   * Remember the folder of a SUCCESSFUL start so the modal preselects it next time. Called only on
   * a completed start, not on mere selection, so an abandoned modal never changes the default.
   */
  setLastUsedFolder(path: string): Promise<void> {
    return this.enqueue(() => {
      this.lastUsedFolder = path;
      return [];
    });
  }

  /**
   * Attach the chosen workspace (folder + absolute repo/base pairs) to a card BEFORE the saga runs,
   * so Retry re-submits the persisted value and resume/restart/cleanup never re-read the registry.
   * No-op if the id is unknown (mirrors setExtraDirection).
   */
  setCardWorkspace(
    id: string,
    workspace: { folder: string; repos: { path: string; base: string }[] },
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.setActiveSession(card, { workspace });
      return [];
    });
  }

  /**
   * Set or clear the transient card status reason (e.g. clear the "Already running —
   * reattached" copy a few seconds after an idempotent reattach). No-op if the id is unknown.
   */
  setStatusReason(id: string, reason: string | null): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.statusReason = reason ?? undefined;
      return [];
    });
  }

  /**
   * Set or clear the wire-visible in-flight Sync-to-Linear flag (single-field enqueue, the
   * `setStatusReason` precedent) so the UI sees the flag flip over SSE. No-op if the id is unknown.
   */
  setSyncing(id: string, syncing: boolean): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.syncing = syncing;
      return [];
    });
  }

  /**
   * Mint the hook channel's credential at session launch: stamp `card.hookToken` ONLY. Written
   * BEFORE the session spawns (`steps.ts#startClaude` / `resume-session.ts#resumeSession`'s
   * hooks-capable branches, immediately before `newSession`) so a hook POST arriving as early as
   * the kickoff paste already authenticates. SECURITY: the token value is never logged. No-op if
   * the id is unknown.
   * @remarks (`WR-05`) This mutator deliberately does NOT stamp `card.hookRoutedAt`. The latch is
   * EVIDENCE that hook events actually arrive, never a PREDICTION derived from a `claude --version`
   * parse: the capability check says nothing about whether the hook script's `curl` exists on the
   * spawned session's PATH, and that script exits 0 on failure by design so the transport can fail
   * completely and silently. Stamping the latch here would close the watcher's `auto` gate for such
   * a session and leave it with ZERO status channels — no marker scan, no flip-back, no activity
   * dot — permanently. Arbitration must always fail toward HAVING a channel: `markHookRouted`, on
   * the first authenticated event, is the only place the latch may be written.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  mintHookChannel(id: string, token: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.setActiveSession(card, { hookToken: token });
      return [];
    });
  }

  /**
   * Stamp the Claude CLI `session_id` first-event-wins so exact Resume can `--resume <id>` back
   * into this conversation (SID-01). Single-field enqueue (setStatusReason precedent) with an
   * in-queue `== null` re-check (markHookRouted precedent), so the never-overwrite decision is
   * authoritative HERE: a racing second hook event finds the id already set and no-ops. The
   * differing-id case is handled by the caller (a logged mismatch), never a silent overwrite.
   * No-op if the id is unknown or already stamped.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  setClaudeSessionId(id: string, sessionId: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card && card.claudeSessionId == null)
        this.setActiveSession(card, { claudeSessionId: sessionId });
      return [];
    });
  }

  /**
   * Clear a card's recorded Claude session id BEFORE a fresh session spawns. Called by the start
   * saga's launch step (a new kickoff is a new conversation) so the reset lands ahead of the
   * kickoff paste's first hook event — otherwise a restart of a card that still holds its old id
   * would make the new session's early events log a spurious `session_id mismatch` and drop the
   * genuine first capture. Symmetric with the pre-spawn hook-token mint. Distinct from the
   * first-event-wins setter and never called on the resume path, which must KEEP the id.
   * No-op if the id is unknown.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  resetClaudeSessionId(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.setActiveSession(card, { claudeSessionId: undefined });
      return [];
    });
  }

  /**
   * Record the ISO timestamp of the last observed ⏺-view divergence for a live session
   * (ATTN-02 unseen-activity dot). Mirrors setStatusReason exactly: a single-field enqueue.
   * This is a SEPARATE logical event from a column move — it does NOT touch `column`, so it
   * may legitimately fire in the same tick as an applyMarker/flipBack move (two independent
   * SSE frames). Do not coalesce it into the marker decision. No-op if the id is unknown.
   */
  setOutputChanged(id: string, iso: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.outputChangedAt = iso;
      return [];
    });
  }

  /**
   * Record the PR(s) detected for a card's branch this tick, ONLY if the card still names
   * `session` as its tmux session. Mirrors setOutputChanged: a single-field enqueue, no
   * column/other-field interaction, no activity event (the EventType union stays frozen).
   * Collapses an empty result to `undefined` rather than `[]` so a deleted/merged-away-then-gone
   * PR clears the field in the same write a fresh detection would use, satisfying the "cleared
   * when a detection pass finds no PR" without a second mutator. The session guard runs INSIDE the
   * mutation queue (setTtydPortIfSession precedent) because a detection tick holds its result for
   * up to the 8s `gh` timeout: a Done-drag cleanup enqueued during that window must win, or this
   * write would resurrect a stale badge on an already-torn-down card. No-op if the
   * id is unknown.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  setPrsIfSession(id: string, session: string, prs: PrInfo[]): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card?.tmuxSession === session)
        card.prs = prs.length > 0 ? prs : undefined;
      return [];
    });
  }

  /**
   * Record the dev-server preview(s) detected for a card's session this tick, ONLY if the card
   * still names `session` as its tmux session — byte-for-byte the `setPrsIfSession` shape. The
   * session guard runs INSIDE the mutation queue (setPrsIfSession/setTtydPortIfSession precedent):
   * a Done-drag teardown enqueued during the detection window must win, or this write would
   * resurrect a badge on an already-torn-down card. Collapses an empty result to `undefined`
   * rather than `[]` so a died listener clears the field in the same write a fresh detection
   * would use. No-op if the id is unknown.
   * @see docs/ARCHITECTURE.md#dev-server-preview-detection
   */
  setPreviewsIfSession(
    id: string,
    session: string,
    previews: PreviewInfo[],
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card?.tmuxSession === session)
        card.previews = previews.length > 0 ? previews : undefined;
      return [];
    });
  }

  /**
   * Record (or clear, passing `null`) this tick's PR-probe failure category, ONLY if the card
   * still names `session` as its tmux session — the `setPrsIfSession` precedent. The session guard
   * runs INSIDE the mutation queue for the same reason: a Done-drag teardown enqueued during the
   * detection window must win over a probe result that started before the drop. No-op if the id is
   * unknown.
   */
  setPrsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card?.tmuxSession === session) card.prsUnknown = unknown ?? undefined;
      return [];
    });
  }

  /**
   * Record (or clear, passing `null`) this tick's preview-probe failure category, ONLY if the card
   * still names `session` as its tmux session — byte-for-byte the `setPrsUnknownIfSession` shape.
   * No-op if the id is unknown.
   */
  setPreviewsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card?.tmuxSession === session)
        card.previewsUnknown = unknown ?? undefined;
      return [];
    });
  }

  /**
   * Latch the session as hook-routed for channel selection: the ISO timestamp of its first
   * authenticated hook event. Write-once per session by service-side guard — the store stays
   * policy-free (no throttling, no read-before-write here). Mirrors setOutputChanged: a
   * single-field enqueue. Cleared only via the clearHookToken chokepoint. Refuses to stamp a
   * card that holds no hookToken, so the latch always implies a live token even when the
   * service's read-outside-queue guard raced a queued session-clearing mutation — a latch
   * without a token would demote pane scanning for a session with no hook traffic. No-op if
   * the id is unknown.
   * @remarks (`WR-05`) This is the ONLY site allowed to stamp the latch, and it runs only once a
   * hook POST has authenticated — so the latch means "this session's hook transport demonstrably
   * works", never "the installed CLI's version is high enough". A hooks-capable session whose
   * events never arrive therefore keeps full pane routing instead of going dark, which is the
   * ordering the `auto` channel must always preserve: a brief overlap where both channels are live
   * is cosmetic (both converge on `applyMarker`/`flipBack` behind `lastMarker` dedup and the
   * single-writer queue), whereas zero live channels is a card frozen forever.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  markHookRouted(id: string, iso: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card?.hookToken) card.hookRoutedAt = iso;
      return [];
    });
  }

  /**
   * Reset a card's hook-channel state (token + hookRoutedAt latch) through the clearHookToken
   * chokepoint, as one queued mutation. Called by the hook-silent launch branches of
   * startClaude/resumeSession BEFORE spawning, so a relaunch that skips injection (CLI
   * downgraded below the hooks floor, hooks disabled) can never inherit a stale persisted
   * latch — without this, `auto` would demote pane scanning for a session that produces no
   * hook traffic, and the next boot reconcile would re-register a token no live process
   * carries. No-op if the id is unknown.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  clearHookChannel(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.clearHookToken(card);
      return [];
    });
  }

  /**
   * Record a non-fatal start warning (e.g. the fetch-fallback notice). Does not touch the
   * column or the provisioning step — provisioning continues. No-op if the id is unknown.
   */
  setStartWarning(id: string, warning: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.startWarning = warning;
      return [];
    });
  }

  /**
   * Record a structured start failure. The card MUST remain in "To Do" (column untouched)
   * per ORCH-04 / UI-SPEC so the user can retry; the in-flight provisioning step is cleared.
   * No-op if the id is unknown. SECURITY: never logs card/stderr contents.
   */
  setStartError(id: string, e: StartError): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      card.startError = e;
      card.provisioningStep = null;
      return [this.event("session_failed", { cardId: id, reason: e.step })];
    });
  }

  /**
   * Idempotent reattach to a live `dsp-<id>` session ("already running"): copy the session
   * fields, promote the card to In Progress, surface a transient reattach status, and clear any
   * provisioning step / start error. No-op if the id is unknown.
   */
  attachExistingSession(id: string, s: SessionFields): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const prev = card.column;
      this.setActiveSession(card, {
        workspacePath: s.workspacePath,
        tmuxSession: s.tmuxSession,
        ttydPort: s.ttydPort,
      });
      card.branch = s.branch;
      card.column = "in_progress";
      this.mirrorMemberColumn(card, "in_progress");
      card.statusReason = "Already running — reattached";
      card.provisioningStep = null;
      card.startError = null;
      card.sessionLost = false;
      card.resumeError = null;
      return [
        this.event("session_start", {
          cardId: id,
          fromCol: prev,
          toCol: "in_progress",
          reason: "reattached",
        }),
      ];
    });
  }

  /**
   * Record the ttyd port ONLY if the card still names `session` as its tmux session, and report
   * whether it recorded. The condition runs INSIDE the mutation queue (applyMarker/flipBack
   * precedent) so a markSessionLost that is enqueued ahead of this call is applied first and
   * reliably suppresses the write — a synchronous pre-check on the live Map cannot guarantee
   * that (WR-04). SECURITY: never logs card contents.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  setTtydPortIfSession(
    id: string,
    session: string,
    port: number,
  ): Promise<boolean> {
    let recorded = false;
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card && card.tmuxSession === session) {
        this.setActiveSession(card, { ttydPort: port });
        card.terminalError = null;
        recorded = true;
      }
      return [];
    }).then(() => recorded);
  }

  /**
   * Reconcile a tracked ttyd exit: clear the port AND set the terminal error in ONE mutation.
   * Must stay atomic — two sequential mutations would broadcast an intermediate frame with
   * port-null/error-null, which the DetailPanel's ensure-on-open effect reads as "needs a
   * terminal" and silently auto-respawns a deliberately killed ttyd. No-op if the id is unknown.
   */
  recordTtydExit(id: string, e: TerminalError): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        this.setActiveSession(card, { ttydPort: undefined });
        card.terminalError = e;
      }
      return [];
    });
  }

  /**
   * Clear a card's persisted `ttydPort` after a boot-time adoption attempt declined to adopt it
   * (ROBU-01) — the port answered no probe, or its owning PID could not be confirmed via `lsof`,
   * so it degrades to today's pre-fix state. No event: the panel for this card may not even be
   * open, so nothing needs to observe this cleanup; the next panel open transparently fresh-spawns
   * a ttyd via the existing `ensureTerminal` flow. No-op if the id is unknown.
   */
  clearStaleTtydPort(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.setActiveSession(card, { ttydPort: undefined });
      return [];
    });
  }

  /**
   * Mark ONE session lost (Phase 91) in ONE atomic mutation: clear only the TARGET session's
   * `tmuxSession`/`ttydPort`/hook token, promote a live sibling into the active pointer in the
   * SAME mutation if the target was active, then DERIVE the card-level `sessionLost` from every
   * session the card owns rather than asserting it — true only when the card has zero session
   * records or every one of them is dead. A card with a live sibling therefore survives one
   * session dying: it never shows Lost, its live sibling's fields are untouched, and the active
   * pointer never names a dead record.
   * @remarks `sessionId` is a REQUIRED parameter that accepts `undefined` — every call site must
   * say which session it means, while `undefined` still resolves to `card.activeSessionId`
   * (today's exact single-session meaning). If the resolved id does not name a record in
   * `card.sessions` (a pre-entity or otherwise corrupt card), this degrades to the pre-Phase-91
   * shape exactly: the session-field clear and the hook-token clear both fall through to
   * `setActiveSession`'s/`clearHookToken`'s own undefined-target default rather than refusing on
   * an unresolvable EXPLICIT target, so a corrupt card is not made worse by this widening.
   * @remarks Artifact fields (`terminalError`, `prs`, `prsUnknown`, `previews`, `previewsUnknown`)
   * clear ONLY on the derived full-card loss, never on a partial one — per-session artifact
   * attribution is a later phase's concern (ARTIFACT-01), not this one's; on a partial loss they
   * are left exactly as they were.
   * @remarks `wasTransition` is recomputed against the DERIVED state, not the raw call: a partial
   * loss on a card that still has a live sibling never emits `session_lost` (the card is not
   * actually lost), and a full loss emits it exactly once, on the transition into it.
   * Called at BOTH boot (reconcileSessions) and RUNTIME (the watcher's per-session dead-session
   * detector). No-op if the id is unknown. SECURITY: never logs card contents.
   */
  markSessionLost(id: string, sessionId: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const wasAlreadyLost = card.sessionLost === true;
      const targetId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === targetId);
      const resolvedTargetId = target ? targetId : undefined;
      this.setActiveSession(
        card,
        { tmuxSession: undefined, ttydPort: undefined },
        resolvedTargetId,
      );
      this.clearHookToken(card, resolvedTargetId);
      if (target && targetId === card.activeSessionId) {
        const promoted = (card.sessions ?? [])
          .filter((s) => s.id !== target.id && s.tmuxSession != null)
          .sort((a, b) =>
            a.updatedAt === b.updatedAt
              ? a.id.localeCompare(b.id)
              : b.updatedAt.localeCompare(a.updatedAt),
          )[0];
        if (promoted) this.setActiveSession(card, {}, promoted.id, true);
      }
      const sessions = card.sessions ?? [];
      const derivedLost =
        sessions.length === 0 || sessions.every((s) => s.tmuxSession == null);
      card.sessionLost = derivedLost;
      if (derivedLost) {
        card.terminalError = null;
        card.prs = undefined;
        card.prsUnknown = undefined;
        card.previews = undefined;
        card.previewsUnknown = undefined;
      }
      const wasTransition = derivedLost && !wasAlreadyLost;
      return wasTransition
        ? [
            this.event("session_lost", {
              cardId: id,
              fromCol: card.column,
              toCol: card.column,
              source: "watcher",
            }),
          ]
        : [];
    });
  }

  /**
   * Record a structured terminal (ttyd) failure surfaced in the detail panel. No-op if the id
   * is unknown. SECURITY: never logs card or stderr contents (matches setStartError).
   */
  setTerminalError(id: string, e: TerminalError): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.terminalError = e;
      return [];
    });
  }

  /**
   * Apply a parsed DISPATCH_STATUS marker (Phase 4, MARK-01/02) in ONE atomic mutation: set the target
   * column, the status reason/summary, AND the dedup key `lastMarker` together. Modeled on
   * recordTtydExit — a single enqueue so the SSE broadcast never carries a torn frame with the
   * column moved but the reason/marker not yet applied (WR-01). Callers pass column="needs_input"
   * for a NEEDS_INPUT marker, "agent_done" for DONE, and the NORMALIZED marker key
   * (`kind + " " + reason`, see parse.ts markerKey) — never the raw pane line, so a rewrap of the
   * same marker never re-fires. `statusReason` undefined clears it (an empty reason still fires
   * the move but shows no placeholder copy, per UI-SPEC). No-op if the id is unknown.
   *
   * A marker NEVER moves a card out of `APPLY_MARKER_EXCLUDED_SOURCES` (To Do, Done, or Inbox) —
   * checked INSIDE the mutator (live Map, so a queued drag to Done wins over a concurrently-scanned
   * marker): a To Do card with a surviving session (e.g. interrupted-saga + Retry showing) must not
   * bypass the start flow, a card the user parked in Done stays parked, and (BOARD-06) an Inbox
   * card — structurally never carrying a `tmuxSession`, so no live caller reaches this path today —
   * is now excluded by an explicit allowlist rather than that accident. Cards in in_progress /
   * needs_input / agent_done / in_review remain eligible (an Agent Done card CAN move to Needs
   * Input on a new distinct marker — intended). SECURITY: never logs card, reason, or pane contents.
   *
   * `WR-05`: `eventType` is supplied by the CALLER, not derived from `column` in here — a target
   * column and its activity-event type happen to correspond 1:1 today only because there are
   * exactly two attention targets; deriving it here would silently mislabel a future third target.
   * @see docs/ARCHITECTURE.md#single-writer-store
   * @see docs/ARCHITECTURE.md#column-transition-specification
   */
  applyMarker(
    id: string,
    column: Column,
    statusReason: string | undefined,
    markerKey: string,
    eventType: Extract<EventType, "status_needs_input" | "status_agent_done">,
  ): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || APPLY_MARKER_EXCLUDED_SOURCES.includes(c.column)) return [];
      if (c.lastMarker === markerKey) return [];
      const from = c.column;
      c.column = column;
      this.mirrorMemberColumn(c, column);
      c.statusReason = statusReason;
      c.lastMarker = markerKey;
      return [
        this.event(eventType, {
          cardId: id,
          fromCol: from,
          toCol: column,
          reason: statusReason ?? null,
        }),
      ];
    });
  }

  /**
   * Clear the consumed-marker dedup key (Phase 4, MARK-04 liveness). INVARIANT: `lastMarker`
   * lives exactly as long as the consumed marker's text is still physically on the pane or the
   * card still sits in an attention column. The watcher calls this once BOTH stop holding —
   * card back out of needs_input/agent_done AND the marker text gone from the capture (scrolled
   * off / new conversation turn) — so a genuinely RE-PRINTED identical marker re-fires (the
   * re-blocked agent surfaces again), while the still-on-screen consumed one stays deduped.
   * No-op if the id is unknown.
   */
  clearLastMarker(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (c) c.lastMarker = undefined;
      return [];
    });
  }

  /**
   * Flip a parked card (Needs Input, Agent Done, or In Review) back to In Progress once the agent
   * responds (Phase 4, MARK-03; widened BOARD-06/FLOW-02 to all of `FLIP_BACK_SOURCES`): clear
   * statusReason in ONE atomic mutation. The target is always `in_progress` — no
   * return-to-previous-column history state. No-op if the id is unknown.
   *
   * The column check lives INSIDE the mutator (the applyIssues precedent): a caller's read of the
   * card's column happens outside the queue, so a manual drag can already be queued ahead of this
   * flip. Re-checking against the live Map here makes the flip a no-op unless the card is STILL in
   * one of `FLIP_BACK_SOURCES` — a queued drag (e.g. to Done) can never be silently reverted.
   *
   * @remarks FLOW-05: flipping out of `needs_input` MUST stay byte-identical to before this
   * plan, including leaving `lastMarker` UNTOUCHED — the still-visible NEEDS_INPUT marker line
   * must not re-fire on the next tick (the watcher dedups on `lastMarker`). FLOW-02: flipping out
   * of `agent_done`/`in_review` (`FLIP_BACK_CLEARS_LAST_MARKER`) CLEARS `lastMarker` instead —
   * without this, an agent that re-emits the identical `DISPATCH_STATUS: DONE` text would dedup
   * against the still-standing key at `applyMarker`'s guard and the card could never repeat the
   * flip. The clearing is keyed on the PRE-mutation source column, never the target, so the two
   * edges' behavior can never accidentally swap.
   * @remarks Clearing the key has a CROSS-MODULE consequence the store cannot see: `lastMarker` is
   * also the level-triggered pane watcher's only defence against re-applying a marker whose text
   * is still on screen, which is precisely why the `needs_input` edge keeps it. A pane tick already
   * past its channel gate, holding a decision computed before this mutation, would otherwise
   * re-apply the consumed DONE and drag the card back to Agent Done. `scanSession` therefore
   * re-checks the card's `column` and `lastMarker` against the values it decided on immediately
   * before dispatching; do not remove that check on the belief that the channel gate makes it
   * unnecessary.
   * @see docs/ARCHITECTURE.md#column-transition-specification
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  flipBack(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || !FLIP_BACK_SOURCES.includes(c.column)) return [];
      const from = c.column;
      const target = "in_progress";
      c.column = target;
      this.mirrorMemberColumn(c, target);
      c.statusReason = undefined;
      if (FLIP_BACK_CLEARS_LAST_MARKER.includes(from)) {
        c.lastMarker = undefined;
      }
      return [
        this.event("move_auto", {
          cardId: id,
          fromCol: from,
          toCol: target,
          reason: "agent responded",
        }),
      ];
    });
  }

  /**
   * Synchronous read of all cards that currently have a live tmux session (Phase 4 watcher loop).
   * Mirrors getCard: returns live Map entries — callers must NOT mutate them; all mutations flow
   * through the enqueue-wrapped methods.
   */
  cardsWithSession(): Card[] {
    return [...this.cards.values()].filter((c) => c.tmuxSession != null);
  }

  /**
   * Synchronous read of every (card, session) pair with a live tmux session — every SESSION a
   * card owns, not just the one `cardsWithSession()` reports via the ACTIVE projection. Deliberately
   * a SEPARATE method rather than a change to `cardsWithSession()`: that method stays card-scoped
   * because `artifact-detect.ts` depends on its exact card-level filter and per-session artifact
   * attribution is a later phase's concern (ARTIFACT-01), not this one's. The shared iteration
   * primitive for the watcher tick loop and boot reconcile's sweep (Phase 91, WATCH-01/RECON-01) to
   * scan and adopt every live sibling a card owns, not only its active one. Mirrors
   * `cardsWithSession()`'s own contract: returns live Map entries — callers must NOT mutate them;
   * all mutations flow through the enqueue-wrapped methods.
   */
  sessionsWithTmux(): { card: Card; session: Session }[] {
    const out: { card: Card; session: Session }[] = [];
    for (const card of this.cards.values()) {
      for (const session of card.sessions ?? []) {
        if (session.tmuxSession != null) out.push({ card, session });
      }
    }
    return out;
  }

  /**
   * Synchronous read of every card whose automatic-cleanup schedule has elapsed (`LIFE-03`): still
   * in Done, `cleanupDueAt` set and at or before `now`, and no start saga in flight. The column and
   * `isStarting` checks reproduce, in the scheduler's path, the two defense-in-depth guards
   * `routes/cards.route.ts` already applies to the manual `/cleanup` route — a stray schedule must
   * never tear down a card that left Done, and cleanup must never race a start saga building the
   * same worktrees.
   */
  cardsDueForCleanup(now: number): Card[] {
    return [...this.cards.values()].filter(
      (card) =>
        card.column === "done" &&
        card.cleanupDueAt != null &&
        card.cleanupDueAt <= now &&
        !this.isStarting(card.id),
    );
  }

  /**
   * Manual drag move (Phase 4, MARK-04): set the column and, when the new column is neither
   * attention column (needs_input / agent_done), clear statusReason — as ONE atomic mutation.
   * `lastMarker` is left UNTOUCHED so a drag CONSUMES the current marker: the watcher still sees
   * "already seen" (markerKey === lastMarker) and never re-applies the marker the user just
   * overrode. Replaces the plain moveCard on the drag route. Also the sole promote/demote mutator
   * (Inbox and To Do share this same move rather than a new endpoint): an Inbox-to-To-Do
   * transition stamps `promotedAt`, the single-writer store being the ONLY place that field is
   * ever assigned. `BOARD-07`: no-ops (returns `[]` with no mutation) when
   * `isManualMoveAllowed(from, column)` is false — this is the TRUE authority for the allowlist,
   * consulted against the live Map inside the enqueue callback (WR-04 precedent), so it holds even
   * if a route-level check were ever removed. No-op if the id is unknown.
   *
   * Also the sole writer of a FRESH deferred-cleanup schedule (`LIFE-02`): a genuine Done arrival
   * (`from !== "done"`) of a card still holding a session or workspace stamps `cleanupDueAt` with a
   * full `cleanupDelayMs`-length delay; leaving Done clears it. The `from !== "done"` guard is
   * load-bearing — `isManualMoveAllowed` permits a done→done no-op move, and without the guard a
   * redundant/retried move-to-done would silently push the schedule out by a full delay.
   * `restoreCleanupDue` (`LIFE-03`) is the one other writer of the field, but it never mints a fresh
   * delay — it only re-instates a schedule the scheduler's own abandon path cleared moments earlier.
   */
  moveCardManual(id: string, column: Column): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      const from = c.column;
      if (!isManualMoveAllowed(from, column)) return [];
      c.column = column;
      this.mirrorMemberColumn(c, column);
      if (
        from !== "done" &&
        column === "done" &&
        (c.tmuxSession != null || c.workspacePath != null)
      ) {
        c.cleanupDueAt = Date.now() + this.cleanupDelayMs;
      }
      if (from === "done" && column !== "done") {
        c.cleanupDueAt = undefined;
      }
      if (from === "inbox" && column === "todo") {
        c.promotedAt = new Date().toISOString();
      }
      if (column !== "needs_input" && column !== "agent_done") {
        c.statusReason = undefined;
      }
      if (from === column) return [];
      return [
        this.event(column === "done" ? "status_done" : "move_manual", {
          cardId: id,
          fromCol: from,
          toCol: column,
          source: "user",
        }),
      ];
    });
  }

  /**
   * Successful start: copy the session fields, promote the card to In Progress, and clear the
   * provisioning step, start error, start warning, and the session-lost flag (so a restart returns
   * the card to its normal running appearance). No-op if the id is unknown.
   */
  completeStart(id: string, s: SessionFields): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const prev = card.column;
      this.setActiveSession(card, {
        workspacePath: s.workspacePath,
        tmuxSession: s.tmuxSession,
        ttydPort: s.ttydPort,
      });
      card.branch = s.branch;
      card.column = "in_progress";
      this.mirrorMemberColumn(card, "in_progress");
      card.provisioningStep = null;
      card.startError = null;
      card.startWarning = null;
      card.sessionLost = false;
      card.resumeError = null;
      return [
        this.event("session_start", {
          cardId: id,
          fromCol: prev,
          toCol: "in_progress",
        }),
      ];
    });
  }

  /**
   * Column-preserving Resume of a dead In Review session (REV-04) in ONE atomic mutation: set
   * `tmuxSession` and clear `sessionLost` (plus the stale ttyd port and terminal error) so the
   * SessionLostSection hides and the terminal region returns. DELIBERATELY never writes the
   * card's column — that omission is the entire reason this method exists, unlike the other two
   * session-setters which force `in_progress` and would yank an In Review card out of its column.
   * A column-preserving mutation performs no non-drag promotion, so it coexists safely with the
   * reconcile/watcher IN-03 hazard. No-op if the id is unknown. SECURITY: never logs card contents.
   * @see docs/ARCHITECTURE.md#in-review-lifecycle
   */
  resumeSession(id: string, { session }: { session: string }): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      this.setActiveSession(card, {
        tmuxSession: session,
        ttydPort: undefined,
      });
      card.sessionLost = false;
      card.terminalError = null;
      card.resumeError = null;
      card.statusReason = "Resumed — reattached";
      return [
        this.event("session_resume", {
          cardId: id,
          fromCol: card.column,
          toCol: card.column,
          reason: "resumed",
        }),
      ];
    });
  }

  /**
   * Clear a prior resume-failure notice at the start of a new resume attempt, so a repeat
   * failure produces a fresh null→set transition the SessionLostSection's effect can observe
   * (an unchanged `resumeError` value would never re-fire it). No-op if the id is unknown.
   */
  clearResumeError(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.resumeError = null;
      return [];
    });
  }

  /**
   * Record a resume-saga failure (REV-04) in ONE atomic mutation (markSessionLost precedent):
   * restore `sessionLost`, clear any partial session fields, and set the fixed failure copy the
   * SessionLostSection renders. The SSE frame this broadcasts is the ONLY failure signal the
   * client ever gets — the route's 202 resolved before the saga ran — so without this write the
   * panel's "Resuming…" state would be permanent. The copy is a constant, so no tmux/claude
   * stderr or pane text can leak (SECURITY, matches setStartError). `hookToken` is cleared AND
   * unregistered with the session fields (clearHookToken). No-op if the id is unknown.
   * @see docs/ARCHITECTURE.md#in-review-lifecycle
   */
  recordResumeFailure(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      card.sessionLost = true;
      this.setActiveSession(card, {
        tmuxSession: undefined,
        ttydPort: undefined,
      });
      card.terminalError = null;
      card.prs = undefined;
      card.prsUnknown = undefined;
      card.previews = undefined;
      card.previewsUnknown = undefined;
      this.clearHookToken(card);
      card.resumeError =
        "Resume failed — the worktree may be gone. Use Restart to begin a fresh session in the same branch.";
      return [this.event("resume_failed", { cardId: id })];
    });
  }

  /**
   * Record a non-fatal Done-cleanup failure (LIFE-01) in ONE atomic mutation (markSessionLost /
   * finishCleanup precedent): set the muted card-level warning AND clear the session fields the
   * saga tore down unconditionally BEFORE any failure could be recorded — killTtyd/killSession
   * always ran, so `tmuxSession`/`ttydPort` must never survive here. Leaving them set would keep
   * the card in cardsWithSession() forever (Done cards skip the watcher's dead-session detector)
   * and make the DetailPanel render the destructive "Terminal disconnected" block on a card whose
   * cleanup should surface only this muted warning. `terminalError` is nulled for the same reason;
   * only the worktree/folder outcome is uncertain on this path, so `workspacePath` is left as-is.
   * `hookToken` is cleared AND unregistered with the session fields (clearHookToken). `prs` and
   * `previews`, plus their `prsUnknown`/`previewsUnknown` companions, are cleared alongside the
   * other session fields. Column untouched. No-op if the id is
   * unknown. Bumps `cleanupAttempt` — this is one of the four terminal cleanup branches. Clears
   * `cleanupDueAt` (`LIFE-02`): the teardown already ran on this branch, so the schedule is spent.
   */
  recordCleanupWarning(id: string, warning: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      card.cleanupWarning = warning;
      this.setActiveSession(card, {
        tmuxSession: undefined,
        ttydPort: undefined,
        claudeSessionId: undefined,
      });
      card.terminalError = null;
      this.clearHookToken(card);
      card.prs = undefined;
      card.prsUnknown = undefined;
      card.previews = undefined;
      card.previewsUnknown = undefined;
      card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
      card.cleanupDueAt = undefined;
      return [
        this.event("cleanup", {
          cardId: id,
          fromCol: "done",
          toCol: "done",
          reason: warning,
        }),
      ];
    });
  }

  /**
   * Successful Done-cleanup quiet-state clear (LIFE-01) in ONE atomic mutation (markSessionLost /
   * completeStart precedent — a split write would broadcast a torn frame). Clears the session
   * fields the teardown removed AND neutralizes any lingering/racing error chrome so the cleaned
   * Done card reads quietly: `tmuxSession`/`ttydPort`/`workspacePath`/`cleanupWarning`/`hookToken`/
   * `prs`/`prsUnknown`/`previews`/`previewsUnknown` undefined (the token also unregistered via
   * clearHookToken),
   * `sessionLost` false, `terminalError` null. KEEPS `branch` (branches always survive per lock),
   * `outputChangedAt`, and `lastMarker`. Bumps `cleanupAttempt` (deliberately NOT one of the fields
   * cleared here — it must survive as the counter's whole point) — this is one of the four terminal
   * cleanup branches. Also clears `cleanupDueAt` (`LIFE-02`) — without this a cleaned card would
   * keep rendering a countdown, breaking the "absence of the countdown IS the cleaned state"
   * contract. No-op if the id is unknown.
   */
  finishCleanup(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      this.setActiveSession(c, {
        tmuxSession: undefined,
        ttydPort: undefined,
        workspacePath: undefined,
        claudeSessionId: undefined,
      });
      c.sessionLost = false;
      c.terminalError = null;
      c.cleanupWarning = undefined;
      c.cleanupBlocked = undefined;
      this.clearHookToken(c);
      c.prs = undefined;
      c.prsUnknown = undefined;
      c.previews = undefined;
      c.previewsUnknown = undefined;
      c.cleanupAttempt = (c.cleanupAttempt ?? 0) + 1;
      c.cleanupDueAt = undefined;
      return [
        this.event("cleanup", { cardId: id, fromCol: "done", toCol: "done" }),
      ];
    });
  }

  /**
   * Record a non-forced Done-cleanup refusal (PRE-01): a dirty-worktree preflight blocked teardown,
   * so set the per-repo `cleanupBlocked` list and touch NOTHING else. Unlike recordCleanupWarning
   * (which runs only AFTER teardown and clears the session fields), this fires BEFORE any
   * destructive step — the tmux session, ttyd, hookToken, and worktrees all stay alive so the card
   * remains fully usable while the block is surfaced. Bumps `cleanupAttempt` — this is one of the
   * four terminal cleanup branches. No-op if the id is unknown.
   */
  recordCleanupBlocked(
    id: string,
    blocked: { repo: string; count: number }[],
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupBlocked = blocked;
        card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
      }
      return [];
    });
  }

  /** Clear a prior cleanup refusal (PRE-01) at the start of a fresh attempt. No-op if id unknown. */
  clearCleanupBlocked(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupBlocked = undefined;
      }
      return [];
    });
  }

  /**
   * Clear a card's pending automatic-cleanup schedule. Called BEFORE `cleanupWorkspace` dispatches
   * — `LIFE-03`'s first double-run guard, so a second tick can no longer see the card as due. No-op
   * if the id is unknown or the schedule is already cleared.
   */
  clearCleanupDue(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupDueAt = undefined;
      }
      return [];
    });
  }

  /**
   * Restore a due-cleanup schedule that `runDueCleanups` (`LIFE-03`) just cleared but then chose
   * NOT to act on, because a start/resume saga began between the snapshot and the fresh recheck and
   * the card never actually left Done. Sets `cleanupDueAt` to `dueAt` (the scheduler passes
   * `Date.now()`, so the card is due again on the very next tick, once the saga has had a chance to
   * settle). `moveCardManual` remains the ONLY writer that mints a fresh `cleanupDelayMs`-length
   * schedule on genuine Done arrival — this method never mints one, it only re-instates the exact
   * schedule this same abandon path cleared moments earlier, so a card that is still Done never ends
   * up with no schedule and no automatic way back to one. No-op if the id is unknown or the card has
   * left Done in the meantime (a card outside Done carries no schedule by design, `LIFE-02`).
   */
  restoreCleanupDue(id: string, dueAt: number): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card && card.column === "done") {
        card.cleanupDueAt = dueAt;
      }
      return [];
    });
  }

  /**
   * Zero-teardown cleanup warning (PRE-04): the preflight-refusal-safe sibling of
   * recordCleanupWarning. Sets ONLY the muted `cleanupWarning` and clears no session fields, because
   * the non-orphan preflight-error path tore nothing down — the live tmux session, ttyd, and
   * hookToken MUST survive so the terminal stays usable. Bumps `cleanupAttempt` — this is one of the
   * four terminal cleanup branches. No-op if the id is unknown.
   */
  noteCleanupWarning(id: string, message: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupWarning = message;
        card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
      }
      return [];
    });
  }

  /**
   * Mint a new `source: "local"` card (Phase 61, TICKET-02/04): a first-class ordinary `Card` with
   * no upstream issue, landing straight in To Do. The identifier is minted AT ACCEPT TIME —
   * `"LOCAL-" + counter` — INSIDE this enqueue mutator, so the store's single-writer queue is the
   * only concurrency guard sequential creates need (no separate mutex, mirroring every other
   * id-minting decision in this codebase); `localTicketCounter` persists in the same meta-row
   * transaction as the card write, so the counter survives a restart. `id`/`issueId`/`identifier`
   * are ALL set to the minted string — there is no second, different upstream id to track for a
   * locally-authored ticket, extending the codebase's own documented Phase-1 precedent that `id`
   * can equal `issueId`. `priority: 0` ("none" — no Linear priority concept applies) and
   * `promotedAt: now` are both stamped so the new ticket sorts to the TOP of To Do via
   * compareTodoOrder's promoted tier, exactly like a freshly-promoted Inbox card (the user just
   * made this and expects to see it immediately). Deliberately does NOT set `url`/`project`/any
   * session field — those stay genuinely absent for a card with no Linear origin.
   * @remarks Uses the {@link setTtydPortIfSession} closure-capture technique to return a value out
   * of the enqueue-wrapped mutation (every other mutator here returns `Promise<void>`), since the
   * route layer needs the minted `Card` — including its real identifier — to respond to the client.
   */
  createLocalCard(title: string, description: string): Promise<Card> {
    let created!: Card;
    return this.enqueue(() => {
      this.localTicketCounter += 1;
      const identifier = `LOCAL-${this.localTicketCounter}`;
      const now = new Date().toISOString();
      created = {
        id: identifier,
        issueId: identifier,
        identifier,
        title,
        description,
        priority: 0,
        column: "todo",
        updatedAt: now,
        promotedAt: now,
        source: "local",
      };
      this.cards.set(created.id, created);
      return [
        this.event("local_created", {
          cardId: created.id,
          toCol: "todo",
          source: "local",
        }),
      ];
    }).then(() => created);
  }

  /**
   * Mint a new `source: "group"` card (Phase 63, GROUP-01/04): mirrors {@link createLocalCard}'s
   * mint pattern exactly (own `groupTicketCounter`, `id === issueId === identifier`) but ALSO
   * links membership two-sided in the SAME enqueue closure — every member gets
   * `groupId = created.id`. Members' `column` is left untouched at creation, so no
   * `mirrorMemberColumn` fan-out runs here; the group card itself lands in To Do and the
   * subsequent start saga's `completeStart` performs the first real fan-out. Emits exactly ONE
   * `group_created` event (Pitfall 4 — no per-member event).
   * @remarks In-queue re-check (the `adoptLinearIdentity` precedent): the route's eligibility
   * validation runs OUTSIDE the single-writer queue, so already-queued mutations (a poll's
   * `applyIssues` removing a member, a competing group mint claiming one) can invalidate a member
   * between validation and this closure executing. Every member is therefore re-checked here at
   * mutation time — must exist, sit in To Do, be ungrouped, and not itself be a group — and ANY
   * failure refuses the whole mint (no card created, no partial links, no counter burn) via the
   * `ok: false` result the route maps to its 409 `ineligibleIds` response, preserving the
   * ratified ALL-OR-NOTHING posture and the two-sided `memberIds`/`groupId` invariant.
   */
  createGroupCard(
    title: string,
    memberIds: string[],
  ): Promise<
    { ok: true; card: Card } | { ok: false; ineligibleIds: string[] }
  > {
    let result!:
      { ok: true; card: Card } | { ok: false; ineligibleIds: string[] };
    return this.enqueue(() => {
      const ineligibleIds = memberIds.filter((id) => {
        const member = this.cards.get(id);
        return (
          member == null ||
          member.column !== "todo" ||
          member.groupId != null ||
          member.source === "group"
        );
      });
      if (ineligibleIds.length > 0) {
        result = { ok: false, ineligibleIds };
        return [];
      }
      this.groupTicketCounter += 1;
      const identifier = `GROUP-${this.groupTicketCounter}`;
      const now = new Date().toISOString();
      const created: Card = {
        id: identifier,
        issueId: identifier,
        identifier,
        title,
        description: null,
        priority: 0,
        column: "todo",
        updatedAt: now,
        promotedAt: now,
        source: "group",
        memberIds: [...memberIds],
      };
      this.cards.set(created.id, created);
      for (const id of memberIds) {
        const member = this.cards.get(id);
        if (member) member.groupId = created.id;
      }
      result = { ok: true, card: created };
      return [
        this.event("group_created", {
          cardId: created.id,
          toCol: "todo",
          source: "group",
        }),
      ];
    }).then(() => result);
  }

  /**
   * Atomically adopt a real Linear identity onto a `source:"local"` card (PUSH-01/02): ONE enqueue
   * that flips `source: "linear"`, swaps identifier/url/issueId/title/description to the created
   * (or found) issue's canonical values, clears `syncError`/`syncing`, and emits `sync_out` in the
   * SAME transaction. `Card.id` NEVER changes here — only the poller-relevant identity fields move —
   * which is exactly what lets the next Linear poll refresh the card in place via the issueId-keyed
   * reconcile map instead of creating a duplicate. Marker screening of the adopted title/description
   * happens at the ROUTE layer, not here — the boundaries DAG forbids store -> services, so the
   * store cannot import `hasDispatchMarker`.
   * @remarks In-queue re-check (the `applyMarker` precedent): re-reads the live Map and no-ops
   * (returns `[]`, no event) unless the card exists AND is still `source: "local"` — a raced/repeated
   * call after adoption already landed is therefore idempotent, the retry-safety belt for PUSH-03.
   * @remarks Poller-race dedup (62-03 live-smoke finding): a poll cycle can complete WHILE this
   * card's sync is still in flight — the issue already exists on Linear (assigned, unstarted) but
   * this card hasn't adopted yet, so `applyIssues`'s linear-scoped `current` map (keyed by issueId)
   * doesn't know about it and upserts a brand-new card keyed by the raw issueId. Any OTHER card
   * already holding `adopted.issueId` at adoption time is exactly that race's leftover — removed
   * here (its hook token released through the clearHookToken chokepoint) so the sync-triggered card
   * (stable `Card.id`) stays the sole owner of the issueId, meeting PUSH-02's zero-duplicate
   * guarantee even when this race window is hit. The delete carries `reconcile()`'s removal guards:
   * a duplicate that is past To Do/Inbox, is linked into a group (`groupId != null` — deleting it
   * would leave the group's `memberIds` referencing a nonexistent card, the two-sided-invariant
   * hazard), or is starting/carries session state (isStartingCard) is NEVER deleted — deleting an
   * active one would orphan a live tmux/ttyd session (the `inFlightStarts` hazard). In that case
   * adoption itself is REFUSED — the card stays local with a manual-resolution `syncError` —
   * rather than leaving two cards contending over one issueId.
   */
  adoptLinearIdentity(
    id: string,
    adopted: {
      identifier: string;
      url: string;
      issueId: string;
      title: string;
      description: string;
    },
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card || (card.source ?? "linear") !== "local") return [];
      const duplicates = [...this.cards.values()].filter(
        (other) => other.id !== id && other.issueId === adopted.issueId,
      );
      const unsafe = duplicates.find(
        (dup) =>
          (dup.column !== "todo" && dup.column !== "inbox") ||
          dup.groupId != null ||
          isStartingCard(dup, this.inFlightStarts),
      );
      if (unsafe) {
        console.warn(
          `[store] sync dedup refused adoption for ${id} — duplicate ${unsafe.id} is active or has a session`,
        );
        card.syncError = `Synced to Linear as ${adopted.identifier}, but another card for that issue is already active on the board — resolve the duplicate manually, then retry.`;
        card.syncing = undefined;
        return [];
      }
      for (const dup of duplicates) {
        this.clearHookToken(dup);
        this.cards.delete(dup.id);
      }
      card.source = "linear";
      card.identifier = adopted.identifier;
      card.url = adopted.url;
      card.issueId = adopted.issueId;
      card.title = adopted.title;
      card.description = adopted.description;
      card.syncError = null;
      card.syncing = undefined;
      return [
        this.event("sync_out", {
          cardId: id,
          source: "linear",
          reason: `synced to Linear as ${adopted.identifier}`,
        }),
      ];
    });
  }

  /**
   * Record a retry-safe Sync-to-Linear failure (PUSH-03) in ONE atomic mutation (`setStartError`
   * precedent): set the fixed/service-derived `syncError` copy AND clear the in-flight `syncing`
   * flag together, so the SSE broadcast never carries a torn frame with the error set but the button
   * still showing "syncing…". `message` must never be raw stdout (SECURITY, mirrors `startError`).
   * No-op if the id is unknown.
   */
  recordSyncError(id: string, message: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.syncError = message;
        card.syncing = undefined;
      }
      return [];
    });
  }

  /**
   * Apply a Linear poll result (the poller calls this). The column-sensitive reconcile
   * decisions are computed INSIDE the mutator, against the live Map, so they can never
   * be based on a stale snapshot taken while another mutation (e.g. a user moveCard)
   * was still queued — that read-modify-write race could revert a user move or delete
   * a card that had already left To Do. reconcile() itself stays pure (mapping.ts);
   * only its invocation moves behind the queue. Upserts arrive in Linear-return order
   * and are NOT sorted here — ordering is this store's read-path job (snapshot()).
   *
   * `partial` marks a truncated pull (pagination cap hit): the issue list is incomplete,
   * so absence proves nothing — upserts still apply, but removals and gone-flags are
   * SKIPPED for the cycle and a warning is recorded on the sync status instead.
   *
   * The cards Map stays keyed by raw upstream id, so the per-source reconcile filter
   * alone cannot stop a cross-source id collision: an upsert whose id already belongs
   * to a DIFFERENT source's card is skipped with a warning rather than clobbering that
   * card (which could carry a live session's tmux/workspace state).
   */
  applyIssues(
    issues: SourceIssue[],
    syncedAt: string,
    opts: { partial?: boolean; source?: string } = {},
  ): Promise<void> {
    return this.enqueue(() => {
      const src = opts.source ?? "linear";
      const current = new Map(
        [...this.cards.values()]
          .filter((c) => (c.source ?? "linear") === src)
          .map((c) => [c.issueId, c] as const),
      );
      const r = reconcile(issues, current, this.inFlightStarts, src);
      const applied: string[] = [];
      const syncedIn: string[] = [];
      for (const card of r.upserts) {
        const existing = this.cards.get(card.id);
        if (existing && (existing.source ?? "linear") !== src) {
          console.warn(
            `[store] skipped upsert of ${card.id} from source ${src} — id already owned by source ${existing.source ?? "linear"}.`,
          );
          continue;
        }
        if (!existing || syncedFieldsChanged(existing, card)) {
          syncedIn.push(card.id);
        }
        this.cards.set(card.id, card);
        applied.push(card.id);
      }
      for (const id of r.reappearedIds) {
        const card = this.cards.get(id);
        if (card) card.goneFromLinear = false;
      }
      if (opts.partial) {
        this.syncWarning =
          "Linear pull was truncated (pagination cap) — removals skipped this cycle.";
      } else {
        for (const id of r.removeIds) this.cards.delete(id);
        for (const id of r.goneIds) {
          const card = this.cards.get(id);
          if (card) card.goneFromLinear = true;
        }
        this.syncWarning = null;
      }
      this.syncedAt = syncedAt;
      this.syncUnreachable = false;
      return syncedIn.map((cardId) =>
        this.event("sync_in", {
          cardId,
          source: src,
          reason: "synced from " + src,
        }),
      );
    });
  }
}

/** The single shared store instance every producer/consumer imports. */
export const store = new BoardStore();
