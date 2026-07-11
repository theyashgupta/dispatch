/** Board columns in display order. */
export type Column =
  | "todo"
  | "in_planning"
  | "in_progress"
  | "needs_input"
  | "agent_done"
  | "in_review"
  | "done";

/** The seven columns in board order, for the frontend to iterate. */
export const COLUMNS: readonly Column[] = [
  "todo",
  "in_planning",
  "in_progress",
  "needs_input",
  "agent_done",
  "in_review",
  "done",
] as const;

export interface Card {
  /** Internal card id (can equal issueId in Phase 1). */
  id: string;
  /** Linear issue id — the upsert key for the poller. */
  issueId: string;
  /** Human-readable Linear identifier, e.g. "PROP-123". */
  identifier: string;
  title: string;
  description: string | null;
  /** Linear issue permalink; optional so pre-Phase-7 cards backfill on the next poll. */
  url?: string;
  /** Linear priority integer: 0 none, 1 urgent, 2 high, 3 normal, 4 low. */
  priority: number;
  column: Column;
  /** ISO timestamp; secondary sort key. */
  updatedAt: string;
  /** Set when the issue disappeared from Linear while the card was past To Do. */
  goneFromLinear?: boolean;

  /** Per-ticket workspace folder containing the git worktrees. */
  workspacePath?: string;
  /** Chosen workspace snapshot at start — absolute repo paths so resume/restart/cleanup never re-read the folder registry. */
  workspace?: { folder: string; repos: { path: string; base: string }[] };
  /** Branch name used for the ticket's worktrees. */
  branch?: string;
  /** tmux session name hosting the claude REPL. */
  tmuxSession?: string;
  /**
   * Per-session hook-auth secret minted at launch/resume. Persisted (not memory-only) because
   * sessions deliberately survive backend restarts — a tsx-watch reload rebuilds the in-memory
   * token registry from this field, so live sessions' hook POSTs keep authenticating. At rest it
   * is protected by `~/.dispatch` mode 700; cleared (and unregistered) whenever the session
   * fields are cleared. NEVER serialized to the wire — the store's snapshot() redacts it from
   * SSE frames and REST reads; only the persisted board.json carries it.
   */
  hookToken?: string;
  /**
   * ISO timestamp of the session's first authenticated hook event — the per-session latch that
   * routes status to the hooks channel under `statusChannel: "auto"`. NON-SECRET by explicit
   * decision: rides `snapshot()` unredacted (unlike `hookToken`). Cleared with the session fields
   * via the store's `clearHookToken` chokepoint, so a relaunch/resume starts hook-silent and
   * re-proves traffic.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  hookRoutedAt?: string;
  /**
   * The Claude CLI session id captured first-event-wins from the v1.8 hook payload (`session_id`).
   * Drives exact Resume: `claude --resume <id>` reconnects to this exact conversation instead of
   * `--continue` (which can pick up an unrelated manual claude session started in the same
   * worktree). NON-SECRET by explicit decision: rides `snapshot()` UNREDACTED (like `hookRoutedAt`,
   * unlike `hookToken`). Its lifecycle deliberately does NOT follow the `clearHookToken`
   * chokepoint — markSessionLost KEEPS it (the on-disk transcript outlives a dead tmux session),
   * completeStart RESETS it (a fresh kickoff is a new conversation), Done cleanup CLEARS it.
   * @see docs/ARCHITECTURE.md#hooks-status-channel
   */
  claudeSessionId?: string;
  /** Port of the per-session ttyd instance. */
  ttydPort?: number;
  /**
   * Set when the card's `dsp-<identifier>` tmux session is gone — by boot reconcile (session
   * absent from the live `list-sessions` set after a reboot) AND by the Plan-02 watcher's
   * runtime dead-session detector (3 consecutive failed captures). Cleared by completeStart on
   * a successful restart. Drives the "Session lost" card line + Restart affordance.
   */
  sessionLost?: boolean;

  /**
   * Normalized dedup key of the last consumed DISPATCH_STATUS marker (`kind + " " + reason`) —
   * layout-independent so a repaint/rewrap never re-fires. Cleared by the watcher once the
   * marker text leaves the pane and the card is out of the attention columns, so a genuinely
   * re-printed identical marker fires again.
   */
  lastMarker?: string;
  /** Human-readable status: the marker reason/summary, a reattach note, or absent when cleared. */
  statusReason?: string;

  /** Current provisioning step text while a start saga runs, e.g. "Creating worktrees…". */
  provisioningStep?: string | null;
  /** Structured start failure; card stays in To Do and renders an error state + Retry. */
  startError?: StartError | null;
  /** Non-fatal start warning surfaced on the card, e.g. the fetch-fallback notice. */
  startWarning?: string | null;
  /** ISO timestamp of the last observed ⏺-view divergence for a live session (ATTN-02 unseen-activity dot). */
  outputChangedAt?: string;
  /** Non-fatal Done-cleanup failure surfaced like startWarning; absent in the quiet/success state (LIFE-01). */
  cleanupWarning?: string;
  /** Optional extra direction text captured at Start; reused by Retry and the Phase-3 detail panel. */
  extraDirection?: string | null;
  /** Structured ttyd (terminal) failure surfaced in the detail panel; null/absent when the terminal is healthy. */
  terminalError?: TerminalError | null;
  /** Fixed resume-failure copy rendered by the session-lost UI; null/absent when no resume has failed. */
  resumeError?: string | null;

  /**
   * Session methodology stage. Absent is treated as `implementation` everywhere in routing (locked
   * rule) so existing cards need no migration; set at session start and flipped to `implementation`
   * on the In Planning → In Progress handoff.
   */
  mode?: "planning" | "implementation";
  /**
   * Originating ticket source (a registered TicketSource.id — "linear" is the only value today).
   * Typed as string, not a literal union, because reconcile stamps whatever source id it is handed;
   * narrowing here would just hide that behind a cast. Absent is treated as `"linear"` everywhere
   * (the reconcile scoping filter, the CardView marker) so existing board.json cards need no
   * migration write.
   */
  source?: string;
  /**
   * A planning session emitted DONE and is ready to hand off. Survives Needs Input round-trips (the
   * flag is not touched by marker routing), and is cleared on the implementation handoff and on any
   * restart/re-provision so a stale badge never outlives its plan.
   */
  planReady?: boolean;
  /**
   * The playbook name and target column captured when a start request carries them, persisted
   * BEFORE the saga runs (the extraDirection precedent) so Retry after a failed start and a bare
   * Restart reproduce the original start — playbook body and planning target included — instead of
   * degrading to a playbook-less implementation start. `targetColumn` is consumed once a session
   * lands (completeStart/attachExistingSession — `mode` becomes authoritative); the playbook name
   * survives so a later restart re-resolves the body from disk.
   */
  startIntent?: {
    playbook?: string;
    targetColumn?: "in_planning" | "in_progress";
  };
}

/**
 * A ttyd (terminal) failure surfaced in the detail panel. Drives the terminal
 * region's error state + Reconnect affordance.
 */
export interface TerminalError {
  /** "spawn" = ttyd failed to start / readiness timed out; "died" = process exited while tracked. */
  variant: "spawn" | "died";
  /** ttyd stderr / diagnostic shown in the panel's mono block. Never contains secrets. */
  stderr?: string;
}

/**
 * A structured failure from the start saga. Drives the card error heading
 * "Start failed — <step>" and the DetailPanel's full-stderr view.
 */
export interface StartError {
  /** The failed saga step name, e.g. "creating worktrees" — drives the card heading. */
  step: string;
  /** FULL underlying git/tmux stderr (or last-captured pane text); the Card clamps to ~3 lines client-side, the DetailPanel shows all. Never contains secrets. */
  stderr: string;
  /** Selects the UI-SPEC copy variant for the error. */
  variant?: "config" | "branch-conflict" | "repl-timeout" | "generic";
}

/**
 * Session record payload shared by completeStart and attachExistingSession.
 * ttydPort stays absent/null until Phase 3.
 */
export interface SessionFields {
  /** Per-ticket workspace folder containing the git worktrees. */
  workspacePath: string;
  /** Branch name used for the ticket's worktrees. */
  branch: string;
  /** tmux session name hosting the claude REPL. */
  tmuxSession: string;
  /** Port of the per-session ttyd instance (Phase 3). */
  ttydPort?: number;
}

/**
 * Full board state. This exact shape is both the SSE payload and the
 * persisted contents of ~/.dispatch/board.json — but wire copies (SSE frames
 * and REST reads) are redacted at the store's snapshot() chokepoint:
 * `card.hookToken` never leaves the server; only the persisted file carries it.
 */
export interface BoardSnapshot {
  cards: Card[];
  syncedAt: string | null;
  /** Non-fatal sync problem from the last poll cycle (e.g. truncated pull); null when healthy. */
  syncWarning?: string | null;
  /**
   * Static poll interval (ms) from config, broadcast so the client can compute sync staleness
   * (`now - syncedAt > 2×pollIntervalMs`). A FLAT field — not a `meta` envelope; `syncedAt`
   * already carries lastSyncAt. Non-secret; never carries the Linear key.
   */
  pollIntervalMs?: number;
  /** Editor availability flags — booleans only, checked once at boot; absolute paths stay backend-only. */
  editors?: { code: boolean; cursor: boolean };
  /** Registered workspace-folder paths, broadcast so the start modal has a live, fast read. */
  workspaceFolders?: string[];
  /** Folder used on the last successful start, preselected in the modal; null when none yet. */
  lastUsed?: string | null;
}

/**
 * A git repo surfaced by folder discovery: its absolute path, display name, and
 * detected base branch. The shape the discover/add workspace endpoints return.
 */
export interface DiscoveredRepo {
  path: string;
  name: string;
  base: string;
}

/**
 * A methodology playbook surfaced by the loader/picker: its display `name`, the `stage` it applies
 * to, and its markdown `body` spliced into the kickoff. Selected by `name`, never a client path.
 */
export interface Playbook {
  name: string;
  stage: "planning" | "implementation";
  body: string;
}

/**
 * Which channel drives card status: `hooks` (hook events only), `pane` (today's pane scraping
 * only), or `auto` (prefer hooks per session, fall back to pane scanning for hook-silent
 * sessions). Boot-static — changing it requires a backend restart.
 */
export type StatusChannel = "hooks" | "pane" | "auto";

/** Contents of ~/.dispatch/config.json. */
export interface Config {
  linearApiKey: string;
  port?: number;
  pollIntervalMs?: number;
  repoPaths?: string[];
  baseBranches?: string[];
  workspaceRoot?: string;
  /** Status-source selection (`hooks | pane | auto`); absent resolves to `auto` at load. */
  statusChannel?: StatusChannel;
  /** Writable-config groundwork (Phase 23): nested per-source credentials plus the live filter block. `linearApiKey` stays the resolved read. */
  sources?: { linear?: { apiKey: string; filters?: SourceFilters } };
}

/**
 * The runtime-mutable filter selection for a source. An empty array (or `currentCycle: false`) means
 * the dimension is UNCONSTRAINED — the query-builder omits it entirely rather than sending a
 * match-nothing `in: []`. The default (all empty) reproduces the assigned-to-me / unstarted pull
 * byte-for-byte (FILT-05).
 */
export interface SourceFilters {
  assignees: string[];
  projects: string[];
  teams: string[];
  currentCycle: boolean;
}

/**
 * The assigned-to-me default injected when a config carries no `filters` block. Every dimension is
 * empty so the builder emits today's exact `viewer.assignedIssues` / `state.type=unstarted` query
 * (FILT-05); consumed by the config loader and the registry live-filters accessor.
 */
export const DEFAULT_FILTERS: SourceFilters = {
  assignees: [],
  projects: [],
  teams: [],
  currentCycle: false,
};

/**
 * A filter dimension a source can constrain on. `cycle` is a boolean toggle (no option list); the
 * rest are multi-select id lists. Shared so the settings UI renders only what a source declares in
 * its capability descriptor (SRC-06) without reaching across the server boundary for the type.
 */
export type FilterDimension = "assignees" | "projects" | "teams" | "cycle";

/** One selectable option for a multi-select dimension: the upstream id plus its human label. */
export interface FilterOption {
  id: string;
  label: string;
}

/**
 * A source's static filter surface — the dimensions it supports. The settings UI iterates this to
 * decide which controls to render, so a source never advertises a dimension it cannot query.
 */
export interface FilterCapabilities {
  dimensions: FilterDimension[];
}

/**
 * The subset of a source-issue the poller maps onto a card. `description` is nullable (issues can
 * have none); `priority` is the raw Linear integer (RESEARCH assumption A2: 1 urgent .. 4 low,
 * 0 none — verify on first real pull); `updatedAt` is an ISO string used as the To Do tiebreaker.
 */
export interface SourceIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string | null;
  priority: number;
  updatedAt: string;
}

/** Result of reconciling a Linear poll against the current board. */
export interface ReconcileResult {
  /** Cards to create or update in place. */
  upserts: Card[];
  /** Card ids to remove (issue gone while still in To Do). */
  removeIds: string[];
  /** Card ids to flag goneFromLinear (issue gone, card past To Do). */
  goneIds: string[];
  /** Card ids to CLEAR goneFromLinear on (issue reappeared while the card was past To Do). */
  reappearedIds: string[];
}
