import { useEffect, useRef, useState } from "react";
import {
  useLocation,
  useRouteContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { startRefusalText } from "../../../../shared/memory-refusal.js";
import type {
  Card as CardModel,
  UnwindDestination,
} from "../../../../shared/types.js";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import {
  boardSwitchTarget,
  cardBoardSwitch,
} from "../../../../shared/board-select.js";
import { askAboutQuestion } from "../../../../shared/ask.js";
import { cardIdentifiers as identifiersOf } from "../../../../shared/card-identifiers.js";
import { membersOf } from "../../../../shared/group-members.js";
import {
  actionablePinnedMembers,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { pageLocation, routeFromMatch } from "../../../../shared/route.js";
import {
  accountName,
  sessionAccountView,
} from "../../../../shared/session-account-view.js";
import {
  startTarget,
  type StartRequest,
} from "../../../../shared/start-request.js";
import { undoToastCopy } from "../../../../shared/undo-toast.js";
import { useAccountsQuery } from "@/queries/accounts-queries";
import { useActivityFeedQuery } from "@/queries/activity-queries";
import { restoreArchived } from "@/queries/archive-api";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { getCard, unwindGroup, type ResumeResult } from "@/queries/cards-api";
import {
  usePauseCardMutation,
  useResumeCardMutation,
  useResumeTargetQuery,
  useStartCardMutation,
  useUnpauseCardMutation,
} from "@/queries/cards-queries";
import { useSessionAccountMove } from "@/queries/session-account-queries";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
import { stampLastOpened } from "@/components/ui/hooks/use-last-opened";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { SidePanel } from "@/components/ui/side-panel";
import {
  PanelAccountRow,
  PanelBody,
  PanelEmptyState,
  PanelLoadError,
  PanelLoading,
  PanelPreviews,
  PanelReference,
  PanelRow,
} from "@/modules/detail/components/PanelFrame";
import {
  pauseFailureCopy,
  pausedNote,
} from "@/modules/detail/domain/pause-copy";
import {
  resumeLine as buildResumeLine,
  RESUME_TARGET_ERROR,
  RESUME_TARGET_LOADING,
} from "@/modules/detail/domain/resume-target";
import { PanelMutedNotice } from "@/modules/detail/components/PanelNotice";
import { PanelHeader } from "@/modules/detail/components/PanelHeader";
import { PreviewRow } from "@/modules/detail/components/PreviewRow";
import { ReferenceBlocks } from "@/modules/detail/components/ReferenceBlocks";
import { SessionFlowRow } from "@/modules/detail/components/SessionFlowRow";
import { SessionLostSection } from "@/modules/detail/components/SessionLostSection";
import { SessionSwitcher } from "@/modules/detail/components/SessionSwitcher";
import { StartAnotherSessionButton } from "@/modules/detail/components/StartAnotherSessionButton";
import { TerminalRegion } from "@/modules/detail/components/TerminalRegion";
import { UnknownProbeRow } from "@/modules/detail/components/UnknownProbeRow";
import { reviewHeader as buildReviewHeader } from "@/modules/detail/domain/review-header";
import { heldPrItems } from "../../../../shared/pr-rows.js";
import { hasSessionFlow } from "@/modules/detail/domain/session-flow";
import { useFocusReturn } from "@/modules/detail/hooks/use-focus-return";
import { usePanelHistory } from "@/modules/detail/hooks/use-panel-history";
import {
  useCleanupCardMutation,
  useEnsureTerminalMutation,
  useOpenEditorMutation,
  usePanelMoveCardMutation,
  useRunClaudeMutation,
  useSwitchSessionMutation,
} from "@/modules/detail/queries/detail-queries";
import { CardTimelineContainer } from "./CardTimelineContainer";
import { LinearSectionContainer } from "./LinearSectionContainer";

export function DetailPanelContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const leaf = useRouterState({ select: (s) => s.matches.at(-1) });
  const pathname = useLocation({ select: (l) => l.pathname });
  const routePage = routeFromMatch(leaf, pathname).page;
  const docked = routePage === "workspace";
  const storeBoard = useAppStore(appStore, (s) => s.board);
  const splitBoard = useAppStore(appStore, (s) => s.splitBoard);
  const board = useBoardSnapshot(
    storeBoard,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const selectedCardId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const pinnedHydrating = useAppStore(appStore, (s) => s.pinnedHydrating);
  const pinFetchErrorState = useAppStore(appStore, (s) => s.pinFetchError);
  const pinFetch = useAppStore(appStore, (s) => s.pinFetch);
  const { data: accountsData } = useAccountsQuery();

  const cards = board?.cards;
  const card = selectedCardOf(cards, selectedCardId, pinned);
  const boardKey =
    splitBoard !== null && card?.boardKey === splitBoard
      ? splitBoard
      : storeBoard;
  const { data: activityEvents } = useActivityFeedQuery(boardKey, {
    refetchOnMount: false,
  });
  const inWindow = cards?.some((c) => c.id === selectedCardId) === true;
  const members =
    card == null || card.source !== "group"
      ? undefined
      : inWindow
        ? membersOf(card, cards ?? [])
        : pinned?.card.id === selectedCardId
          ? pinned.members
          : [];
  const membersActionable =
    inWindow || actionablePinnedMembers(selectedCardId, pinned);
  const pinFetchError =
    !inWindow &&
    pinFetchErrorState != null &&
    pinFetchErrorState.id === selectedCardId
      ? pinFetchErrorState.kind
      : null;
  const hydrating = pinnedHydrating && !inWindow;
  const editors = board?.editors;
  const accounts = accountsData?.accounts;
  const cardIdentifiers = identifiersOf(cards ?? []);
  const onClose = appStore.closePanel;
  const onRetryPinFetch = appStore.retryPinFetch;
  const onStartRequest = (req: string | StartRequest) =>
    appStore.requestStart(req, startTarget(req, cards));
  const onCleanupRequest = appStore.openCleanup;
  const onResetRequest = appStore.openReset;
  const onSyncRequest = appStore.openSync;
  const onAskRequest = (target: CardModel) => {
    const question = askAboutQuestion({
      kind: "card",
      identifier: target.identifier,
      title: target.title,
    });
    void router.navigate({
      href: pageLocation({ page: "ask", id: question }, boardKey),
    });
  };
  const onUnwindRequest = (id: string, to: UnwindDestination) => {
    void unwindGroup(id, to)
      .then((result) => {
        if (result.ok) {
          const archivedId = result.archived.id;
          appStore.showUndo(undoToastCopy(result.archived), async () => {
            const restored = await restoreArchived(archivedId);
            if (!restored.ok) throw new Error(restored.error);
          });
          appStore.deselect(archivedId);
          return;
        }
        appStore.notice(result.error);
      })
      .catch((err: unknown) => {
        console.error("unwindGroup failed", err);
        appStore.notice("Couldn't unwind this group.");
      });
  };

  const fetchedGen = useRef(0);
  useEffect(() => {
    if (pinFetch == null || pinFetch.gen === fetchedGen.current) return;
    fetchedGen.current = pinFetch.gen;
    const { id, gen } = pinFetch;
    getCard(id)
      .then((fetched) => appStore.pinFetched(gen, fetched))
      .catch(() => appStore.pinFetchFailed(gen));
  }, [pinFetch, appStore]);

  const open = card != null;

  const selectedBoardRef = useRef(storeBoard);
  const splitBoardRef = useRef(splitBoard);
  const routePageRef = useRef(routePage);
  useEffect(() => {
    selectedBoardRef.current = storeBoard;
    splitBoardRef.current = splitBoard;
    routePageRef.current = routePage;
  });
  const cardId = card?.id;
  const cardBoard = card?.boardKey;
  useEffect(() => {
    if (cardId === undefined) return;
    const target = cardBoardSwitch(
      cardBoard,
      selectedBoardRef.current,
      splitBoardRef.current,
    );
    if (target === null) return;
    void router.navigate({
      ...boardSwitchTarget(routePageRef.current, target),
      replace: true,
    });
  }, [cardId, cardBoard, router]);

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const isNarrowViewport = useMediaQuery("(max-width: 520px)");
  const takeover = !docked && isCarousel;
  const narrowPanel = (docked || takeover) && isNarrowViewport;
  const requestClose = usePanelHistory(open && takeover, onClose);
  useFocusReturn(open);

  const { mutateAsync: ensureTerminal } = useEnsureTerminalMutation();
  const { mutateAsync: runClaude } = useRunClaudeMutation();
  const { mutateAsync: switchSession } = useSwitchSessionMutation();
  const { mutateAsync: openEditor } = useOpenEditorMutation();
  const { mutateAsync: moveCard } = usePanelMoveCardMutation();
  const { mutateAsync: cleanupCard } = useCleanupCardMutation();
  const { mutateAsync: startCard } = useStartCardMutation();
  const { mutateAsync: resumeCard } = useResumeCardMutation();
  const pause = usePauseCardMutation();
  const unpause = useUnpauseCardMutation();
  const runPauseChange = (change: Promise<ResumeResult>) => {
    void change.then((result) => {
      if (!result.ok) toast.error(pauseFailureCopy(result));
    });
  };
  const accountMove = useSessionAccountMove();

  const [prevCardId, setPrevCardId] = useState<string | null>(card?.id ?? null);
  if ((card?.id ?? null) !== prevCardId) {
    setPrevCardId(card?.id ?? null);
    if (card) {
      setDetailsExpanded(false);
      setFullscreen(false);
    }
  }

  const [shown, setShown] = useState<CardModel | null>(card);
  useEffect(() => {
    if (card) {
      setShown(card);
      return;
    }
    const t = setTimeout(() => setShown(null), 200);
    return () => clearTimeout(t);
  }, [card]);

  useEffect(() => {
    if (!card?.id || !card.tmuxSession) return;
    const id = card.id;
    stampLastOpened(id);
    return () => {
      stampLastOpened(id);
      window.setTimeout(() => stampLastOpened(id), 5000);
    };
  }, [card?.id, card?.tmuxSession]);

  const spawnedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!card) {
      spawnedForRef.current = null;
      return;
    }
    if (card.ttydPort != null) {
      spawnedForRef.current = null;
      return;
    }
    const spawnKey = `${card.id}:${card.activeSessionId ?? ""}`;
    if (
      card.tmuxSession &&
      !card.sessionLost &&
      card.terminalError == null &&
      spawnedForRef.current !== spawnKey
    ) {
      spawnedForRef.current = spawnKey;
      ensureTerminal(card.id).catch((err: unknown) => {
        console.error(err);
        if (spawnedForRef.current === spawnKey) spawnedForRef.current = null;
      });
    }
  }, [card, ensureTerminal]);

  const c = shown;
  const sessionAccount = sessionAccountView({
    sessionId: c?.activeSessionId,
    accountId: c?.claudeAccountId,
    accounts,
    sessions: accountsData?.sessions,
  });
  const accountKey = c == null ? null : (c.activeSessionId ?? c.id);
  const moveSessionAccount = (
    kind: "restart" | "continue",
    accountId: string,
    movedText: string,
  ) => {
    if (c == null || accountKey == null) return;
    accountMove.move(
      accountKey,
      kind,
      { cardId: c.id, accountId, sessionId: c.activeSessionId },
      movedText,
    );
  };

  const showStartAnother =
    c != null &&
    c.column !== "done" &&
    c.groupId == null &&
    c.workspacePath != null;

  const items = useItems(board);
  const reviewHeader =
    c == null
      ? null
      : buildReviewHeader(c, [...items, ...heldPrItems(board?.items ?? [])]);

  const hasLiveSession = !!(c?.tmuxSession && !c.sessionLost);
  const note = c != null ? pausedNote(c) : null;
  const activeSessionLost = c?.activeSessionId != null && !c.tmuxSession;
  const resumeTarget = useResumeTargetQuery(c?.id ?? "", activeSessionLost);
  const resumeLine =
    !activeSessionLost || !c?.workspacePath
      ? undefined
      : resumeTarget.isError
        ? { text: RESUME_TARGET_ERROR }
        : resumeTarget.data
          ? buildResumeLine(resumeTarget.data, resumeTarget.dataUpdatedAt)
          : { text: RESUME_TARGET_LOADING };

  if (!hasLiveSession && (fullscreen || detailsExpanded)) {
    setFullscreen(false);
    setDetailsExpanded(false);
  }

  if (docked && fullscreen) {
    setFullscreen(false);
  }

  const referenceColumn = (
    <>
      <ReferenceBlocks
        card={c}
        members={members}
        membersActionable={membersActionable}
        onRetryCleanup={(id) => {
          cleanupCard(id).catch(console.error);
        }}
      />
      {c != null && (c.source ?? "linear") === "linear" && (
        <LinearSectionContainer key={c.id} card={c} />
      )}
      {c && (
        <CardTimelineContainer
          board={c.boardKey ?? DEFAULT_BOARD_KEY}
          cardId={c.id}
          events={activityEvents ?? []}
          identifiers={cardIdentifiers}
        />
      )}
    </>
  );
  const panel =
    docked && c == null ? (
      <PanelEmptyState />
    ) : (
      <>
        <PanelHeader
          card={c}
          editors={editors}
          hasLiveSession={hasLiveSession}
          detailsExpanded={detailsExpanded}
          onToggleDetails={() => setDetailsExpanded((v) => !v)}
          fullscreen={fullscreen}
          onToggleFullscreen={() => setFullscreen((v) => !v)}
          onClose={requestClose}
          docked={docked}
          takeover={takeover}
          narrowPanel={narrowPanel}
          onOpenEditor={(id, editor) => {
            openEditor({ id, editor }).catch(console.error);
          }}
          onMove={(id, column) => {
            moveCard({ id, column }).catch(console.error);
          }}
          onStartRequest={onStartRequest}
          onCleanupRequest={onCleanupRequest}
          onUnwindRequest={onUnwindRequest}
          onResetRequest={onResetRequest}
          onSyncRequest={onSyncRequest}
          onPauseRequest={(id) => runPauseChange(pause.mutateAsync({ id }))}
          onResumePausedRequest={(id) =>
            runPauseChange(unpause.mutateAsync({ id }))
          }
          pausePending={
            c != null &&
            ((pause.isPending && pause.variables?.id === c.id) ||
              (unpause.isPending && unpause.variables?.id === c.id))
          }
          onAskRequest={onAskRequest}
          resumeLine={resumeLine}
          reviewHeader={reviewHeader}
        />

        {sessionAccount != null && (
          <PanelAccountRow
            name={sessionAccount.name}
            stale={sessionAccount.stale}
            continueAction={sessionAccount.continueAction}
            pendingNote={sessionAccount.pendingNote}
            pending={
              accountMove.pending?.key === accountKey
                ? accountMove.pending.kind
                : null
            }
            busy={accountMove.pending !== null}
            note={
              accountKey == null ? undefined : accountMove.notes[accountKey]
            }
            onRestart={() =>
              moveSessionAccount(
                "restart",
                sessionAccount.accountId,
                "Restarted",
              )
            }
            onContinue={() => {
              if (accountsData == null) return;
              moveSessionAccount(
                "continue",
                accountsData.activeId,
                `Moved to ${accountName(accountsData.accounts, accountsData.activeId)}`,
              );
            }}
          />
        )}
        {((c?.sessionSummaries?.length ?? 0) >= 2 || showStartAnother) && (
          <PanelRow>
            {c != null && (c.sessionSummaries?.length ?? 0) >= 2 && (
              <SessionSwitcher
                card={c}
                onSwitch={(cardId, sessionId) => {
                  switchSession({ cardId, sessionId }).catch(console.error);
                }}
              />
            )}
            {showStartAnother && c != null && (
              <StartAnotherSessionButton
                card={c}
                onStartRequest={onStartRequest}
                narrowPanel={narrowPanel}
              />
            )}
          </PanelRow>
        )}
        {c != null && hasSessionFlow(c) && <SessionFlowRow card={c} />}

        <PanelBody>
          {hydrating ? (
            <PanelLoading />
          ) : pinFetchError != null ? (
            <PanelLoadError kind={pinFetchError} onRetry={onRetryPinFetch} />
          ) : (
            <>
              {hasLiveSession ? (
                detailsExpanded && (
                  <PanelReference capped grow={false}>
                    {referenceColumn}
                  </PanelReference>
                )
              ) : (
                <PanelReference capped={false} grow={!c?.tmuxSession}>
                  {referenceColumn}
                </PanelReference>
              )}

              {c != null &&
                (c.previewsUnknown != null ||
                  (c.previews != null && c.previews.length > 0)) && (
                  <PanelPreviews>
                    {c.previews?.map((preview) => (
                      <PreviewRow key={preview.port} preview={preview} />
                    ))}
                    {c.previewsUnknown != null && (
                      <UnknownProbeRow
                        category={c.previewsUnknown.category}
                        partial={(c.previews?.length ?? 0) > 0}
                      />
                    )}
                  </PanelPreviews>
                )}

              {note !== null && (
                <div
                  data-testid="paused-note"
                  className="mx-(--space-xl) mb-(--space-lg)"
                >
                  <PanelMutedNotice label="Status">{note}</PanelMutedNotice>
                </div>
              )}

              {hasLiveSession && c && (
                <TerminalRegion
                  card={c}
                  onReconnect={(id) => {
                    ensureTerminal(id).catch(console.error);
                  }}
                  onRunClaude={(id) => {
                    void runClaude(id).catch(console.error);
                  }}
                />
              )}

              {activeSessionLost && (
                <SessionLostSection
                  card={c}
                  resume={(id) => resumeCard({ id })}
                  resumeLine={resumeLine}
                  onRestart={(lost) => {
                    if (lost.workspace) {
                      startCard({
                        id: lost.id,
                        extraDirection: lost.extraDirection ?? "",
                      })
                        .then((result) => {
                          if (!result.ok) toast.error(startRefusalText(result));
                        })
                        .catch(console.error);
                    } else {
                      onStartRequest?.(lost.id);
                    }
                  }}
                />
              )}
            </>
          )}
        </PanelBody>
      </>
    );
  return (
    <SidePanel
      placement="overlay"
      title="Ticket detail"
      handleLabel="Resize panel"
      storageKey="dsp.panel.width"
      open={open}
      docked={docked}
      expanded={fullscreen}
      sheet={takeover}
      onClose={takeover ? requestClose : onClose}
      panel={panel}
    />
  );
}
