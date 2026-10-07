import type { EventEmitter } from "node:events";
import type { CardSearchResult } from "../../shared/search.js";
import type {
  AccountEventType,
  ActivityEvent,
  ArchiveBoardResult,
  ArchivedGroup,
  Board,
  BoardKey,
  BoardPatch,
  BoardScope,
  BoardSnapshot,
  Card,
  Column,
  ColumnChange,
  CreateBoardResult,
  EventType,
  Item,
  NewBoard,
  LoopProgress,
  OrchestrationEvent,
  PreviewInfo,
  PrInfo,
  ProbeUnknown,
  Session,
  SessionFields,
  SessionMeters,
  SettableItemState,
  SourceCursor,
  SourceIssue,
  SourceKind,
  StartError,
  TerminalError,
  TrackedRefresh,
  UnwindDestination,
  WorkflowState,
} from "../../shared/types.js";
import type { PushSubscriptionRow } from "./board-db.js";
import { store, type ReservedSession } from "./board.store.js";

export {
  BoardUnavailableError,
  redactArchivedGroup,
  redactCard,
  type ReservedSession,
} from "./board.store.js";

export interface BoardRepository {
  on: EventEmitter["on"];
  setHookTokenReleaser(
    release: (
      token: string,
      cardId: string,
      sessionId: string | undefined,
    ) => void,
  ): void;
  load(): Promise<void>;
  snapshot(board: BoardKey, opts?: { doneLimit?: number }): BoardSnapshot;
  wireItems(): Item[];
  setPollInterval(ms: number): void;
  setCleanupDelayDays(days: number): void;
  setArchiveRetentionDays(days: number): void;
  getArchiveRetentionDays(): number;
  setEditors(e: { code: boolean; cursor: boolean }): void;
  getSourceCursors(sourceId: string): Record<string, SourceCursor>;
  setSourceCursors(
    sourceId: string,
    cursors: Record<string, SourceCursor>,
  ): Promise<void>;
  setEnabledSources(ids: string[]): void;
  setSyncUnreachable(flag: boolean): Promise<void>;
  trackedIssueIds(
    scope: BoardScope,
    sourceId: string,
    returnedIds: ReadonlySet<string>,
    limit?: number,
  ): string[];
  getCard(id: string): Card | undefined;
  membersOf(groupId: string): Card[];
  getWorkspaceFolders(board: BoardKey): {
    folders: string[];
    lastUsed: string | null;
  };
  searchCards(
    board: BoardKey,
    query: string,
    limit: number,
  ): { results: CardSearchResult[]; total: number };
  listEvents(
    board: BoardKey,
    cardId: string | null,
    limit: number,
  ): ActivityEvent[];
  setLoopProgress(cardId: string, progress: LoopProgress): Promise<void>;
  appendOrchestrationEvent(
    e: Omit<OrchestrationEvent, "id">,
  ): OrchestrationEvent;
  listOrchestrationEvents(
    board: BoardKey,
    sinceId: number,
    limit: number,
  ): OrchestrationEvent[];
  addPushSubscription(sub: PushSubscriptionRow): boolean;
  removePushSubscription(endpoint: string): boolean;
  listPushSubscriptions(): PushSubscriptionRow[];
  setPushing(id: string, pushing: boolean): void;
  isStarting(id: string): boolean;
  beginStart(id: string): void;
  endStart(id: string): void;
  isCleaningUp(id: string): boolean;
  beginCleanup(id: string): void;
  endCleanup(id: string): void;
  isSyncing(id: string): boolean;
  beginSync(id: string): void;
  endSync(id: string): void;
  setProvisioning(id: string, step: string): Promise<void>;
  setExtraDirection(id: string, text: string): Promise<void>;
  setStartIntent(id: string, intent: { playbook?: string }): Promise<void>;
  addWorkspaceFolder(board: BoardKey, path: string): Promise<void>;
  removeWorkspaceFolder(board: BoardKey, path: string): Promise<void>;
  setLastUsedFolder(board: BoardKey, path: string): Promise<void>;
  setCardWorkspace(
    id: string,
    workspace: { folder: string; repos: { path: string; base: string }[] },
  ): Promise<void>;
  setStatusReason(id: string, reason: string | null): Promise<void>;
  setSyncing(id: string, syncing: boolean): Promise<void>;
  mintHookChannel(
    id: string,
    token: string,
    sessionId?: string,
  ): Promise<string | undefined>;
  setClaudeSessionId(
    id: string,
    sessionId: string | undefined,
    sid: string,
  ): Promise<void>;
  markClaudeSessionMissing(
    id: string,
    sessionId: string | undefined,
    sid: string,
  ): Promise<void>;
  setSessionAccount(
    id: string,
    sessionId: string,
    accountId: string,
  ): Promise<void>;
  markAccountStale(id: string, sessionId: string): Promise<void>;
  setPendingAccount(
    id: string,
    sessionId: string,
    accountId: string | undefined,
  ): Promise<void>;
  clearPendingAccountsFor(accountId: string): Promise<void>;
  clearPendingAccountsExcept(accountId: string): Promise<void>;
  setOutputChanged(id: string, iso: string): Promise<void>;
  setPrsIfSession(id: string, session: string, prs: PrInfo[]): Promise<void>;
  setSessionMetersIfSession(
    id: string,
    session: string,
    meters: SessionMeters,
  ): Promise<boolean>;
  setPreviewsIfSession(
    id: string,
    session: string,
    previews: PreviewInfo[],
  ): Promise<void>;
  setPrsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void>;
  setPreviewsUnknownIfSession(
    id: string,
    session: string,
    unknown: ProbeUnknown | null,
  ): Promise<void>;
  markHookRouted(
    id: string,
    sessionId: string | undefined,
    iso: string,
  ): Promise<void>;
  clearHookChannel(id: string): Promise<void>;
  setStartWarning(id: string, warning: string): Promise<void>;
  setStartError(id: string, e: StartError): Promise<void>;
  attachExistingSession(
    id: string,
    sessionId: string | undefined,
    s: SessionFields,
  ): Promise<void>;
  setTtydPortIfSession(
    id: string,
    session: string,
    port: number,
  ): Promise<boolean>;
  recordTtydExit(session: string, e: TerminalError): Promise<void>;
  clearStaleTtydPort(id: string, sessionId: string | undefined): Promise<void>;
  markSessionLost(id: string, sessionId: string | undefined): Promise<void>;
  unwindGroup(
    groupId: string,
    destination: UnwindDestination,
  ): Promise<{ ok: true; row: ArchivedGroup } | { ok: false; reason: string }>;
  restoreGroup(
    archiveId: string,
  ): Promise<
    { ok: true; card: Card } | { ok: false; status: 404 | 409; reason: string }
  >;
  deleteArchived(archiveId: string): Promise<boolean>;
  recordArchiveDeleteBlocked(archiveId: string, reason: string): Promise<void>;
  recordAccountEvent(
    type: AccountEventType,
    reason: string,
    cardId?: string | null,
  ): Promise<void>;
  listArchive(board: BoardKey): ArchivedGroup[];
  getArchived(archiveId: string): ArchivedGroup | undefined;
  archiveDueForDelete(
    scope: BoardScope,
    now: number,
    retentionDays: number,
  ): ArchivedGroup[];
  switchActiveSession(cardId: string, sessionId: string): Promise<void>;
  reserveNewSession(
    cardId: string,
    identifier: string,
    inheritFrom?: string,
  ): Promise<ReservedSession | null>;
  rollbackReservedSession(cardId: string, sessionId: string): Promise<void>;
  setTerminalError(id: string, e: TerminalError): Promise<void>;
  applyMarker(
    id: string,
    sessionId: string | undefined,
    column: Column,
    statusReason: string | undefined,
    markerKey: string,
    eventType: Extract<EventType, "status_needs_input" | "status_agent_done">,
  ): Promise<void>;
  clearLastMarker(id: string, sessionId: string | undefined): Promise<void>;
  flipBack(id: string, sessionId: string | undefined): Promise<boolean>;
  listCards(scope: BoardScope): Card[];
  sessionsWithTmux(scope: BoardScope): {
    card: Card;
    session: Session & { tmuxSession: string };
  }[];
  sessionsDueForCleanup(
    scope: BoardScope,
    now: number,
  ): { card: Card; sessionId: string | undefined; dueAt: number }[];
  moveCardManual(id: string, column: Column): Promise<ColumnChange[]>;
  completeStart(
    id: string,
    sessionId: string | undefined,
    s: SessionFields,
  ): Promise<void>;
  resumeSession(
    id: string,
    opts: { session: string },
    sessionId?: string,
  ): Promise<void>;
  clearResumeError(id: string): Promise<void>;
  recordResumeFailure(
    id: string,
    sessionId?: string,
    reason?: string,
  ): Promise<void>;
  recordCleanupWarning(
    id: string,
    sessionId: string | undefined,
    warning: string,
  ): Promise<void>;
  finishCleanup(id: string, sessionId: string | undefined): Promise<void>;
  resetCard(id: string): Promise<void>;
  pruneStaleWarnedSessions(now: number): Promise<void>;
  recordCleanupBlocked(
    id: string,
    sessionId: string | undefined,
    blocked: { repo: string; count: number }[],
  ): Promise<void>;
  clearCleanupBlocked(id: string, sessionId: string | undefined): Promise<void>;
  clearCleanupDue(id: string, sessionId: string | undefined): Promise<void>;
  restoreCleanupDue(
    id: string,
    sessionId: string | undefined,
    dueAt: number,
  ): Promise<void>;
  noteCleanupWarning(
    id: string,
    sessionId: string | undefined,
    message: string,
  ): Promise<void>;
  listBoards(): Board[];
  getBoard(key: BoardKey): Board | undefined;
  createBoard(input: NewBoard): Promise<CreateBoardResult>;
  updateBoard(key: BoardKey, patch: BoardPatch): Promise<Board | undefined>;
  setBoardArchived(
    key: BoardKey,
    archived: boolean,
  ): Promise<ArchiveBoardResult>;
  createLocalCard(
    board: BoardKey,
    title: string,
    description: string,
  ): Promise<Card>;
  createGroupCard(
    board: BoardKey,
    title: string,
    memberIds: string[],
  ): Promise<{ ok: true; card: Card } | { ok: false; ineligibleIds: string[] }>;
  adoptLinearIdentity(
    id: string,
    adopted: {
      identifier: string;
      url: string;
      issueId: string;
      title: string;
      description: string;
    },
  ): Promise<void>;
  setLinearError(id: string, copy: string | null): Promise<void>;
  recordLinearPush(
    id: string,
    push: { fromCol: Column; toCol: Column } & (
      { ok: true; state: WorkflowState } | { ok: false; copy: string }
    ),
  ): Promise<void>;
  recordSyncError(id: string, message: string): Promise<void>;
  upsertItems(
    source: string,
    incoming: readonly Item[],
    opts: { kind: SourceKind; partial?: boolean },
  ): Promise<{ inserted: number; updated: number; resolved: number }>;
  getItem(id: string): Item | undefined;
  setItemState(
    id: string,
    state: SettableItemState,
  ): Promise<"ok" | "unknown" | "promoted">;
  snoozeItem(
    id: string,
    untilIso: string,
  ): Promise<"ok" | "unknown" | "promoted">;
  promoteItem(
    board: BoardKey,
    id: string,
    context?: string,
  ): Promise<{ card: Card; created: boolean } | undefined>;
  applyIssues(
    issues: SourceIssue[],
    syncedAt: string,
    opts?: {
      partial?: boolean;
      source?: string;
      kind?: SourceKind;
      tracked?: TrackedRefresh;
    },
  ): Promise<void>;
}

let current: BoardRepository = store;

/**
 * Swap the repository that `boardRepository` forwards to.
 *
 * @remarks
 * Bootstrap calls this once with the real store as the composition root; tests call it with a fake.
 */
export function setBoardRepository(repo: BoardRepository): void {
  current = repo;
}

/**
 * Build a repository that forwards every member read to the current target.
 *
 * @remarks
 * The default target is the real store, so code and tests that never call the setter keep today's
 * behaviour. Function members are bound to the current target so `this` is the target and the
 * private members of `BoardStore` keep working.
 */
function forwardingRepository(): BoardRepository {
  return new Proxy({} as BoardRepository, {
    get(_target, prop) {
      const value: unknown = Reflect.get(current, prop);
      return typeof value === "function"
        ? (value as () => unknown).bind(current)
        : value;
    },
  });
}

export const boardRepository = forwardingRepository();
