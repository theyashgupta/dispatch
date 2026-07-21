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
  PrInfo,
  SessionFields,
  SourceIssue,
  StartError,
  TerminalError,
} from "../../shared/types.js";
import { type BoardDb, type BoardMeta, openBoardDb } from "./board-db.js";
import { isStartingCard, reconcile } from "./mapping.js";

const BOARD_DIR = path.join(os.homedir(), ".dispatch");
export const BOARD_PATH = path.join(BOARD_DIR, "board.json");

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
   */
  private clearHookToken(card: Card): void {
    if (card.hookToken) this.releaseHookToken(card.hookToken, card.id);
    card.hookToken = undefined;
    card.hookRoutedAt = undefined;
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
        this.emit("change", this.snapshot());
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
  }

  /**
   * Apply a parsed snapshot to the in-memory Map, shared by the healthy-load and backup-recovery
   * paths so a recovered board hydrates byte-for-byte identically to a healthy one: rebuild the
   * cards Map, rewrite any interrupted in-flight provisioning into a retryable startError, reset
   * the transient `terminalError`/`syncing`, and default syncedAt / workspaceFolders / lastUsed.
   * `ttydPort` is preserved for any card outside the To Do / Done columns (ROBU-01) — a parked
   * card structurally carries no live session, so clearing it there costs nothing, but an
   * active-column card's port is the one thing boot-time reconcile needs to attempt re-adopting
   * the still-running ttyd instead of reaping it; `reconcileSessions()` clears it back via
   * `clearStaleTtydPort` for any candidate whose adoption attempt fails, so a genuinely dead port
   * never lingers past the first reconcile pass.
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
        if (card.column === "todo" || card.column === "done") {
          card.ttydPort = undefined;
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
   * Build the canonical WIRE snapshot (SSE frames + REST reads). The To Do cards are sorted
   * with compareTodoOrder on this read path; other columns carry no Phase-1 ordering decision
   * (the frontend re-partitions by `column`, so cross-column concat order is irrelevant).
   * SECURITY: this is the single outbound chokepoint — each card is copied and `hookToken`
   * deleted, so the per-session hook-auth secret never rides an SSE frame or a REST response
   * (only the persisted board.json carries it). Redact future secret-adjacent card fields here
   * (hookRoutedAt was considered and deliberately rides the wire — a non-secret timestamp).
   */
  snapshot(): BoardSnapshot {
    const snap = this.persistSnapshot();
    return {
      ...snap,
      cards: snap.cards.map((card) => {
        const wireCard = { ...card };
        delete wireCard.hookToken;
        return wireCard;
      }),
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
      if (card) card.workspace = workspace;
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
   * Persist (or clear) the card's per-session hook-auth token (setStatusReason precedent: a
   * single-field enqueue). Written BEFORE the session spawns so a hook POST arriving as early
   * as the kickoff paste finds the token already durable; the restart-time registry rebuild
   * reads it back. SECURITY: the token value is never logged.
   */
  setHookToken(id: string, token: string | undefined): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.hookToken = token;
      return [];
    });
  }

  /**
   * Stamp the Claude CLI `session_id` first-event-wins so exact Resume can `--resume <id>` back
   * into this conversation (SID-01). Single-field enqueue (setHookToken precedent) with an
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
        card.claudeSessionId = sessionId;
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
      if (card) card.claudeSessionId = undefined;
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
   * column/other-field interaction, no activity event (D-12 keeps the EventType union frozen).
   * Collapses an empty result to `undefined` rather than `[]` so a deleted/merged-away-then-gone
   * PR clears the field in the same write a fresh detection would use, satisfying D-11's "cleared
   * when a detection pass finds no PR" without a second mutator. The session guard runs INSIDE the
   * mutation queue (setTtydPortIfSession precedent) because a detection tick holds its result for
   * up to the 8s `gh` timeout: a Done-drag cleanup enqueued during that window must win, or this
   * write would resurrect a stale badge on an already-torn-down card and break D-11. No-op if the
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
   * Latch the session as hook-routed for channel selection: the ISO timestamp of its first
   * authenticated hook event. Write-once per session by service-side guard — the store stays
   * policy-free (no throttling, no read-before-write here). Mirrors setOutputChanged: a
   * single-field enqueue. Cleared only via the clearHookToken chokepoint. Refuses to stamp a
   * card that holds no hookToken, so the latch always implies a live token even when the
   * service's read-outside-queue guard raced a queued session-clearing mutation — a latch
   * without a token would demote pane scanning for a session with no hook traffic. No-op if
   * the id is unknown.
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
      card.workspacePath = s.workspacePath;
      card.branch = s.branch;
      card.tmuxSession = s.tmuxSession;
      card.ttydPort = s.ttydPort;
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
        card.ttydPort = port;
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
        card.ttydPort = undefined;
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
      if (card) card.ttydPort = undefined;
      return [];
    });
  }

  /**
   * Mark a card's tmux session as lost (Phase 5, RESIL-01/02) in ONE atomic mutation: set
   * `sessionLost` AND clear `tmuxSession`/`ttydPort`/`terminalError` together (recordTtydExit
   * precedent — a split write would broadcast a torn frame that briefly renders a To-Do-looking
   * card with no session and no lost line). Clearing `tmuxSession` removes the card from
   * cardsWithSession() (freeing the watcher) and makes the DetailPanel terminal region disappear
   * (Pitfall 5); the session name stays derivable as `dsp-` + identifier for restart. Called at
   * BOTH boot (reconcileSessions) and RUNTIME (Plan 02's watcher dead-session detector, per tick).
   * `hookToken` is cleared AND unregistered with the session (clearHookToken) — a card without
   * a live session must not keep a live, still-resolving secret. No-op if the id is unknown.
   * SECURITY: never logs card contents.
   */
  markSessionLost(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      const wasTransition = !(card.sessionLost && card.tmuxSession == null);
      card.sessionLost = true;
      card.tmuxSession = undefined;
      card.ttydPort = undefined;
      card.terminalError = null;
      this.clearHookToken(card);
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
   * A marker NEVER moves a card out of "To Do" or "Done" — checked INSIDE the mutator (live Map,
   * so a queued drag to Done wins over a concurrently-scanned marker): a To Do card with a
   * surviving session (e.g. interrupted-saga + Retry showing) must not bypass the start flow,
   * and a card the user parked in Done stays parked. Cards in in_progress / needs_input /
   * agent_done remain eligible (an Agent Done card CAN move to Needs Input on a new distinct
   * marker — intended). SECURITY: never logs card, reason, or pane contents.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  applyMarker(
    id: string,
    column: Column,
    statusReason: string | undefined,
    markerKey: string,
  ): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || c.column === "todo" || c.column === "done") return [];
      if (c.lastMarker === markerKey) return [];
      const from = c.column;
      c.column = column;
      this.mirrorMemberColumn(c, column);
      c.statusReason = statusReason;
      c.lastMarker = markerKey;
      return [
        this.event(
          column === "needs_input" ? "status_needs_input" : "status_agent_done",
          {
            cardId: id,
            fromCol: from,
            toCol: column,
            reason: statusReason ?? null,
          },
        ),
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
   * Flip a Needs-Input card back to In Progress once the agent responds (Phase 4, MARK-03): clear
   * statusReason in ONE atomic mutation. `lastMarker` is left UNTOUCHED so the still-visible
   * NEEDS_INPUT marker line cannot re-fire on the next tick (the watcher dedups on `lastMarker`).
   * No-op if the id is unknown.
   *
   * The column check lives INSIDE the mutator (the applyIssues precedent): the watcher's read of
   * `column === "needs_input"` happens outside the queue, so a manual drag can already be queued
   * ahead of this flip. Re-checking against the live Map here makes the flip a no-op unless the
   * card is STILL in Needs Input — a queued drag (e.g. to Done) can never be silently reverted.
   */
  flipBack(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c || c.column !== "needs_input") return [];
      const target = "in_progress";
      c.column = target;
      this.mirrorMemberColumn(c, target);
      c.statusReason = undefined;
      return [
        this.event("move_auto", {
          cardId: id,
          fromCol: "needs_input",
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
   * Manual drag move (Phase 4, MARK-04): set the column and, when the new column is neither
   * attention column (needs_input / agent_done), clear statusReason — as ONE atomic mutation.
   * `lastMarker` is left UNTOUCHED so a drag CONSUMES the current marker: the watcher still sees
   * "already seen" (markerKey === lastMarker) and never re-applies the marker the user just
   * overrode. Replaces the plain moveCard on the drag route. Also the sole promote/demote mutator
   * (Inbox and To Do share this same move rather than a new endpoint): an Inbox-to-To-Do
   * transition stamps `promotedAt`, the single-writer store being the ONLY place that field is
   * ever assigned. No-op if the id is unknown.
   */
  moveCardManual(id: string, column: Column): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      const from = c.column;
      c.column = column;
      this.mirrorMemberColumn(c, column);
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
      card.workspacePath = s.workspacePath;
      card.branch = s.branch;
      card.tmuxSession = s.tmuxSession;
      card.ttydPort = s.ttydPort;
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
      card.tmuxSession = session;
      card.sessionLost = false;
      card.terminalError = null;
      card.ttydPort = undefined;
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
      card.tmuxSession = undefined;
      card.ttydPort = undefined;
      card.terminalError = null;
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
   * `hookToken` is cleared AND unregistered with the session fields (clearHookToken). `prs` is
   * cleared alongside the other session fields (D-11). Column untouched. No-op if the id is
   * unknown.
   */
  recordCleanupWarning(id: string, warning: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (!card) return [];
      card.cleanupWarning = warning;
      card.tmuxSession = undefined;
      card.ttydPort = undefined;
      card.terminalError = null;
      this.clearHookToken(card);
      card.claudeSessionId = undefined;
      card.prs = undefined;
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
   * `prs` undefined (the token also unregistered via clearHookToken; `prs` cleared per D-11),
   * `sessionLost` false, `terminalError` null. KEEPS `branch` (branches always survive per lock),
   * `outputChangedAt`, and `lastMarker`. No-op if the id is unknown.
   */
  finishCleanup(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (!c) return [];
      c.tmuxSession = undefined;
      c.ttydPort = undefined;
      c.workspacePath = undefined;
      c.sessionLost = false;
      c.terminalError = null;
      c.cleanupWarning = undefined;
      c.cleanupBlocked = undefined;
      this.clearHookToken(c);
      c.claudeSessionId = undefined;
      c.prs = undefined;
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
   * remains fully usable while the block is surfaced. No-op if the id is unknown.
   */
  recordCleanupBlocked(
    id: string,
    blocked: { repo: string; count: number }[],
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupBlocked = blocked;
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
   * Zero-teardown cleanup warning (PRE-04): the preflight-refusal-safe sibling of
   * recordCleanupWarning. Sets ONLY the muted `cleanupWarning` and clears no session fields, because
   * the non-orphan preflight-error path tore nothing down — the live tmux session, ttyd, and
   * hookToken MUST survive so the terminal stays usable. No-op if the id is unknown.
   */
  noteCleanupWarning(id: string, message: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupWarning = message;
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
