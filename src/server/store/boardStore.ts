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
  StartError,
  TerminalError,
} from "../../shared/types.js";
import { reconcile, type LinearIssue } from "./mapping.js";

const BOARD_DIR = path.join(os.homedir(), ".agent-kanban");
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
   * Enqueue a mutation. The chained promise guarantees single-writer ordering.
   * The in-memory Map is the source of truth: the broadcast (step 4) MUST fire even
   * when the persist (step 3) fails, or SSE clients silently diverge from the state
   * that GET /api/board already reports. A failed persist is logged (the error never
   * contains the API key — board.json carries no secrets) and simply retried by the
   * next mutation's write. Errors are caught inside the chain so one failed step can
   * never break the queue for subsequent mutations.
   * @see docs/ARCHITECTURE.md#single-writer-store
   */
  private enqueue(mutator: () => void): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        mutator();
        const snap = this.snapshot();
        try {
          await writeFileAtomic(BOARD_PATH, JSON.stringify(snap, null, 2));
        } catch (err) {
          console.error(
            "[store] persist failed (in-memory state still broadcast):",
            err,
          );
        }
        this.emit("change", snap);
      })
      .catch((err: unknown) => {
        console.error("[store] mutation failed:", err);
      });
    return this.queue;
  }

  /**
   * Load board.json into the Map if present. Tolerates a missing or corrupt file by
   * starting empty (and warning) — never throws, so a bad file can't block startup.
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(BOARD_PATH, "utf8");
    } catch {
      console.log(
        `[store] no board.json at ${BOARD_PATH} — starting with an empty board.`,
      );
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BoardSnapshot>;
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
      console.log(
        `[store] loaded ${this.cards.size} card(s) from ${BOARD_PATH}.`,
      );
    } catch (err) {
      console.warn(
        `[store] board.json at ${BOARD_PATH} is unparseable — starting empty:`,
        (err as Error).message,
      );
      this.cards.clear();
      this.syncedAt = null;
    }
  }

  /**
   * Build the canonical board snapshot. The To Do cards are sorted with compareTodoOrder
   * on this read path; other columns carry no Phase-1 ordering decision (the frontend
   * re-partitions by `column`, so cross-column concat order is irrelevant).
   */
  snapshot(): BoardSnapshot {
    const all = [...this.cards.values()];
    const todo = all.filter((c) => c.column === "todo").sort(compareTodoOrder);
    const rest = all.filter((c) => c.column !== "todo");
    return {
      cards: [...todo, ...rest],
      syncedAt: this.syncedAt,
      syncWarning: this.syncWarning,
      pollIntervalMs: this.pollIntervalMs ?? undefined,
      editors: this.editors,
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
   * Idempotent reattach to a live `ak-<id>` session ("already running"): copy the session
   * fields, promote the card to "in_progress", surface a transient reattach status, and clear
   * any provisioning step / start error. No-op if the id is unknown.
   */
  attachExistingSession(id: string, s: SessionFields): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.workspacePath = s.workspacePath;
        card.branch = s.branch;
        card.tmuxSession = s.tmuxSession;
        card.ttydPort = s.ttydPort;
        card.column = "in_progress";
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
   * (Pitfall 5); the session name stays derivable as `ak-` + identifier for restart. Called at
   * BOTH boot (reconcileSessions) and RUNTIME (Plan 02's watcher dead-session detector, per tick).
   * No-op if the id is unknown. SECURITY: never logs card contents.
   */
  markSessionLost(id: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.sessionLost = true;
        card.tmuxSession = undefined;
        card.ttydPort = undefined;
        card.terminalError = null;
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
   * Apply a parsed AK_STATUS marker (Phase 4, MARK-01/02) in ONE atomic mutation: set the target
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
      if (!c || c.column === "todo" || c.column === "done") return;
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
   * Flip a Needs-Input card back to In Progress once the agent responds (Phase 4, MARK-03): set
   * column="in_progress" and clear statusReason in ONE atomic mutation. `lastMarker` is left
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
        c.column = "in_progress";
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
   * Successful start: copy the session fields, promote the card to "in_progress", and clear
   * the provisioning step, start error, start warning, and the session-lost flag (so a restart
   * returns the card to its normal running appearance). No-op if the id is unknown.
   */
  completeStart(id: string, s: SessionFields): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.workspacePath = s.workspacePath;
        card.branch = s.branch;
        card.tmuxSession = s.tmuxSession;
        card.ttydPort = s.ttydPort;
        card.column = "in_progress";
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
   * stderr or pane text can leak (SECURITY, matches setStartError). No-op if the id is unknown.
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
   * Column untouched. No-op if the id is unknown.
   */
  recordCleanupWarning(id: string, warning: string): Promise<void> {
    return this.enqueue(() => {
      const card = this.cards.get(id);
      if (card) {
        card.cleanupWarning = warning;
        card.tmuxSession = undefined;
        card.ttydPort = undefined;
        card.terminalError = null;
      }
    });
  }

  /**
   * Successful Done-cleanup quiet-state clear (LIFE-01) in ONE atomic mutation (markSessionLost /
   * completeStart precedent — a split write would broadcast a torn frame). Clears the session
   * fields the teardown removed AND neutralizes any lingering/racing error chrome so the cleaned
   * Done card reads quietly: `tmuxSession`/`ttydPort`/`workspacePath`/`cleanupWarning` undefined,
   * `sessionLost` false, `terminalError` null. KEEPS `branch` (branches always survive per lock),
   * `outputChangedAt`, and `lastMarker`. No-op if the id is unknown.
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
   */
  applyIssues(
    issues: LinearIssue[],
    syncedAt: string,
    opts: { partial?: boolean } = {},
  ): Promise<void> {
    return this.enqueue(() => {
      const current = new Map(
        [...this.cards.values()].map((c) => [c.issueId, c] as const),
      );
      const r = reconcile(issues, current, this.inFlightStarts);
      for (const card of r.upserts) this.cards.set(card.id, card);
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
