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
import {
  BOARD_DB_PATH,
  type BoardDb,
  type BoardMeta,
  openBoardDb,
} from "./board-db.js";
import {
  APPLY_MARKER_EXCLUDED_SOURCES,
  FLIP_BACK_CLEARS_LAST_MARKER,
  FLIP_BACK_SOURCES,
  isManualMoveAllowed,
} from "../../shared/column-transitions.js";
import { NEEDS_INPUT_MARKER_PREFIX } from "../../shared/marker-key.js";
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
 * server-side only and carries every session's own secret field (the active session's own
 * `ttydPort`/`activeSessionId` already ride the wire unconditionally via the card's own flat
 * mirror fields, so no separate active-session projection is needed here, Phase 102); (3) at two
 * or more sessions, FIELD-PICK the `SessionSummary` keys per session onto
 * `wireCard.sessionSummaries`, sorted by `createdAt` ascending, never spreading the session
 * object — this is the only place a non-active session's own
 * `prs`/`previews`/`prsUnknown`/`previewsUnknown` become observable on the wire (`ARTIFACT-01`),
 * since `Card`'s own four fields stay a mirror of the active session only. Also resolves each
 * summary's `parentOrdinal` from `s.builtFrom` against the SAME sorted-by-`createdAt` array that
 * produces `ordinal`, so both sides of the relationship are positional and renumber together; an
 * unresolvable parent (never inherited, or the parent record has since been cleaned) yields
 * ABSENCE by explicit branch, never `undefined` leaking through a bare lookup. Resolves exactly one
 * hop — `builtFrom` is never traversed transitively (decision `D-C`). Operates on the shallow
 * copy only; never mutates the source card's `sessions` array or any session object.
 * @see docs/ARCHITECTURE.md#session-projection-chokepoint
 * @see docs/ARCHITECTURE.md#session-inheritance
 */
export function redactCard(card: Card): Card {
  const wireCard = { ...card };
  delete wireCard.hookToken;
  delete wireCard.sessions;
  const hasMultipleSessions = (card.sessions?.length ?? 0) >= 2;
  wireCard.sessionCount = hasMultipleSessions
    ? card.sessions!.length
    : undefined;
  const sortedSessions = hasMultipleSessions
    ? [...card.sessions!].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : undefined;
  const displayOrdinalById = new Map<string, number>();
  sortedSessions?.forEach((s, i) => displayOrdinalById.set(s.id, i + 1));
  wireCard.sessionSummaries = sortedSessions?.map((s, i) => {
    const resolvedParentOrdinal =
      s.builtFrom != null ? displayOrdinalById.get(s.builtFrom) : undefined;
    return {
      id: s.id,
      ordinal: i + 1,
      lost: s.tmuxSession == null,
      cleanupBlocked: s.cleanupBlocked,
      prs: s.prs,
      prsUnknown: s.prsUnknown,
      previews: s.previews,
      previewsUnknown: s.previewsUnknown,
      ...(resolvedParentOrdinal != null
        ? { parentOrdinal: resolvedParentOrdinal }
        : {}),
    };
  });
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
 * (SESS-04). Bump this ONLY when a new migration pass genuinely needs to run again.
 * @remarks It is the version LEDGER, not the migration's gate. `needsSessionEntityMigration()`
 * gates the pass, because a counter an older build's persist can drop is not something a data-
 * integrity check may depend on (`SESS-05`); what makes a second boot reproduce the same session
 * count and the same session ids is the pass being per-card idempotent, not this number (`NEW-21`).
 * It IS the gate for the opposite direction: {@link assertSchemaOpenable} refuses to open any board
 * persisted above this version, since a value above it can only have been written by a build that
 * knows a migration this one does not.
 * @see docs/ARCHITECTURE.md#downgrade-safety
 */
const SESSION_SCHEMA_VERSION = 1;

/**
 * The six flat session fields that mirror the card's active session record, as a value the
 * downgrade-drift pass can iterate. The authoritative statement of the same six lives in
 * {@link BoardStore.setActiveSession}; this list exists so the drift comparison cannot check a
 * subset of them by omission.
 * @see docs/ARCHITECTURE.md#downgrade-safety
 */
const PROJECTED_SESSION_FIELDS = [
  "tmuxSession",
  "ttydPort",
  "hookToken",
  "claudeSessionId",
  "workspacePath",
  "workspace",
] as const;

/**
 * Refuse to open a board whose persisted schema is NEWER than this build understands (`SESS-05`).
 *
 * The migration gate below is `persisted < SESSION_SCHEMA_VERSION`, which leaves `>` — a build
 * opening a database an already-updated sibling wrote — with no defined behaviour at all. This
 * build cannot know what that later migration moved, so every option other than refusing is a
 * guess about someone else's data: continuing would let this build's writers overwrite a shape it
 * never learned to read, and repairing would reconcile toward a projection that may no longer be
 * the newer schema's truth. Refusal is also the option that fails LOUDLY — the alternative silently
 * produces a board that looks correct and diverges underneath.
 * @remarks Nothing on disk is touched: no snapshot, no rotation, no quarantine, no write. Throwing
 * before the migration pass and before `hydrateFromParsed` means the refusing boot leaves the
 * database byte-identical to how it found it, so updating and restarting is a complete recovery
 * and the message can honestly promise that.
 * @remarks A plain `Error`, not a `StartupError`, because a store -> bootstrap import is
 * DAG-illegal; `connect()`'s non-corruption open failure in `board-db.ts` sets the precedent, and
 * bootstrap's `main().catch` already prints a thrown error loudly.
 * @remarks This guard can only ever live in the build doing the opening, so it protects FORWARD:
 * it stops a v3.0 build from opening a v3.1 board. It cannot stop the already-published v2.9 build
 * from opening a v3.0 board, because v2.9 ships without it and cannot be changed. That direction is
 * covered instead — after the fact, not preventively — by
 * {@link BoardStore.repairDowngradeDrift}.
 * @see docs/ARCHITECTURE.md#downgrade-safety
 */
function assertSchemaOpenable(persistedSchemaVersion: number): void {
  if (persistedSchemaVersion <= SESSION_SCHEMA_VERSION) return;
  throw new Error(
    `[store] ${BOARD_DB_PATH} was written by a NEWER version of dispatch than this one ` +
      `(board schema version ${persistedSchemaVersion}, this build understands ${SESSION_SCHEMA_VERSION}). ` +
      `Opening it with this build would let it write a shape it cannot read back, silently ` +
      `desyncing your sessions, so it refused. Nothing was changed — board.db and every backup ` +
      `were left exactly as they were. Fix it by updating dispatch: run ` +
      `\`npx @theyashgupta/dispatch@latest\` (or restart the machine's dispatch service after ` +
      `updating) and start again. If you instead mean to stay on this older build, restore the ` +
      `pre-upgrade copy at ${BOARD_DB_PATH}.pre-v3 over ${BOARD_DB_PATH} first — that file is ` +
      `your board as of before the newer version migrated it.`,
  );
}

/**
 * Do a card's flat projection and its active session record disagree on one field?
 * @remarks Compared by SERIALIZED value rather than by reference: `workspace` is an object, and a
 * card read back from `board.db` holds two structurally-identical but distinct copies of it (one
 * flat, one on the session record), so a reference test would report drift on every boot and a
 * repair would re-stamp `updatedAt` forever. `?? null` folds `undefined` and `null` together so a
 * producer that normalises an absent field to `null` is not mistaken for a divergence.
 */
function projectionDrifted(cardValue: unknown, sessionValue: unknown): boolean {
  return (
    JSON.stringify(cardValue ?? null) !== JSON.stringify(sessionValue ?? null)
  );
}

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

/**
 * Result of a successful `reserveNewSession` mint. Server-local — never reaches the wire, so it
 * does not belong beside the shared wire/persisted shapes in `src/shared/types.ts`.
 */
export interface ReservedSession {
  sessionId: string;
  ordinal: number;
  sessionName: string;
  /**
   * The resolved parent record's own `branch` value, captured inside the same `enqueue` that
   * mints so the saga never has to re-read the store to learn which git ref to cut from. Absent
   * when the reservation did not inherit, and absent when the resolved parent record carries no
   * `branch` of its own.
   */
  parentBranch?: string;
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
   * Card ids already reported by {@link sessionsWithTmux} as holding flat session state that
   * resolves to no session record (`WR-05`). Transient and in-memory like the three sets above:
   * it exists purely so a corrupt card is logged ONCE rather than on every 2s watcher tick, and a
   * restart deliberately re-reports so the operator sees it again.
   */
  private readonly warnedOrphanFlatSessions = new Set<string>();
  /**
   * Card ids already reported by {@link sessionsDueForCleanup} as holding a due card-level
   * `cleanupDueAt` with no due (or no) session record to attribute it to (`WR-05` sibling for
   * cleanup scheduling). Transient and in-memory like `warnedOrphanFlatSessions`: logged once per
   * card so a corrupt card is not re-reported on every scheduler tick, and a restart deliberately
   * re-reports so the operator sees it again.
   */
  private readonly warnedOrphanDueCards = new Set<string>();
  /**
   * Bootstrap-injected releaser for cleared hook tokens. The boundaries DAG forbids
   * store → services, so bootstrap wires services/domain/hook-tokens.ts' unregister function in here
   * (composed with hook-events' activity-throttle reaper, which is why the card id rides along);
   * the no-op default keeps the store safe to use before wiring.
   */
  private releaseHookToken: (
    token: string,
    cardId: string,
    sessionId: string | undefined,
  ) => void = () => {};

  /**
   * Wire the hook-token releaser at boot (bootstrap → store is DAG-legal).
   * @remarks `sessionId` (Phase 91) is the id {@link clearHookToken} resolved the released token
   * from, so the composite-keyed throttle reapers bootstrap composes with the registry unregister
   * can drop the correct sibling's own bucket rather than the whole card's.
   */
  setHookTokenReleaser(
    release: (
      token: string,
      cardId: string,
      sessionId: string | undefined,
    ) => void,
  ): void {
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
   * never ride that method's six-field mirror). `card.hookRoutedAt` — the flat mirror of the
   * ACTIVE session's own latch — is gated on `resolvedId === card.activeSessionId`: clearing a
   * NON-ACTIVE sibling's token must never null the mirror of a still-routed active session (the
   * debt Plan 02 deliberately parked here). Every pre-Phase-91 call site omits `sessionId`, so
   * `resolvedId` defaults to `card.activeSessionId` and the gate is trivially true — this change
   * is byte-identical for all six of them; only `markSessionLost`'s explicit-target call can ever
   * take the false branch.
   */
  private clearHookToken(card: Card, sessionId?: string): void {
    const resolvedId = sessionId ?? card.activeSessionId;
    const target = card.sessions?.find((s) => s.id === resolvedId);
    if (target?.hookToken)
      this.releaseHookToken(target.hookToken, card.id, resolvedId);
    this.setActiveSession(card, { hookToken: undefined }, sessionId);
    if (target) target.hookRoutedAt = undefined;
    if (resolvedId === card.activeSessionId) card.hookRoutedAt = undefined;
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
   * @remarks `mintSibling` (Phase 94) mints a NEW session record for a card that already has an
   * active one — the capability the pre-existing mint-on-absent branch cannot provide, since that
   * branch fires only when `card.activeSessionId` resolves to nothing at all (a card's very first
   * session). `mintSibling` mints unconditionally, bypassing that guard, and deliberately OMITS
   * the `card.activeSessionId = active.id` assignment the original mint branch always makes —
   * mint without promote, the mirror image of `promoteTarget`'s promote without mint. A reserved
   * session must not become the active one until its saga succeeds; promotion happens later, via
   * a separate `promoteTarget` call once the saga completes. `mintSibling` requires
   * `targetSessionId` to be omitted — minting AND addressing an explicit target in the same call
   * is a caller bug, refused the same way the other two guards above refuse. The method's return
   * value (the resolved or minted record's id, `undefined` on any refusal branch) exists so a
   * mint-only caller like `reserveNewSession` can learn the id it just minted.
   * @see docs/ARCHITECTURE.md#session-projection-chokepoint
   */
  private setActiveSession(
    card: Card,
    patch: Partial<Omit<Session, "id" | "createdAt" | "updatedAt">>,
    targetSessionId?: string,
    promoteTarget = false,
    mintSibling = false,
  ): string | undefined {
    if (promoteTarget && targetSessionId === undefined) {
      console.error(
        `[store] card ${card.id} — promoteTarget requires an explicit targetSessionId, refusing to project`,
      );
      return undefined;
    }
    if (mintSibling && targetSessionId !== undefined) {
      console.error(
        `[store] card ${card.id} — mintSibling requires targetSessionId to be omitted, refusing to project`,
      );
      return undefined;
    }
    const resolvedId = targetSessionId ?? card.activeSessionId;
    let active = card.sessions?.find((s) => s.id === resolvedId);
    const patchHasValue = Object.values(patch).some((v) => v !== undefined);
    let minted = false;
    if (mintSibling) {
      const now = new Date().toISOString();
      active = { id: randomUUID(), createdAt: now, updatedAt: now };
      card.sessions = card.sessions ?? [];
      card.sessions.push(active);
      minted = true;
    } else if (!active && targetSessionId === undefined && patchHasValue) {
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
      return undefined;
    }
    const mirrored = card.sessions?.find((s) => s.id === card.activeSessionId);
    card.tmuxSession = mirrored?.tmuxSession;
    card.ttydPort = mirrored?.ttydPort;
    card.hookToken = mirrored?.hookToken;
    card.claudeSessionId = mirrored?.claudeSessionId;
    card.workspacePath = mirrored?.workspacePath;
    card.workspace = mirrored?.workspace;
    return active?.id;
  }

  /**
   * Reconcile every card whose flat projection disagrees with its active session record, at boot,
   * before any reader sees a card (`SESS-05`). Returns one `id (fields…)` line per repaired card,
   * for the caller to log; the empty array means the board was already consistent.
   *
   * The divergence this repairs is what an OLDER dispatch build does to a migrated board. dispatch
   * ships via npx, so one machine updating before another is ordinary, and the two builds share
   * `~/.dispatch/board.db`. A v2.9 build reads a v3.0 card fine — the flat fields are all still
   * there — and round-trips `sessions`/`activeSessionId` as opaque JSON it never touches, but it
   * writes the flat fields DIRECTLY, having no {@link BoardStore.setActiveSession}. Its boot-time
   * reconcile alone is enough: a card whose tmux session is gone gets `tmuxSession`, `ttydPort` and
   * `hookToken` cleared flat while the session record goes on claiming all three.
   *
   * @remarks Repair, not refusal, and the direction is not a coin flip. Refusing here would be
   * useless in the only direction that matters: this is the newer build, the damage has already
   * happened, and refusing to open would strand the user on a board whose ONLY other reader is the
   * older build that caused the divergence — pushing them toward the damaging build rather than
   * away from it. So it repairs; {@link assertSchemaOpenable} is the refusal, and it covers the
   * opposite direction. The direction of the copy is forced rather than chosen: the flat field is
   * the one the older build wrote, so it is the newer value, and the session record is the stale
   * one. The reverse copy would resurrect a dead tmux session name, a stale ttyd port, and a hook
   * token the card no longer believes it holds.
   * @remarks Runs on EVERY boot, deliberately unconditioned on `schemaVersion`. Gating it on the
   * version counter would make it dead on arrival, because the version counter is the exact thing
   * an older build defeats: v2.9's `buildMeta()` has no `schemaVersion` field, so its persist drops
   * the key outright and the next boot reads `0` — which does make the version gate fire, but
   * `needsSessionEntityMigration()` then finds every card already carrying `sessions` and the pass
   * correctly does nothing. Version-equal or version-behind, the drift survives either way; only a
   * check whose subject is the DATA can see it.
   * @remarks Loud by construction and safe to re-run: the caller logs every repaired card id and
   * the field NAMES that moved (never values — `hookToken` is a secret). It mints no session ids
   * and adds or removes no session records on an already-migrated card, and once a card is
   * repaired the two sides serialize identically, so the next boot finds no drift and re-stamps
   * nothing. A card holding flat state but no resolvable record is the one shape this cannot
   * silently fix; it falls through to `setActiveSession`'s own mint-or-refuse branches, which
   * either mint a record for it or log and refuse rather than erasing what is left.
   * @see docs/ARCHITECTURE.md#downgrade-safety
   */
  private repairDowngradeDrift(cards: Card[]): string[] {
    const repaired: string[] = [];
    for (const card of cards) {
      const active = card.sessions?.find((s) => s.id === card.activeSessionId);
      const drifted = PROJECTED_SESSION_FIELDS.filter((field) =>
        projectionDrifted(card[field], active?.[field]),
      );
      if (drifted.length === 0) continue;
      this.setActiveSession(card, {
        tmuxSession: card.tmuxSession,
        ttydPort: card.ttydPort,
        hookToken: card.hookToken,
        claudeSessionId: card.claudeSessionId,
        workspacePath: card.workspacePath,
        workspace: card.workspace,
      });
      repaired.push(`${card.id} (${drifted.join(", ")})`);
    }
    return repaired;
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
   * @remarks `needsSessionEntityMigration()` — a test on the DATA, not on the version counter — is
   * what gates the snapshots and the pass, so a board carrying an unmigrated card is migrated
   * whatever `meta.schemaVersion` claims. The counter still decides whether the version bump has to
   * be persisted, but it is deliberately not the gate: an older build's persist drops the key
   * entirely, so a counter-gated pass would run on a board that needs nothing and skip one that
   * does. Idempotency is preserved by the pass itself, which is per-card idempotent — a card
   * already carrying `sessions` is skipped untouched and can never have an id re-minted — so a
   * second boot still reproduces the same session count and the same session ids.
   * @remarks When migration IS due, the two reversibility snapshots run in the approved order — the
   * cheap never-rotated `snapshotPreV3()` copy FIRST, then the forced `backupTick(true)` fold into
   * the rotating chain — so even if the (contractually never-throwing) forced tick somehow threw,
   * the retained snapshot already landed on disk. Both are skipped when nothing on the board needs
   * migrating (a fresh install, or a board with no session-bearing card). The migrated in-memory
   * state is persisted through the EXISTING transactional `enqueue`/`persist` path rather than a
   * separate raw-SQL write, so a crash mid-persist rolls back to the unmigrated, version-0 meta row
   * and the next boot re-runs the pass cleanly — a half-migrated database is impossible.
   * @remarks Two downgrade guards bracket the pass, covering opposite directions (`SESS-05`):
   * {@link assertSchemaOpenable} refuses outright, before anything is read or written, when the
   * board came from a NEWER build than this one; {@link BoardStore.repairDowngradeDrift} reconciles
   * the projection an OLDER build desynced, and runs after the migration so a card it has to repair
   * is guaranteed to own a session record by then.
   * @see docs/ARCHITECTURE.md#downgrade-safety
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
    assertSchemaOpenable(persistedSchemaVersion);
    const migrationDue = persistedSchemaVersion < SESSION_SCHEMA_VERSION;
    let migratedCount = 0;
    if (needsSessionEntityMigration(cards)) {
      this.db.snapshotPreV3();
      await this.db.backupTick(true);
      migratedCount = migrateCardsToSessionEntity(cards);
    }
    this.schemaVersion = SESSION_SCHEMA_VERSION;
    const repaired = this.repairDowngradeDrift(cards);
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
    }
    if (repaired.length > 0) {
      console.warn(
        `[store] downgrade repair: ${repaired.length} card(s) had flat session fields that ` +
          `disagreed with their active session record — an older dispatch build wrote this ` +
          `board. Reconciled the record to the flat value for: ${repaired.join("; ")}.`,
      );
    }
    if (migrationDue || repaired.length > 0) await this.enqueue(() => []);
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
   * `sessionSummaries` is a field-picked projection, never a spread, so a future `Session` field
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
   * Mint the hook channel's credential at session launch: stamp the TARGET session's `hookToken`
   * (and `card.hookToken` too, when that target is the card's active session). Written BEFORE the
   * session spawns (`steps.ts#startClaude` / `resume-session.ts#resumeSession`'s hooks-capable
   * branches, immediately before `newSession`) so a hook POST arriving as early as the kickoff
   * paste already authenticates. SECURITY: the token value is never logged. No-op if the id is
   * unknown.
   * @remarks (`WR-05`) This mutator deliberately does NOT stamp `card.hookRoutedAt`. The latch is
   * EVIDENCE that hook events actually arrive, never a PREDICTION derived from a `claude --version`
   * parse: the capability check says nothing about whether the hook script's `curl` exists on the
   * spawned session's PATH, and that script exits 0 on failure by design so the transport can fail
   * completely and silently. Stamping the latch here would close the watcher's `auto` gate for such
   * a session and leave it with ZERO status channels — no marker scan, no flip-back, no activity
   * dot — permanently. Arbitration must always fail toward HAVING a channel: `markHookRouted`, on
   * the first authenticated event, is the only place the latch may be written.
   * @remarks (Phase 91) Returns the id of the session the token landed on, resolved AFTER
   * `setActiveSession` runs, since that is what mints the session record when the card has none.
   * This is what lets the mint/register call sites close the token-before-session sequencing
   * hazard structurally: `registerHookToken` can only ever be called with a session id this method
   * has already proven exists.
   * @remarks (`WR-03`) "Proven" is a membership check, not an assumption about the active pointer.
   * `setActiveSession` has a refuse-to-project branch — a card holding flat session state that
   * resolves to no record — and on that branch nothing is persisted while `card.activeSessionId`
   * keeps naming a session that does not exist. Returning it regardless would report success for a
   * launch whose token authenticates nothing (`registerHookToken` refuses the orphan) AND skip the
   * hook-silent branch's `clearHookChannel()` reset, so the documented safe degradation would not
   * happen for the one card shape it was written for. `undefined` therefore means EITHER an unknown
   * card id OR an explicit or active pointer that names no record.
   * @remarks (Phase 96 finding F-96-A) `sessionId`, optional and defaulting to
   * `card.activeSessionId`, is required for a `newSession:true` launch: `reserveNewSession` mints
   * the new session WITHOUT promoting it active (`D-NOPROMOTE-ON-RESERVE`), so before this fix the
   * implicit default resolved to the card's CURRENT active session and minted the launching
   * session's own credential onto the WRONG, already-live session — leaving the new session's hook
   * channel unauthenticated until an unrelated mutation happened to repair it.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  mintHookChannel(
    id: string,
    token: string,
    sessionId?: string,
  ): Promise<string | undefined> {
    let minted: string | undefined;
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        minted = this.setActiveSession(card, { hookToken: token }, sessionId);
      }
      return [];
    }).then(() => minted);
  }

  /**
   * Stamp the Claude CLI `session_id` first-event-wins so exact Resume can `--resume <id>` back
   * into this conversation (SID-01). Single-field enqueue (setStatusReason precedent) with an
   * in-queue `== null` re-check (markHookRouted precedent), so the never-overwrite decision is
   * authoritative HERE: a racing second hook event finds the id already set and no-ops. The
   * differing-id case is handled by the caller (a logged mismatch), never a silent overwrite.
   * No-op if the id is unknown or already stamped.
   * @remarks `sessionId` (Phase 91) is the RESOLVED session record's own id, required and
   * defaulting to `card.activeSessionId` when the caller passes `undefined` — the never-overwrite
   * re-check reads THAT session's own `claudeSessionId`, not the card's flat mirror, so a sibling
   * that already stamped never suppresses this session's own first-event capture.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  setClaudeSessionId(
    id: string,
    sessionId: string | undefined,
    sid: string,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const targetId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === targetId);
      if (target && target.claudeSessionId == null)
        this.setActiveSession(card, { claudeSessionId: sid }, targetId);
      return [];
    });
  }

  /**
   * Clear a session's recorded Claude session id BEFORE a fresh session spawns. Called by the
   * start saga's launch step (a new kickoff is a new conversation) so the reset lands ahead of the
   * kickoff paste's first hook event — otherwise a restart of a card that still holds its old id
   * would make the new session's early events log a spurious `session_id mismatch` and drop the
   * genuine first capture. Symmetric with the pre-spawn hook-token mint. Distinct from the
   * first-event-wins setter and never called on the resume path, which must KEEP the id.
   * No-op if the id is unknown.
   * @remarks (Phase 96, found alongside F-96-A) `sessionId`, optional and defaulting to
   * `card.activeSessionId`, is required for the same reason `mintHookChannel` needs it: a
   * `newSession:true` launch's reserved session is not yet active
   * (`D-NOPROMOTE-ON-RESERVE`), so the implicit default previously cleared the CURRENT active
   * session's own `claudeSessionId` — wiping an unrelated, still-live sibling's `--resume`
   * capability as a side effect of starting a second session.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  resetClaudeSessionId(id: string, sessionId?: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card)
        this.setActiveSession(card, { claudeSessionId: undefined }, sessionId);
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
   * Record the PR(s) detected for a session's branch this tick, ONLY if the card owns a session
   * record named `session` (or, absent one, still flatly names it — the `sessionsWithTmux` synthetic
   * pair). Writes {@link Session.prs} on the RESOLVED record always, and mirrors onto `card.prs`
   * only when that record is the card's active session (`ARTIFACT-01`) — a probe result for a
   * non-active sibling can therefore never clobber the active session's own badge. Collapses an
   * empty result to `undefined` rather than `[]` so a deleted/merged-away-then-gone PR clears the
   * field in the same write a fresh detection would use. The session guard runs INSIDE the
   * mutation queue (setTtydPortIfSession precedent) because a detection tick holds its result for
   * up to the 8s `gh` timeout: a Done-drag cleanup enqueued during that window must win, or this
   * write would resurrect a stale badge on an already-torn-down session. No-op if the id is
   * unknown or no session (record or flat mirror) resolves.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  setPrsIfSession(id: string, session: string, prs: PrInfo[]): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const value = prs.length > 0 ? prs : undefined;
      const target = card.sessions?.find((s) => s.tmuxSession === session);
      if (target) {
        target.prs = value;
        if (target.id === card.activeSessionId) card.prs = value;
      } else if (card.tmuxSession === session) {
        card.prs = value;
      }
      return [];
    });
  }

  /**
   * Record the dev-server preview(s) detected for a session's process tree this tick — byte-for-byte
   * the `setPrsIfSession` shape, including the resolved-record-always / active-only-mirror split
   * (`ARTIFACT-01`). The session guard runs INSIDE the mutation queue (setPrsIfSession/
   * setTtydPortIfSession precedent): a Done-drag teardown enqueued during the detection window must
   * win, or this write would resurrect a badge on an already-torn-down session. Collapses an empty
   * result to `undefined` rather than `[]` so a died listener clears the field in the same write a
   * fresh detection would use. No-op if the id is unknown or no session resolves.
   * @see docs/ARCHITECTURE.md#dev-server-preview-detection
   */
  setPreviewsIfSession(
    id: string,
    session: string,
    previews: PreviewInfo[],
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const value = previews.length > 0 ? previews : undefined;
      const target = card.sessions?.find((s) => s.tmuxSession === session);
      if (target) {
        target.previews = value;
        if (target.id === card.activeSessionId) card.previews = value;
      } else if (card.tmuxSession === session) {
        card.previews = value;
      }
      return [];
    });
  }

  /**
   * Record (or clear, passing `null`) this tick's PR-probe failure category for a session — the
   * `setPrsIfSession` precedent, including the resolved-record-always / active-only-mirror split
   * (`ARTIFACT-01`). The session guard runs INSIDE the mutation queue for the same reason: a
   * Done-drag teardown enqueued during the detection window must win over a probe result that
   * started before the drop. No-op if the id is unknown or no session resolves.
   */
  setPrsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const value = unknown ?? undefined;
      const target = card.sessions?.find((s) => s.tmuxSession === session);
      if (target) {
        target.prsUnknown = value;
        if (target.id === card.activeSessionId) card.prsUnknown = value;
      } else if (card.tmuxSession === session) {
        card.prsUnknown = value;
      }
      return [];
    });
  }

  /**
   * Record (or clear, passing `null`) this tick's preview-probe failure category for a session —
   * byte-for-byte the `setPrsUnknownIfSession` shape, including the resolved-record-always /
   * active-only-mirror split (`ARTIFACT-01`). No-op if the id is unknown or no session resolves.
   */
  setPreviewsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const value = unknown ?? undefined;
      const target = card.sessions?.find((s) => s.tmuxSession === session);
      if (target) {
        target.previewsUnknown = value;
        if (target.id === card.activeSessionId) card.previewsUnknown = value;
      } else if (card.tmuxSession === session) {
        card.previewsUnknown = value;
      }
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
   * @remarks `sessionId` (Phase 91) is the RESOLVED session record's own id, required and
   * defaulting to `card.activeSessionId` when the caller passes `undefined`. The refuse-without-
   * token guard and the latch write both target THAT session's own `hookToken`/`hookRoutedAt`,
   * never the card's flat mirror — mirrored to `card.hookRoutedAt` only when the target IS the
   * active session, so the flat field stays a truthful projection exactly like the six fenced
   * ones (never routed through `setActiveSession`'s patch — {@link Session.hookRoutedAt} is
   * deliberately unfenced and the six-field re-derivation would clobber a sibling's value).
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  markHookRouted(
    id: string,
    sessionId: string | undefined,
    iso: string,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const targetId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === targetId);
      if (!target?.hookToken) return [];
      target.hookRoutedAt = iso;
      if (targetId === card.activeSessionId) card.hookRoutedAt = iso;
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
   * @remarks `sessionId` (Phase 94), same resolve-or-refuse shape as `completeStart` — explicit
   * `undefined` means "the card's own active session", matching every pre-Phase-94 call site's
   * exact prior behaviour. `promoteTarget` is `false` in every case here: a reattach targets a
   * session that is ALREADY the active one by construction (the tmux session it reattaches to was
   * created by a prior start of THIS card's active session), so promoting would be a no-op that
   * obscures that invariant rather than expressing a real state change.
   * @remarks `card.branch` is written only when the resolved session IS the active one — the same
   * gate `completeStart` applies, so a non-active session's reattach can never corrupt the ACTIVE
   * session's branch mirror `artifact-detect.ts` still reads. At N=1 the gated and unconditional
   * forms are byte-identical.
   */
  attachExistingSession(
    id: string,
    sessionId: string | undefined,
    s: SessionFields,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((sess) => sess.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — attach target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      const prev = card.column;
      this.setActiveSession(
        card,
        {
          workspacePath: s.workspacePath,
          tmuxSession: s.tmuxSession,
          ttydPort: s.ttydPort,
          branch: s.branch,
        },
        sessionId,
        false,
      );
      if (card.activeSessionId === resolvedId) card.branch = s.branch;
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
   * Clear a session's persisted `ttydPort` after a boot-time adoption attempt declined to adopt
   * it (ROBU-01) — the port answered no probe, or its owning PID could not be confirmed via
   * `lsof`, so it degrades to today's pre-fix state. No event: the panel for this card may not
   * even be open, so nothing needs to observe this cleanup; the next panel open transparently
   * fresh-spawns a ttyd via the existing `ensureTerminal` flow. No-op if the id is unknown.
   * @remarks `sessionId` (Phase 91) is a REQUIRED parameter that accepts `undefined` — every
   * caller must say which session's port it means, while `undefined` still resolves to
   * `card.activeSessionId` (today's exact single-session meaning), matching `markSessionLost`'s
   * own required-but-optional shape. The clear runs through `setActiveSession`'s existing
   * `targetSessionId` so an unadopted sibling's stale port is cleared on that session alone,
   * never on the card's active one.
   */
  clearStaleTtydPort(id: string, sessionId: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) this.setActiveSession(card, { ttydPort: undefined }, sessionId);
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
   * @remarks (`CR-01`) The dying session's `lastMarker` is cleared here, and this is its ONLY
   * clearing site for a session that will never be scanned again: `clearLastMarker` is driven from
   * the pane watcher, which only ever runs for a session still in `sessionsWithTmux()`, and
   * `finishCleanup` deliberately keeps the key. Leaving it set would strand a needs-input dedup key
   * on a record that can no longer answer, which `flipBack`'s cross-session gate would then read as
   * "a sibling is still waiting on the user" forever.
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
      if (target) target.lastMarker = undefined;
      if (targetId === card.activeSessionId) card.lastMarker = undefined;
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
   * Move the active pointer to a sibling session the card already owns — a thin caller of the
   * already-sanctioned promotion path, the same `setActiveSession(card, {}, id, true)` call shape
   * `markSessionLost`'s sibling-promotion branch uses today. Refuses (named, logged, no mutation)
   * when the card or the target session id does not resolve, so an unowned or stale id can never
   * strand the active pointer. No new field is assigned directly — the projection chokepoint
   * (`setActiveSession`) remains the only writer.
   * @see docs/ARCHITECTURE.md#session-projection-chokepoint
   */
  switchActiveSession(cardId: string, sessionId: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(cardId);
      if (!card) {
        console.error(
          `[store] switch target card ${cardId} does not resolve, refusing`,
        );
        return [];
      }
      const target = card.sessions?.find((s) => s.id === sessionId);
      if (!target) {
        console.error(
          `[store] card ${cardId} — switch target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      this.setActiveSession(card, {}, sessionId, true);
      return [];
    });
  }

  /**
   * Reserve a new sibling session record for a card that already owns an active session — the
   * mint-before-the-saga-runs step `94-CONTEXT.md` locks (`D-MINT`). Mints via
   * `setActiveSession`'s `mintSibling` capability, the sanctioned `NEW-21` chokepoint, so this
   * method never touches `card.sessions` directly. Does NOT promote the minted record to active —
   * a reserved session becomes active only on saga SUCCESS, inside `completeStart`
   * (`D-NOPROMOTE-ON-RESERVE`).
   * @remarks Refuses (named, logged, `null`, no mutation) when the card is unknown OR owns no
   * active session at all: there is nothing to "start ANOTHER session" from. This is the
   * server-side re-validation of the client's intent flag — the flag is never trusted to imply a
   * target.
   * @remarks `card.nextSessionOrdinal` advances BEFORE the mint can fail, so the counter has
   * already moved even if a later saga step fails and the reservation is rolled back — a retry
   * reserves a FRESH ordinal rather than colliding with the failed attempt's surviving branch
   * (`D-ROLLBACK`). The counter never decrements anywhere in the codebase.
   * @remarks The reserved record inherits the ACTIVE session's `workspace` (the ticket's source
   * repo/base pairs), which is identical across a ticket's sessions — only `workspacePath`, the
   * per-session worktree parent, differs, and `completeStart` sets that. Without this inheritance
   * the sibling never receives a `workspace` at all: `setCardWorkspace` writes through
   * `setActiveSession` with no explicit target, so it lands on whichever session is active, and a
   * reserved sibling is deliberately NOT active yet (`D-NOPROMOTE-ON-RESERVE`), while
   * `completeStart`'s patch carries only the four `SessionFields`. The two consequences are both
   * silent: `artifact-detect` gates its probe on `rec.workspace != null`, so the sibling's PRs
   * would never be probed (defeating `ARTIFACT-01` for the exact N>=2 case it exists for), and the
   * closing six-field mirror re-derives `card.workspace` from the newly promoted record, wiping the
   * card's own repo list that `cleanupWorkspace` reads.
   * @remarks `inheritFrom`, when supplied, resolves against `card.sessions` and is refused BEFORE
   * `card.nextSessionOrdinal` advances — a refused reservation must not consume an ordinal, so the
   * resolve-or-refuse guard runs first. This is what makes "an unresolvable parent id can never be
   * persisted" a structural property of the mint rather than a hope. The resolved record is a
   * SEPARATE lookup from `parent` above (the ACTIVE session, used for `workspace` seeding): when
   * `inheritFrom` names a non-active sibling the two are different records, and both are correct as
   * written — `workspace` is identical across a ticket's sessions, while lineage must name the
   * session the caller actually chose. `builtFrom` rides the existing `mintSibling` patch
   * conditionally, so a non-inherited reservation's record carries no `builtFrom` key at all — one
   * synchronous mutation, the `NEW-21` chokepoint intact, no new store method.
   * @see docs/ARCHITECTURE.md#session-projection-chokepoint
   * @see docs/ARCHITECTURE.md#session-inheritance
   */
  reserveNewSession(
    cardId: string,
    identifier: string,
    inheritFrom?: string,
  ): Promise<ReservedSession | null> {
    let reserved: ReservedSession | null = null;
    return this.enqueue(() => {
      const card = this.cards.get(cardId);
      if (!card) {
        console.error(
          `[store] reserveNewSession target card ${cardId} does not resolve, refusing`,
        );
        return [];
      }
      if (
        card.activeSessionId == null ||
        !card.sessions?.some((s) => s.id === card.activeSessionId)
      ) {
        console.error(
          `[store] card ${cardId} — reserveNewSession requires an existing active session, refusing`,
        );
        return [];
      }
      const inheritedParent =
        inheritFrom != null
          ? card.sessions?.find((s) => s.id === inheritFrom)
          : undefined;
      if (inheritFrom != null && inheritedParent == null) {
        console.error(
          `[store] card ${cardId} — reserveNewSession inheritFrom ${inheritFrom} does not resolve, refusing`,
        );
        return [];
      }
      const ordinal = card.nextSessionOrdinal ?? 2;
      card.nextSessionOrdinal = ordinal + 1;
      const sessionName = `${identifier}-${ordinal}`;
      const parent = card.sessions?.find((s) => s.id === card.activeSessionId);
      const sessionId = this.setActiveSession(
        card,
        {
          branch: sessionName,
          workspace: parent?.workspace,
          ...(inheritFrom != null ? { builtFrom: inheritFrom } : {}),
        },
        undefined,
        false,
        true,
      );
      if (sessionId === undefined) return [];
      reserved = {
        sessionId,
        ordinal,
        sessionName,
        parentBranch: inheritedParent?.branch,
      };
      return [];
    }).then(() => reserved);
  }

  /**
   * Roll a reservation back to nothing when the second-session saga fails (`D-ROLLBACK`): the
   * card returns to exactly its prior session set, no zombie `failed` record left in `sessions`.
   * Thin wrapper over `removeSessionRecord`, the exact splice-and-repair shape Phase 93 proved for
   * `finishCleanup`.
   * @remarks Refuses (named, logged, no mutation) when the card or the explicit `sessionId` does
   * not resolve — `switchActiveSession`'s refusal shape, never falling back to the active session
   * for an explicit target.
   * @remarks `removeSessionRecord`'s promotion branch is a structural no-op here, not a disabled
   * one: a reserved session is never promoted to active before its saga succeeds
   * (`reserveNewSession`'s `mintSibling` call above never sets `card.activeSessionId`), so
   * `wasActive` is always `false` for the record this method removes.
   * @remarks `card.nextSessionOrdinal` is deliberately NOT rewound here — a retry reserves a
   * fresh ordinal rather than colliding with the failed attempt's surviving branch.
   */
  rollbackReservedSession(cardId: string, sessionId: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(cardId);
      if (!card) {
        console.error(
          `[store] rollbackReservedSession target card ${cardId} does not resolve, refusing`,
        );
        return [];
      }
      const target = card.sessions?.find((s) => s.id === sessionId);
      if (!target) {
        console.error(
          `[store] card ${cardId} — rollback target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      this.removeSessionRecord(card, sessionId);
      return [];
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
   * @remarks `sessionId` (Phase 91) is the RESOLVED session record's own id, required and
   * defaulting to `card.activeSessionId` when the caller passes `undefined`. The dedup guard and
   * the `lastMarker` write both target THAT session's own field, mirrored to the card's flat
   * `lastMarker` only when the target IS the active session — a sibling's marker can never dedup
   * against or clobber another session's. `column`, `statusReason`, `mirrorMemberColumn`, and the
   * emitted event stay CARD-level and unchanged: one card has one column regardless of how many
   * sessions it owns. A card with no resolvable session record (pre-entity/corrupt) degrades to
   * the pre-Phase-91 card-level dedup/write exactly, matching this file's other corrupt-card
   * fallbacks.
   * @see docs/ARCHITECTURE.md#single-writer-store
   * @see docs/ARCHITECTURE.md#column-transition-specification
   */
  applyMarker(
    id: string,
    sessionId: string | undefined,
    column: Column,
    statusReason: string | undefined,
    markerKey: string,
    eventType: Extract<EventType, "status_needs_input" | "status_agent_done">,
  ): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || APPLY_MARKER_EXCLUDED_SOURCES.includes(c.column)) return [];
      const targetId = sessionId ?? c.activeSessionId;
      const target = c.sessions?.find((s) => s.id === targetId);
      const dedupKey = target ? target.lastMarker : c.lastMarker;
      if (dedupKey === markerKey) return [];
      const from = c.column;
      c.column = column;
      this.mirrorMemberColumn(c, column);
      c.statusReason = statusReason;
      if (target) {
        target.lastMarker = markerKey;
        if (targetId === c.activeSessionId) c.lastMarker = markerKey;
      } else {
        c.lastMarker = markerKey;
      }
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
   * @remarks `sessionId` (Phase 91) is the RESOLVED session record's own id, required and
   * defaulting to `card.activeSessionId` when the caller passes `undefined`. Clears THAT
   * session's own key, mirrored to the card's flat `lastMarker` only when the target IS the
   * active session — clearing a sibling's key can never clear the active session's own.
   */
  clearLastMarker(id: string, sessionId: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      const targetId = sessionId ?? c.activeSessionId;
      const target = c.sessions?.find((s) => s.id === targetId);
      if (target) target.lastMarker = undefined;
      if (targetId === c.activeSessionId) c.lastMarker = undefined;
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
   * @remarks `sessionId` (Phase 91) is the RESOLVED session record's own id, required and
   * defaulting to `card.activeSessionId` when the caller passes `undefined`. `lastMarker`
   * clearing (FLOW-02) is scoped to THAT session's own field, mirrored to the card only when the
   * target IS the active session. CONTEXT locks a cross-session gate on top of every existing
   * rule: leaving `needs_input` requires that no session the card owns which can still ANSWER
   * holds a needs-input marker, not merely that the firing session stopped — a card where any
   * OTHER session is still live (`tmuxSession != null`) AND its `lastMarker` starts with
   * {@link NEEDS_INPUT_MARKER_PREFIX} suppresses the whole move (per-session state untouched, no
   * event, column stays where it is), so a ticket with a live sibling still waiting on the user
   * never silently reads as answered. At N=1 no other session can ever exist, so this branch is
   * unreachable and behavior is byte-identical to before this remark.
   * @remarks (`CR-01`) The liveness half of that gate is load-bearing, not defensive. `lastMarker`
   * is per-session state that NO path clears on a session that is dead or cleaned up — the pane
   * watcher's `clearLastMarker` only ever runs for a session still in `sessionsWithTmux()` — so a
   * gate that consulted dead siblings too would be a ONE-WAY LATCH: the first sibling to record a
   * pause marker and then die would freeze the card in `needs_input` permanently, with no
   * user-visible reason and no path back but a manual drag. A session whose tmux pane is gone is
   * definitionally not waiting on the user, so it must not hold the card. `markSessionLost` clears
   * the dying session's `lastMarker` for the same reason; the two together are what give the gate
   * an invalidation path.
   * @returns `true` when the card actually moved, `false` when the move was suppressed (unknown
   * card, ineligible source column, or the cross-session gate above). The pane watcher needs this
   * because `decideScan` CONSUMES its flip-back baseline on the decision: without a signal it
   * would discard the evidence for a move the store silently refused, and the retry would need two
   * fresh divergent ticks an agent that has finished replying never produces.
   * @see docs/ARCHITECTURE.md#column-transition-specification
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  flipBack(id: string, sessionId: string | undefined): Promise<boolean> {
    let moved = false;
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || !FLIP_BACK_SOURCES.includes(c.column)) return [];
      const from = c.column;
      const targetId = sessionId ?? c.activeSessionId;
      if (
        from === "needs_input" &&
        (c.sessions ?? []).some(
          (s) =>
            s.id !== targetId &&
            s.tmuxSession != null &&
            s.lastMarker?.startsWith(NEEDS_INPUT_MARKER_PREFIX),
        )
      ) {
        return [];
      }
      moved = true;
      const target = "in_progress";
      c.column = target;
      this.mirrorMemberColumn(c, target);
      c.statusReason = undefined;
      if (FLIP_BACK_CLEARS_LAST_MARKER.includes(from)) {
        const targetSession = c.sessions?.find((s) => s.id === targetId);
        if (targetSession) {
          targetSession.lastMarker = undefined;
          if (targetId === c.activeSessionId) c.lastMarker = undefined;
        } else {
          c.lastMarker = undefined;
        }
      }
      return [
        this.event("move_auto", {
          cardId: id,
          fromCol: from,
          toCol: target,
          reason: "agent responded",
        }),
      ];
    }).then(() => moved);
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
   * @remarks (`WR-05`) This must be a per-session SUPERSET of `cardsWithSession()`, and iterating
   * `card.sessions` alone is not: the two agree only while the flat mirror is a faithful
   * projection, and `setActiveSession`'s own refuse-to-project branch exists precisely because the
   * codebase accepts that a card can hold flat session state with no resolvable record (a hand
   * edit, or a producer that normalises `sessions` to an empty array, which
   * `migrateCardsToSessionEntity` skips since it only tests `sessions != null`). Such a card used
   * to be scanned every tick, fail capture three times, and be repaired into `sessionLost` —
   * making it Restartable in the UI. Dropping it here would instead leave it never scanned, never
   * marked lost, never reaped, rendering a permanent "Live" chip and holding its worktree
   * indefinitely. So it is yielded as a SYNTHETIC pair built from the flat mirror — exactly the
   * card-scoped shape the pre-Phase-91 iteration source fed the watcher — and logged once, because
   * a corrupt card falling silently out of every loop is the one outcome that leaves it frozen.
   * @remarks The synthetic record's `id` is the card's unresolvable `activeSessionId` (or the
   * empty string when even that is unset), which is what makes the repair land where it should:
   * `markSessionLost` cannot resolve it either, so it degrades to its documented undefined-target
   * default and derives the card-level loss flag — the pre-Phase-91 behaviour — rather than
   * clearing some unrelated sibling's fields.
   * @remarks The synthetic record also carries the four ARTIFACT fields (`prs`, `prsUnknown`,
   * `previews`, `previewsUnknown`) off the same flat mirror. `artifact-detect.ts` reads them off
   * this record to decide whether a tick actually CHANGED anything, so omitting them made every
   * diff miss: `prsUnknown` read as undefined and `prs` as `[]` on every tick, so a standing
   * failure re-broadcast a full SSE board snapshot every 10s for this card class, the exact cost
   * those write-skip diffs exist to avoid.
   * @returns Pairs whose `session.tmuxSession` is carried in the TYPE, so consumers narrow without
   * a runtime guard the iteration source has already made unreachable (`IN-01`).
   */
  sessionsWithTmux(): {
    card: Card;
    session: Session & { tmuxSession: string };
  }[] {
    const out: { card: Card; session: Session & { tmuxSession: string } }[] =
      [];
    for (const card of this.cards.values()) {
      let yielded = false;
      for (const session of card.sessions ?? []) {
        if (session.tmuxSession != null) {
          out.push({
            card,
            session: session as Session & { tmuxSession: string },
          });
          yielded = true;
        }
      }
      if (yielded || card.tmuxSession == null) continue;
      if (!this.warnedOrphanFlatSessions.has(card.id)) {
        this.warnedOrphanFlatSessions.add(card.id);
        console.error(
          `[store] card ${card.id} — flat tmuxSession is set but no session record carries it; scanning the flat mirror so the dead-session repair path still runs`,
        );
      }
      out.push({
        card,
        session: {
          id: card.activeSessionId ?? "",
          createdAt: card.updatedAt,
          updatedAt: card.updatedAt,
          tmuxSession: card.tmuxSession,
          ttydPort: card.ttydPort,
          hookToken: card.hookToken,
          claudeSessionId: card.claudeSessionId,
          workspacePath: card.workspacePath,
          workspace: card.workspace,
          lastMarker: card.lastMarker,
          hookRoutedAt: card.hookRoutedAt,
          prs: card.prs,
          prsUnknown: card.prsUnknown,
          previews: card.previews,
          previewsUnknown: card.previewsUnknown,
        },
      });
    }
    return out;
  }

  /**
   * Synchronous read of every (card, session) pair whose automatic-cleanup schedule has elapsed
   * (`LIFE-03`), one entry per due SESSION. The column and `isStarting` checks stay CARD-scoped and
   * are applied ONCE per card, not folded into the per-session predicate (Pitfall 3): a card mid-
   * start-saga has ALL its sessions ineligible for this tick regardless of any individual session's
   * own `cleanupDueAt`, and a card that already left Done carries no schedule for ANY session by
   * design (`moveCardManual` clears every one on the way out). These reproduce, in the scheduler's
   * path, the same two defense-in-depth guards `routes/cards.route.ts` already applies to the manual
   * `/cleanup` route.
   * @remarks Structurally mirrors {@link sessionsWithTmux}: within an eligible card, every session
   * whose `cleanupDueAt` is set and at or before `now` yields its own entry. If the card yielded
   * NOTHING this way but its own `card.cleanupDueAt` is nonetheless due, one SYNTHETIC entry is
   * yielded with `sessionId: undefined` — the flat-mirror fallback for a card holding legacy flat
   * session state with no resolvable record (`WR-05`). `sessionId: undefined` is deliberate, not a
   * placeholder: {@link cleanupWorkspace} treats an `undefined` id as the legacy card-projection
   * path and falls back to the card, whereas a synthetic non-existent session id would hit its
   * explicit-miss refusal and produce the exact same stranding this fallback exists to prevent.
   * Dropping the fallback entirely would leave such a card never scanned, never cleaned, holding its
   * worktree indefinitely — so a corrupt/legacy card is logged once (`warnedOrphanDueCards`) rather
   * than silently dropped, mirroring `sessionsWithTmux`'s own once-per-card logging.
   */
  sessionsDueForCleanup(
    now: number,
  ): { card: Card; sessionId: string | undefined; dueAt: number }[] {
    const out: { card: Card; sessionId: string | undefined; dueAt: number }[] =
      [];
    for (const card of this.cards.values()) {
      if (card.column !== "done" || this.isStarting(card.id)) continue;
      let yielded = false;
      for (const session of card.sessions ?? []) {
        if (session.cleanupDueAt != null && session.cleanupDueAt <= now) {
          out.push({
            card,
            sessionId: session.id,
            dueAt: session.cleanupDueAt,
          });
          yielded = true;
        }
      }
      if (yielded) continue;
      if (card.cleanupDueAt != null && card.cleanupDueAt <= now) {
        if (!this.warnedOrphanDueCards.has(card.id)) {
          this.warnedOrphanDueCards.add(card.id);
          console.error(
            `[store] card ${card.id} — due cleanupDueAt is set at the card level but no session record carries it; scanning the flat mirror so cleanup still runs`,
          );
        }
        out.push({ card, sessionId: undefined, dueAt: card.cleanupDueAt });
      }
    }
    return out;
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
   * Also the sole writer of a FRESH deferred-cleanup schedule (`LIFE-02`), now stamped PER SESSION: a
   * genuine Done arrival (`from !== "done"`) stamps `cleanupDueAt` with a full `cleanupDelayMs`-length
   * delay on EVERY record in `card.sessions` that still holds `tmuxSession != null ||
   * workspacePath != null` — a ticket can own more than one session, and each is torn down and
   * scheduled independently. The card-level `cleanupDueAt` is kept as a MIRROR of the ACTIVE
   * session's stamp (same active-session-mirror discipline every other cleanup mutator here follows),
   * so the existing countdown render is byte-identical at N=1. A card with no session records but
   * still holding flat `tmuxSession`/`workspacePath` (the legacy path) gets `card.cleanupDueAt`
   * stamped directly, exactly as before. Leaving Done clears `cleanupDueAt` on EVERY session AND on
   * the card — a session left holding a stale schedule after a legal drag back to In Progress would
   * be torn down out from under a live ticket. The `from !== "done"` guard is load-bearing —
   * `isManualMoveAllowed` permits a done→done no-op move, and without the guard a redundant/retried
   * move-to-done would silently push every schedule out by a full delay. `restoreCleanupDue`
   * (`LIFE-03`) is the one other writer of the field, but it never mints a fresh delay — it only
   * re-instates a schedule the scheduler's own abandon path cleared moments earlier.
   */
  moveCardManual(id: string, column: Column): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      const from = c.column;
      if (!isManualMoveAllowed(from, column)) return [];
      c.column = column;
      this.mirrorMemberColumn(c, column);
      if (from !== "done" && column === "done") {
        const sessions = c.sessions ?? [];
        const dueAt = Date.now() + this.cleanupDelayMs;
        for (const s of sessions) {
          if (s.tmuxSession != null || s.workspacePath != null) {
            s.cleanupDueAt = dueAt;
          }
        }
        if (sessions.length === 0) {
          if (c.tmuxSession != null || c.workspacePath != null) {
            c.cleanupDueAt = dueAt;
          }
        } else {
          c.cleanupDueAt = sessions.find(
            (s) => s.id === c.activeSessionId,
          )?.cleanupDueAt;
        }
      }
      if (from === "done" && column !== "done") {
        for (const s of c.sessions ?? []) s.cleanupDueAt = undefined;
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
   * @remarks `sessionId` (Phase 94) addresses the session the saga was reserved for — explicit
   * `undefined` means "mint or use the card's own active session", matching every pre-Phase-94
   * call site's exact prior behaviour. When an explicit id IS given, the single
   * `setActiveSession(..., sessionId, true)` call patches AND promotes the reserved session to
   * active in the SAME synchronous step (`D-NOPROMOTE-ON-RESERVE`'s promotion-on-success moment) —
   * a patch-then-promote two-call sequence would re-introduce exactly the interleaving hazard
   * `promoteTarget`'s own JSDoc says it exists to prevent.
   * @remarks `card.branch` is written only when the resolved session IS the active one (evaluated
   * AFTER `setActiveSession`, so promotion has already landed): at N=1 the gated and unconditional
   * forms are byte-identical, while at N>=2 the ungated form would let a non-active session's
   * completion overwrite the ACTIVE session's branch mirror `artifact-detect.ts` still reads.
   */
  completeStart(
    id: string,
    sessionId: string | undefined,
    s: SessionFields,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((sess) => sess.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — complete-start target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      const prev = card.column;
      this.setActiveSession(
        card,
        {
          workspacePath: s.workspacePath,
          tmuxSession: s.tmuxSession,
          ttydPort: s.ttydPort,
          branch: s.branch,
        },
        sessionId,
        sessionId !== undefined,
      );
      if (card.activeSessionId === resolvedId) card.branch = s.branch;
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
   * @remarks Session-aware (`sessionId`, same resolution/refusal shape as
   * {@link recordCleanupBlocked}) but deliberately NON-removing: this branch means the teardown did
   * not fully complete (worktrees may remain), so the session still exists as a thing the user can
   * act on, and its warning needs a per-session home to live in. Removal is the SUCCESS path's
   * outcome only (`finishCleanup`) — this method leaves the target's record present in the
   * lost-but-present shape `markSessionLost` already established. The card-level mirrors
   * (`cleanupWarning`, `terminalError`, `prs`/`previews`, `cleanupDueAt`) are written only when the
   * resolved session is the card's active one; `cleanupAttempt` is bumped on both the resolved
   * session and, ungated, on the card.
   */
  recordCleanupWarning(
    id: string,
    sessionId: string | undefined,
    warning: string,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — record-cleanup-warning target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      const wasActive = resolvedId === card.activeSessionId;
      this.setActiveSession(
        card,
        {
          tmuxSession: undefined,
          ttydPort: undefined,
          claudeSessionId: undefined,
        },
        resolvedId,
      );
      this.clearHookToken(card, resolvedId);
      if (target) {
        target.cleanupWarning = warning;
        target.cleanupDueAt = undefined;
        target.cleanupAttempt = (target.cleanupAttempt ?? 0) + 1;
      }
      card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
      if (wasActive) {
        card.cleanupWarning = warning;
        card.terminalError = null;
        card.prs = undefined;
        card.prsUnknown = undefined;
        card.previews = undefined;
        card.previewsUnknown = undefined;
        card.cleanupDueAt = undefined;
      }
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
   * @remarks Session-aware (`sessionId`, same resolution/refusal shape as
   * {@link recordCleanupBlocked}) AND removing — this is the SUCCESS path, the only cleanup branch
   * that removes a record. `wasActive` is captured BEFORE {@link removeSessionRecord} runs, so the
   * card-level mirrors are written against the pointer as it stood at entry, not after removal has
   * possibly repointed it. `removeSessionRecord` is called LAST, once every other field on the
   * target and the card has already settled, so the splice and pointer repair operate on the fully
   * updated record.
   */
  finishCleanup(id: string, sessionId: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      const resolvedId = sessionId ?? c.activeSessionId;
      const target = c.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — finish-cleanup target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      const wasActive = resolvedId === c.activeSessionId;
      this.setActiveSession(
        c,
        {
          tmuxSession: undefined,
          ttydPort: undefined,
          workspacePath: undefined,
          claudeSessionId: undefined,
        },
        resolvedId,
      );
      this.clearHookToken(c, resolvedId);
      if (target) {
        target.cleanupWarning = undefined;
        target.cleanupBlocked = undefined;
        target.cleanupDueAt = undefined;
        target.cleanupAttempt = (target.cleanupAttempt ?? 0) + 1;
      }
      c.cleanupAttempt = (c.cleanupAttempt ?? 0) + 1;
      if (wasActive) {
        c.sessionLost = false;
        c.terminalError = null;
        c.cleanupWarning = undefined;
        c.cleanupBlocked = undefined;
        c.cleanupDueAt = undefined;
        c.prs = undefined;
        c.prsUnknown = undefined;
        c.previews = undefined;
        c.previewsUnknown = undefined;
      }
      this.removeSessionRecord(c, resolvedId);
      return [
        this.event("cleanup", { cardId: id, fromCol: "done", toCol: "done" }),
      ];
    });
  }

  /**
   * Splice a fully-cleaned session's record out of `card.sessions` and repair the active pointer in
   * the SAME synchronous mutator as the caller — the third sanctioned writer of the NEW-21 fenced
   * set, but of the two entity fields (`sessions`, `activeSessionId`, `scripts/check-invariants.mjs`'s
   * `ENTITY_FIELDS`) ONLY. It writes no projection field itself: every projection write it needs is delegated to
   * {@link setActiveSession}, so the six-field mirror keeps its single owner. `finishCleanup` is the
   * only caller — a warned teardown (`recordCleanupWarning`) did not fully complete, so its record
   * stays present per `markSessionLost`'s clear-in-place precedent; only a SUCCESSFUL teardown
   * removes the record, which is what keeps `sessionCount`/`sessionSummaries` absent-at-N<=1 correct
   * for a fully-cleaned card.
   * @remarks No-op (no mutation) when no record resolves for `sessionId ?? card.activeSessionId` —
   * a card holding only flat legacy fields has no record to remove and keeps behaving as it does
   * today.
   * @remarks Non-active removal is a plain splice: if the removed record was not the active one,
   * the pointer already names something else and is left untouched.
   * @remarks Active removal promotes a remaining sibling in the SAME mutation, preferring a LIVE one
   * (`tmuxSession != null`) — `markSessionLost`'s own tie-break (`updatedAt` descending, then `id`
   * ascending) reused verbatim, not re-derived. UNLIKE `markSessionLost`, this method falls back to
   * a DEAD remaining sibling when no live one exists: `markSessionLost` never removes a record, so
   * it can safely leave the pointer where it is on an unplanned death, but this method has just
   * REMOVED the pointed-at record — leaving records present with no active pointer would be exactly
   * the "N sessions and no active one" state `--check switch-atomicity` already forbids and
   * `docs/ARCHITECTURE.md`'s session-projection-chokepoint section says a card must never be
   * observed in. The pointer is cleared to `undefined` ONLY when no record remains at all, then
   * re-projected through `setActiveSession(card, {})` — relying on the precondition that the flat
   * session fields were already cleared by the caller (`finishCleanup`'s `setActiveSession` call
   * above), so the re-derivation's own refusing-to-project branch is not taken.
   * @see docs/ARCHITECTURE.md#session-projection-chokepoint
   */
  private removeSessionRecord(card: Card, sessionId: string | undefined): void {
    const resolvedId = sessionId ?? card.activeSessionId;
    const target = card.sessions?.find((s) => s.id === resolvedId);
    if (!target) return;
    const wasActive = resolvedId === card.activeSessionId;
    card.sessions = (card.sessions ?? []).filter((s) => s.id !== resolvedId);
    if (!wasActive) return;
    const byRecency = (a: Session, b: Session): number =>
      a.updatedAt === b.updatedAt
        ? a.id.localeCompare(b.id)
        : b.updatedAt.localeCompare(a.updatedAt);
    const live = card.sessions.filter((s) => s.tmuxSession != null);
    const promoted =
      live.sort(byRecency)[0] ?? [...card.sessions].sort(byRecency)[0];
    if (promoted) {
      this.setActiveSession(card, {}, promoted.id, true);
    } else {
      card.activeSessionId = undefined;
      this.setActiveSession(card, {});
    }
  }

  /**
   * Scan for warned-but-retained session records past their retention window WITHOUT mutating or
   * enqueueing anything, so {@link pruneStaleWarnedSessions} can learn whether it has any work
   * before it takes the single-writer queue. {@link sessionsDueForCleanup} is the in-file
   * precedent for the shape: a plain read over `this.cards`.
   * @remarks The pre-scan is not an optimization, it is the difference between an idle timer and a
   * permanent one. `enqueue` has no no-op path: every call runs `backupTick`, persists the FULL
   * card set and emits `change`, which makes `sse.route.ts` build and write a whole board snapshot
   * to every connected client. An unconditional enqueue on the one-minute cleanup tick would
   * charge a board write and a full SSE fan-out per minute forever to a board with nothing
   * prunable. `runDueCleanups` already behaves this way, enqueueing only when its own scan yields
   * work.
   * @remarks Card guards are the same three every other cleanup dispatcher takes: `done` only,
   * never mid-{@link isStarting} (which covers start AND resume sagas), never
   * mid-{@link isCleaningUp}. The last one matters most here. `cleanupWorkspace` does seconds of
   * `git worktree` work between store calls, and a prune tick landing inside that window would
   * splice out the very record the teardown is operating on, after which every terminal cleanup
   * mutator ({@link finishCleanup}, {@link recordCleanupWarning}, {@link recordCleanupBlocked})
   * takes its "target does not resolve, refusing" branch and the teardown's outcome is discarded.
   * @remarks The caller re-runs this scan INSIDE the mutator rather than trusting the pre-scan's
   * snapshot, matching how `runDueCleanups` re-validates against a fresh `store.getCard` before it
   * dispatches.
   */
  private stalePrunableSessions(
    now: number,
  ): { card: Card; sessionId: string }[] {
    const out: { card: Card; sessionId: string }[] = [];
    for (const card of this.cards.values()) {
      if (
        card.column !== "done" ||
        this.isStarting(card.id) ||
        this.isCleaningUp(card.id)
      ) {
        continue;
      }
      for (const session of card.sessions ?? []) {
        if (!session.cleanupWarning || session.tmuxSession != null) continue;
        if (session.workspacePath != null || session.claudeSessionId != null) {
          continue;
        }
        const updatedAtMs = Date.parse(session.updatedAt);
        if (!Number.isFinite(updatedAtMs)) continue;
        if (now - updatedAtMs < this.cleanupDelayMs) continue;
        out.push({ card, sessionId: session.id });
      }
    }
    return out;
  }

  /**
   * Prune stale warned-but-retained session records (Phase 93 residual R3). A warned
   * teardown ({@link recordCleanupWarning}) deliberately keeps its record so the user can act on
   * the warning, but nothing removed it afterward, so every failed teardown was a permanent leak
   * in `card.sessions` until this method.
   *
   * The rule: a session record is pruned when all four hold: `cleanupWarning` is set,
   * `tmuxSession` is absent, `workspacePath` and `claudeSessionId` are BOTH absent, and
   * `now - Date.parse(session.updatedAt) >= cleanupDelayMs`. Every removal returns a `cleanup`
   * activity event, so this path is auditable in `GET /api/events` like every other cleanup
   * branch.
   * @remarks `cleanupWarning` set identifies the warned-but-retained class; `tmuxSession` absent
   * excludes {@link noteCleanupWarning}'s preflight-refusal records, whose tmux session, ttyd and
   * hookToken are deliberately still alive and usable; and the `cleanupDelayMs` window gives the
   * warning at least as long to be seen as the successful cleanup it replaced would itself have
   * waited before firing.
   * @remarks The `workspacePath`/`claudeSessionId` clause is what keeps this from being silent
   * amnesia. {@link finishCleanup} removes a record only after the teardown SUCCEEDED, so nothing
   * on disk survives it; this method removes records precisely because their teardown FAILED,
   * which is exactly when the worktree named by `workspacePath` may still exist
   * (`cleanup.ts`'s "Cleanup incomplete - some worktrees may remain."). `claudeSessionId` is the
   * whole `--resume` affordance {@link recordResumeFailure} deliberately keeps, and neither
   * {@link moveCardManual} nor `recordResumeFailure` clears `cleanupWarning`, so a card warned,
   * dragged out of Done, failed to resume and dragged back would otherwise have its only recovery
   * handle deleted a week later. What remains prunable is the population the residual was actually
   * about: legacy-workspace and folder-already-removed warnings whose only remaining state IS the
   * warning.
   * @remarks Fails closed on a bad timestamp: an absent `updatedAt`, or one `Date.parse` cannot
   * resolve to a finite number, is never pruned. `NaN` comparisons are false in JavaScript, which
   * happens to give the right answer here, but the finite check is written explicitly so the
   * safety is stated rather than incidental.
   * @remarks Selection lives in {@link stalePrunableSessions}, which is run TWICE: once before the
   * `enqueue` so an idle tick costs no board write and no SSE frame, and once inside the mutator
   * so the removal acts on freshly resolved state rather than the pre-scan's snapshot. The removal
   * repeats {@link finishCleanup}'s FULL removal order for every
   * qualifying record, not merely its `card.*` mirror block: the flat projection is cleared
   * through {@link setActiveSession} and the token through {@link clearHookToken} BEFORE the
   * record goes, which is the precondition {@link removeSessionRecord}'s own contract names.
   * Omitting it drives the pointer repair into `setActiveSession`'s refusing-to-project branch and
   * leaves the card holding an empty `sessions` array beside a live `workspacePath`, the exact
   * shape that projection chokepoint calls corrupt: `isAwaitingCleanup` then pins the card
   * forever, manual recovery re-enters the same refusal, and the next boot's
   * {@link repairDowngradeDrift} mints an anonymous phantom record from the orphaned flat fields.
   * `wasActive` is captured BEFORE {@link removeSessionRecord} runs, the matching `card.*` mirrors
   * are cleared only under that guard, and `removeSessionRecord` is called LAST so no card can end
   * up with a dangling `activeSessionId`.
   */
  pruneStaleWarnedSessions(now: number): Promise<void> {
    if (this.stalePrunableSessions(now).length === 0) return Promise.resolve();
    return this.enqueue(() => {
      const events: Omit<ActivityEvent, "id">[] = [];
      for (const { card, sessionId } of this.stalePrunableSessions(now)) {
        const wasActive = sessionId === card.activeSessionId;
        this.setActiveSession(
          card,
          {
            tmuxSession: undefined,
            ttydPort: undefined,
            workspacePath: undefined,
            workspace: undefined,
            claudeSessionId: undefined,
          },
          sessionId,
        );
        this.clearHookToken(card, sessionId);
        if (wasActive) {
          card.sessionLost = false;
          card.terminalError = null;
          card.cleanupWarning = undefined;
          card.cleanupBlocked = undefined;
          card.cleanupDueAt = undefined;
          card.prs = undefined;
          card.prsUnknown = undefined;
          card.previews = undefined;
          card.previewsUnknown = undefined;
        }
        this.removeSessionRecord(card, sessionId);
        events.push(
          this.event("cleanup", {
            cardId: card.id,
            fromCol: "done",
            toCol: "done",
            reason: "Stale cleanup warning pruned after the retention window.",
          }),
        );
      }
      return events;
    });
  }

  /**
   * Record a non-forced Done-cleanup refusal (PRE-01): a dirty-worktree preflight blocked teardown,
   * so set the per-repo `cleanupBlocked` list and touch NOTHING else. Unlike recordCleanupWarning
   * (which runs only AFTER teardown and clears the session fields), this fires BEFORE any
   * destructive step — the tmux session, ttyd, hookToken, and worktrees all stay alive so the card
   * remains fully usable while the block is surfaced. Bumps `cleanupAttempt` — this is one of the
   * four terminal cleanup branches. No-op if the id is unknown.
   * @remarks `sessionId` is a REQUIRED (never optional-trailing) parameter that accepts
   * `undefined`, resolved against `card.activeSessionId` with the exact
   * {@link BoardStore.clearHookToken} gate: an EXPLICIT id that does not resolve refuses (named,
   * logged, no mutation) rather than silently falling back to the active session. The per-session
   * `cleanupBlocked` is written on the resolved target whenever one resolves; the card-level mirror
   * is written only when the resolved id is the card's active session — a card with no session
   * records at all resolves both sides of that comparison to `undefined`, so the legacy card-only
   * shape still gets its mirror written, unchanged from today. `cleanupAttempt` is the one
   * deliberate exception: its card write is NOT gated (see {@link Card.cleanupAttempt}), and it is
   * also bumped on the resolved session's own counter.
   */
  recordCleanupBlocked(
    id: string,
    sessionId: string | undefined,
    blocked: { repo: string; count: number }[],
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — cleanup-blocked target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      if (target) {
        target.cleanupBlocked = blocked;
        target.cleanupAttempt = (target.cleanupAttempt ?? 0) + 1;
      }
      if (resolvedId === card.activeSessionId) card.cleanupBlocked = blocked;
      card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
      return [];
    });
  }

  /**
   * Clear a prior cleanup refusal (PRE-01) at the start of a fresh attempt. No-op if id unknown.
   * @remarks Same `sessionId` resolution and refusal shape as {@link recordCleanupBlocked}.
   */
  clearCleanupBlocked(
    id: string,
    sessionId: string | undefined,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — clear-cleanup-blocked target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      if (target) target.cleanupBlocked = undefined;
      if (resolvedId === card.activeSessionId) card.cleanupBlocked = undefined;
      return [];
    });
  }

  /**
   * Clear a card's pending automatic-cleanup schedule. Called BEFORE `cleanupWorkspace` dispatches
   * — `LIFE-03`'s first double-run guard, so a second tick can no longer see the card as due. No-op
   * if the id is unknown or the schedule is already cleared.
   * @remarks Same `sessionId` resolution and refusal shape as {@link recordCleanupBlocked}.
   */
  clearCleanupDue(id: string, sessionId: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — clear-cleanup-due target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      if (target) target.cleanupDueAt = undefined;
      if (resolvedId === card.activeSessionId) card.cleanupDueAt = undefined;
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
   * @remarks Same `sessionId` resolution and refusal shape as {@link recordCleanupBlocked}, checked
   * AFTER the existing `column === "done"` guard so a card that already left Done still no-ops
   * exactly as before regardless of what `sessionId` names.
   */
  restoreCleanupDue(
    id: string,
    sessionId: string | undefined,
    dueAt: number,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card || card.column !== "done") return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — restore-cleanup-due target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      if (target) target.cleanupDueAt = dueAt;
      if (resolvedId === card.activeSessionId) card.cleanupDueAt = dueAt;
      return [];
    });
  }

  /**
   * Zero-teardown cleanup warning (PRE-04): the preflight-refusal-safe sibling of
   * recordCleanupWarning. Sets ONLY the muted `cleanupWarning` and clears no session fields, because
   * the non-orphan preflight-error path tore nothing down — the live tmux session, ttyd, and
   * hookToken MUST survive so the terminal stays usable. Bumps `cleanupAttempt` — this is one of the
   * four terminal cleanup branches. No-op if the id is unknown.
   * @remarks Same `sessionId` resolution and refusal shape as {@link recordCleanupBlocked};
   * `cleanupAttempt`'s card write is the same deliberately ungated exception.
   */
  noteCleanupWarning(
    id: string,
    sessionId: string | undefined,
    message: string,
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const resolvedId = sessionId ?? card.activeSessionId;
      const target = card.sessions?.find((s) => s.id === resolvedId);
      if (sessionId !== undefined && !target) {
        console.error(
          `[store] card ${id} — note-cleanup-warning target ${sessionId} does not resolve, refusing`,
        );
        return [];
      }
      if (target) {
        target.cleanupWarning = message;
        target.cleanupAttempt = (target.cleanupAttempt ?? 0) + 1;
      }
      if (resolvedId === card.activeSessionId) card.cleanupWarning = message;
      card.cleanupAttempt = (card.cleanupAttempt ?? 0) + 1;
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
