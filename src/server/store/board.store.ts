import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  BoardSnapshot,
  Card,
  Column,
  SessionFields,
  SourceIssue,
  StartError,
  TerminalError,
} from "../../shared/types.js";
import { recoverFromBackups, rotateBackups } from "./board-backups.js";
import { reconcile } from "./mapping.js";

const BOARD_DIR = path.join(os.homedir(), ".dispatch");
export const BOARD_PATH = path.join(BOARD_DIR, "board.json");

/**
 * Locked To Do ordering (CONTEXT.md -> Data & Sync Semantics):
 * Linear priority urgent->low, with 1 urgent .. 4 low ascending and 0 (none) LAST
 * (priority 0 is treated as +Infinity per RESEARCH assumption A2), tie-broken by
 * updatedAt DESCENDING (most-recently-updated first). Pure — the single authoritative
 * place the To Do order is expressed. Invoked by snapshot() on the read path.
 */
export function compareTodoOrder(a: Card, b: Card): number {
  const pa = a.priority === 0 ? Number.POSITIVE_INFINITY : a.priority;
  const pb = b.priority === 0 ? Number.POSITIVE_INFINITY : b.priority;
  if (pa !== pb) return pa - pb;
  return b.updatedAt.localeCompare(a.updatedAt);
}

class BoardStore extends EventEmitter {
  /** The sole mutable truth. */
  private readonly cards = new Map<string, Card>();
  /** Freshness marker for the last successful Linear sync; null until first sync. */
  private syncedAt: string | null = null;
  /** Non-fatal sync problem from the last poll cycle (e.g. truncated pull); null when healthy. */
  private syncWarning: string | null = null;
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
  /** Serializes every mutation so mutate -> persist -> emit runs to completion before the next. */
  private queue: Promise<void> = Promise.resolve();
  /**
   * Card ids with a start saga currently in flight (CR-01). Transient, in-memory, NOT persisted:
   * no saga survives a restart, so this set is intentionally empty after load(). It is the
   * double-start guard AND the signal reconcile() uses to refuse removing an actively-provisioning
   * To Do card whose Linear issue vanished mid-saga (which would orphan a live session).
   */
  private readonly inFlightStarts = new Set<string>();
  /**
   * Bootstrap-injected releaser for cleared hook tokens. The boundaries DAG forbids
   * store → services, so bootstrap wires services/hook-tokens.ts' unregister function in here
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
   */
  private clearHookToken(card: Card): void {
    if (card.hookToken) this.releaseHookToken(card.hookToken, card.id);
    card.hookToken = undefined;
    card.hookRoutedAt = undefined;
  }

  /**
   * Enqueue a mutation. The chained promise guarantees single-writer ordering.
   * The in-memory Map is the source of truth: the broadcast (step 4) MUST fire even
   * when the persist (step 3) fails, or SSE clients silently diverge from the state
   * that GET /api/board already reports. A failed persist is logged (the log prints
   * only the write error, never snapshot contents — board.json carries per-session
   * hook tokens) and simply retried by the next mutation's write. The persist writes
   * the FULL snapshot; the broadcast emits the REDACTED wire snapshot (snapshot()),
   * so secrets reach disk but never an SSE frame. Errors are caught inside the chain
   * so one failed step can never break the queue for subsequent mutations. Before the
   * primary write, an hourly best-effort rolling backup of the last-known-good on-disk
   * board.json is rotated (rotateBackups is itself never-throw, so it can never block or
   * delay the write or the broadcast).
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  private enqueue(mutator: () => void): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        mutator();
        await rotateBackups(BOARD_PATH);
        try {
          await writeFileAtomic(
            BOARD_PATH,
            JSON.stringify(this.persistSnapshot(), null, 2),
          );
        } catch (err) {
          console.error(
            "[store] persist failed (in-memory state still broadcast):",
            err,
          );
        }
        this.emit("change", this.snapshot());
      })
      .catch((err: unknown) => {
        console.error("[store] mutation failed:", err);
      });
    return this.queue;
  }

  /**
   * Load board.json into the Map. A missing file (ENOENT) starts a fresh empty board — the
   * backup chain is deliberately NOT walked. Any other read error, or an unparseable primary,
   * walks the rolling backup chain and recovers the most recent valid snapshot; only when the
   * primary and every backup fail does the board start empty (always with a warning, never
   * silently). Never throws, so a bad file can't block startup.
   * @remarks A corrupt primary is renamed to `board.json.corrupt` before recovery and, per the
   * locked no-boot-writeback decision, no fresh board.json is written until the next mutation.
   * A second crash inside that window would see board.json absent (ENOENT) and start fresh; the
   * ~60s poller closes it by persisting the recovered state, and the `.bak.*` / `.corrupt` files
   * survive on disk for manual recovery (accepted residual, see RESEARCH.md Pitfall 5).
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(BOARD_PATH, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(
          `[store] no board.json at ${BOARD_PATH} — starting with an empty board.`,
        );
        return;
      }
      await this.recoverOrEmpty();
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BoardSnapshot>;
      this.hydrateFromParsed(parsed);
      console.log(
        `[store] loaded ${this.cards.size} card(s) from ${BOARD_PATH}.`,
      );
    } catch (err) {
      console.warn(
        `[store] board.json at ${BOARD_PATH} is unparseable — walking the backup chain:`,
        (err as Error).message,
      );
      try {
        await fs.promises.rename(BOARD_PATH, `${BOARD_PATH}.corrupt`);
      } catch {}
      await this.recoverOrEmpty();
    }
  }

  /**
   * Walk the rolling backup chain and hydrate from the first valid snapshot, or clear to an empty
   * board (with a warning — never silent) when the primary and all backups are unparseable.
   * recoverFromBackups already logged the file-named recovery warning on success.
   */
  private async recoverOrEmpty(): Promise<void> {
    const recovered = await recoverFromBackups(BOARD_PATH);
    if (recovered) {
      this.hydrateFromParsed(recovered);
      return;
    }
    console.warn(
      `[store] board.json at ${BOARD_PATH} and all backups were unreadable/unparseable — starting with an empty board.`,
    );
    this.cards.clear();
    this.syncedAt = null;
    this.workspaceFolders = [];
    this.lastUsedFolder = null;
  }

  /**
   * Apply a parsed snapshot to the in-memory Map, shared by the healthy-load and backup-recovery
   * paths so a recovered board hydrates byte-for-byte identically to a healthy one: rebuild the
   * cards Map, rewrite any interrupted in-flight provisioning into a retryable startError, reset
   * the transient ttydPort/terminalError, and default syncedAt / workspaceFolders / lastUsed.
   */
  private hydrateFromParsed(parsed: Partial<BoardSnapshot>): void {
    const loaded = Array.isArray(parsed.cards) ? parsed.cards : [];
    this.cards.clear();
    for (const card of loaded) {
      if (card && typeof card.id === "string") {
        if (card.provisioningStep != null) {
          card.startError = {
            step: "interrupted",
            stderr:
              "The server restarted while this start was still provisioning. Any partially-created worktrees or session were left in place — Retry to reconcile and continue.",
            variant: "generic",
          };
          card.provisioningStep = null;
        }
        card.ttydPort = undefined;
        card.terminalError = null;
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
    });
  }

  /**
   * Persist the start intent (playbook name + target column) captured at Start, BEFORE the saga
   * runs (the setExtraDirection precedent), so Retry after a failed start and a bare Restart can
   * reproduce the original planning start instead of silently degrading to a playbook-less
   * implementation session. No-op if the id is unknown.
   */
  setStartIntent(
    id: string,
    intent: {
      playbook?: string;
      targetColumn?: "in_planning" | "in_progress";
    },
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) card.startIntent = intent;
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
    });
  }

  /**
   * Remember the folder of a SUCCESSFUL start so the modal preselects it next time. Called only on
   * a completed start, not on mere selection, so an abandoned modal never changes the default.
   */
  setLastUsedFolder(path: string): Promise<void> {
    return this.enqueue(() => {
      this.lastUsedFolder = path;
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
      if (card) {
        card.startError = e;
        card.provisioningStep = null;
      }
    });
  }

  /**
   * Idempotent reattach to a live `dsp-<id>` session ("already running"): copy the session
   * fields, promote the card to its target column, surface a transient reattach status, and clear
   * any provisioning step / start error. No-op if the id is unknown.
   *
   * `opts` uses the same asymmetric defaulting as completeStart: `column` defaults to "in_progress"
   * when omitted; `mode` is assigned only when provided so reattaching a live planning session never
   * yanks it to In Progress nor wipes its mode. `startIntent.targetColumn` is consumed here exactly
   * as in completeStart — a landed session makes `mode` authoritative, so a stale target can never
   * drag a later bare Restart back to a column the card has since left.
   */
  attachExistingSession(
    id: string,
    s: SessionFields,
    opts?: { column?: Column; mode?: "planning" | "implementation" },
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.workspacePath = s.workspacePath;
        card.branch = s.branch;
        card.tmuxSession = s.tmuxSession;
        card.ttydPort = s.ttydPort;
        card.column = opts?.column ?? "in_progress";
        if (opts?.mode !== undefined) card.mode = opts.mode;
        if (card.startIntent?.targetColumn !== undefined) {
          card.startIntent = { playbook: card.startIntent.playbook };
        }
        card.statusReason = "Already running — reattached";
        card.provisioningStep = null;
        card.startError = null;
        card.sessionLost = false;
        card.resumeError = null;
      }
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
      if (card) {
        card.sessionLost = true;
        card.tmuxSession = undefined;
        card.ttydPort = undefined;
        card.terminalError = null;
        this.clearHookToken(card);
      }
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
   *
   * A DONE marker on a planning-mode card does NOT move it: the plan is complete in place, so the
   * card keeps its In Planning column and gains `planReady` (the badge + handoff affordance) rather
   * than sliding into Agent Done. NEEDS_INPUT stays identical for both modes (shared column).
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
      if (!c || c.column === "todo" || c.column === "done") return;
      if (column === "agent_done" && c.mode === "planning") {
        c.planReady = true;
        c.statusReason = statusReason;
        c.lastMarker = markerKey;
        return;
      }
      c.column = column;
      c.statusReason = statusReason;
      c.lastMarker = markerKey;
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
    });
  }

  /**
   * Flip a Needs-Input card back to its working column once the agent responds (Phase 4, MARK-03):
   * clear statusReason in ONE atomic mutation. The target is mode-aware — a planning-mode card
   * returns to In Planning, everything else to In Progress — so the shared Needs Input column routes
   * each card home. `lastMarker` is left
   * UNTOUCHED so the still-visible NEEDS_INPUT marker line cannot re-fire on the next tick (the
   * watcher dedups on `lastMarker`). No-op if the id is unknown.
   *
   * The column check lives INSIDE the mutator (the applyIssues precedent): the watcher's read of
   * `column === "needs_input"` happens outside the queue, so a manual drag can already be queued
   * ahead of this flip. Re-checking against the live Map here makes the flip a no-op unless the
   * card is STILL in Needs Input — a queued drag (e.g. to Done) can never be silently reverted.
   */
  flipBack(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (c && c.column === "needs_input") {
        c.column = c.mode === "planning" ? "in_planning" : "in_progress";
        c.statusReason = undefined;
      }
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
   * overrode. Replaces the plain moveCard on the drag route. No-op if the id is unknown.
   */
  moveCardManual(id: string, column: Column): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (c) {
        c.column = column;
        if (column !== "needs_input" && column !== "agent_done") {
          c.statusReason = undefined;
        }
      }
    });
  }

  /**
   * Successful start: copy the session fields, promote the card to its target column, and clear
   * the provisioning step, start error, start warning, and the session-lost flag (so a restart
   * returns the card to its normal running appearance). No-op if the id is unknown.
   *
   * The `opts` defaulting is deliberately ASYMMETRIC. `column` defaults to "in_progress" when
   * omitted, so the existing start caller lands cards exactly as before. `mode` is assigned ONLY
   * when explicitly provided — an omitted `mode` preserves whatever the card already carries, so a
   * planning restart keeps its planning identity instead of being silently downgraded. `planReady`
   * is always cleared: a fresh or re-provisioned session has no stale Plan-ready badge to show.
   * `startIntent.targetColumn` is consumed here — once the session lands, `mode` is authoritative
   * and only the playbook name survives for a later restart to re-resolve from disk.
   */
  completeStart(
    id: string,
    s: SessionFields,
    opts?: { column?: Column; mode?: "planning" | "implementation" },
  ): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.workspacePath = s.workspacePath;
        card.branch = s.branch;
        card.tmuxSession = s.tmuxSession;
        card.ttydPort = s.ttydPort;
        card.column = opts?.column ?? "in_progress";
        if (opts?.mode !== undefined) card.mode = opts.mode;
        if (card.startIntent?.targetColumn !== undefined) {
          card.startIntent = { playbook: card.startIntent.playbook };
        }
        card.planReady = undefined;
        card.provisioningStep = null;
        card.startError = null;
        card.startWarning = null;
        card.sessionLost = false;
        card.resumeError = null;
      }
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
      if (card) {
        card.tmuxSession = session;
        card.sessionLost = false;
        card.terminalError = null;
        card.ttydPort = undefined;
        card.resumeError = null;
        card.statusReason = "Resumed — reattached";
      }
    });
  }

  /**
   * Hand a completed plan off to implementation in ONE atomic mutation: move the card to In
   * Progress, flip `mode` to "implementation", drop the Plan-ready badge, and clear the planning
   * status reason. Called after the live-session follow-up paste succeeds, so the same conversation
   * continues building — no re-provisioning. No-op if the id is unknown.
   */
  handoffToImplementation(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.column = "in_progress";
        card.mode = "implementation";
        card.planReady = undefined;
        card.statusReason = undefined;
      }
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
      if (card) {
        card.sessionLost = true;
        card.tmuxSession = undefined;
        card.ttydPort = undefined;
        card.terminalError = null;
        this.clearHookToken(card);
        card.resumeError =
          "Resume failed — the worktree may be gone. Use Restart to begin a fresh session in the same branch.";
      }
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
   * `hookToken` is cleared AND unregistered with the session fields (clearHookToken). Column
   * untouched. No-op if the id is unknown.
   */
  recordCleanupWarning(id: string, warning: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupWarning = warning;
        card.tmuxSession = undefined;
        card.ttydPort = undefined;
        card.terminalError = null;
        this.clearHookToken(card);
      }
    });
  }

  /**
   * Successful Done-cleanup quiet-state clear (LIFE-01) in ONE atomic mutation (markSessionLost /
   * completeStart precedent — a split write would broadcast a torn frame). Clears the session
   * fields the teardown removed AND neutralizes any lingering/racing error chrome so the cleaned
   * Done card reads quietly: `tmuxSession`/`ttydPort`/`workspacePath`/`cleanupWarning`/`hookToken`
   * undefined (the token also unregistered via clearHookToken), `sessionLost` false,
   * `terminalError` null. KEEPS `branch` (branches always survive per lock), `outputChangedAt`,
   * and `lastMarker`. No-op if the id is unknown.
   */
  finishCleanup(id: string): Promise<void> {
    return this.enqueue(() => {
      const c = this.cards.get(id);
      if (c) {
        c.tmuxSession = undefined;
        c.ttydPort = undefined;
        c.workspacePath = undefined;
        c.sessionLost = false;
        c.terminalError = null;
        c.cleanupWarning = undefined;
        this.clearHookToken(c);
      }
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
      for (const card of r.upserts) {
        const existing = this.cards.get(card.id);
        if (existing && (existing.source ?? "linear") !== src) {
          console.warn(
            `[store] skipped upsert of ${card.id} from source ${src} — id already owned by source ${existing.source ?? "linear"}.`,
          );
          continue;
        }
        this.cards.set(card.id, card);
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
    });
  }
}

/** The single shared store instance every producer/consumer imports. */
export const store = new BoardStore();
