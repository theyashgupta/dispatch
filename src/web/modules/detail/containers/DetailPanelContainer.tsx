import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useLocation,
  useRouteContext,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { DEFAULT_CLAUDE_ACCOUNT_ID } from "../../../../shared/types.js";
import type {
  Card as CardModel,
  UnwindDestination,
} from "../../../../shared/types.js";
import { askAboutQuestion } from "../../../../shared/ask.js";
import { cardIdentifiers as identifiersOf } from "../../../../shared/card-identifiers.js";
import { membersOf } from "../../../../shared/group-members.js";
import {
  actionablePinnedMembers,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { routeFromMatch, routeHash } from "../../../../shared/route.js";
import {
  startTarget,
  type StartRequest,
} from "../../../../shared/start-request.js";
import { undoToastCopy } from "../../../../shared/undo-toast.js";
import { accountsQueryOptions } from "@/queries/accounts-queries";
import { activityFeedQueryOptions } from "@/queries/activity-queries";
import { restoreArchived } from "@/queries/archive-api";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { getCard, unwindGroup } from "@/queries/cards-api";
import {
  useResumeCardMutation,
  useStartCardMutation,
} from "@/queries/cards-queries";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { stampLastOpened } from "@/components/ui/hooks/use-last-opened";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  PanelAccountRow,
  PanelBody,
  PanelEmptyState,
  PanelFrame,
  PanelLoadError,
  PanelLoading,
  PanelPreviews,
  PanelReference,
  PanelRow,
} from "@/modules/detail/components/PanelFrame";
import { PanelHeader } from "@/modules/detail/components/PanelHeader";
import { PanelResizeHandle } from "@/modules/detail/components/PanelResizeHandle";
import { PreviewRow } from "@/modules/detail/components/PreviewRow";
import { ReferenceBlocks } from "@/modules/detail/components/ReferenceBlocks";
import { SessionFlowRow } from "@/modules/detail/components/SessionFlowRow";
import { SessionLostSection } from "@/modules/detail/components/SessionLostSection";
import { SessionSwitcher } from "@/modules/detail/components/SessionSwitcher";
import { StartAnotherSessionButton } from "@/modules/detail/components/StartAnotherSessionButton";
import { TerminalRegion } from "@/modules/detail/components/TerminalRegion";
import { UnknownProbeRow } from "@/modules/detail/components/UnknownProbeRow";
import { panelEscapeAction } from "@/modules/detail/domain/panel-escape";
import { hasSessionFlow } from "@/modules/detail/domain/session-flow";
import { useFocusReturn } from "@/modules/detail/hooks/use-focus-return";
import { usePanelHistory } from "@/modules/detail/hooks/use-panel-history";
import { usePanelResize } from "@/modules/detail/hooks/use-panel-resize";
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
  const docked = routeFromMatch(leaf, pathname).page === "workspace";
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
  const selectedCardId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const pinnedHydrating = useAppStore(appStore, (s) => s.pinnedHydrating);
  const pinFetchErrorState = useAppStore(appStore, (s) => s.pinFetchError);
  const pinFetch = useAppStore(appStore, (s) => s.pinFetch);
  const { data: accountsData } = useQuery(accountsQueryOptions());
  const { data: activityEvents } = useQuery({
    ...activityFeedQueryOptions(),
    refetchOnMount: false,
  });

  const cards = board?.cards;
  const card = selectedCardOf(cards, selectedCardId, pinned);
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
      href: routeHash({ page: "ask", id: question }).slice(1),
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

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const isCoarsePointer = useMediaQuery("(pointer: coarse)");
  const isNarrowViewport = useMediaQuery("(max-width: 520px)");
  const takeover = !docked && isCarousel;
  const narrowPanel = (docked || takeover) && isNarrowViewport;
  const effectiveFullscreen = fullscreen || takeover;
  const requestClose = usePanelHistory(open && takeover, onClose);
  const resize = usePanelResize();
  const { isDragging, cancelDrag } = resize;
  useFocusReturn(open);

  const { mutateAsync: ensureTerminal } = useEnsureTerminalMutation();
  const { mutateAsync: runClaude } = useRunClaudeMutation();
  const { mutateAsync: switchSession } = useSwitchSessionMutation();
  const { mutateAsync: openEditor } = useOpenEditorMutation();
  const { mutateAsync: moveCard } = usePanelMoveCardMutation();
  const { mutateAsync: cleanupCard } = useCleanupCardMutation();
  const { mutateAsync: startCard } = useStartCardMutation();
  const { mutateAsync: resumeCard } = useResumeCardMutation();

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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const action = panelEscapeAction({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        dragging: isDragging(),
        takeover,
        fullscreen,
        docked,
      });
      if (action === "cancel-drag") cancelDrag();
      else if (action === "close-takeover") requestClose();
      else if (action === "exit-fullscreen") setFullscreen(false);
      else if (action === "close-overlay") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    open,
    fullscreen,
    docked,
    onClose,
    takeover,
    requestClose,
    isDragging,
    cancelDrag,
  ]);

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
  const sessionAccountEmail =
    c?.claudeAccountId != null
      ? (accounts?.find((a) => a.id === c.claudeAccountId)?.email ??
        (c.claudeAccountId === DEFAULT_CLAUDE_ACCOUNT_ID
          ? "Default"
          : c.claudeAccountId))
      : null;

  const showStartAnother =
    c != null &&
    c.column !== "done" &&
    c.groupId == null &&
    c.workspacePath != null;

  const hasLiveSession = !!(c?.tmuxSession && !c.sessionLost);
  const activeSessionLost = c?.activeSessionId != null && !c.tmuxSession;

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
          cardId={c.id}
          events={activityEvents ?? []}
          identifiers={cardIdentifiers}
        />
      )}
    </>
  );
  return (
    <PanelFrame
      open={open}
      docked={docked}
      fullscreen={effectiveFullscreen}
      asideRef={resize.asideRef}
      onScrimClick={requestClose}
    >
      {!docked && !effectiveFullscreen && (
        <PanelResizeHandle
          open={open}
          coarsePointer={isCoarsePointer}
          resizing={resize.resizing}
          currentWidthPx={resize.currentWidthPx}
          maxWidthPx={resize.maxWidthPx}
          onPointerDown={resize.onPointerDown}
          onDoubleClick={resize.onDoubleClick}
          onKeyDown={resize.onKeyDown}
        />
      )}
      {docked && c == null ? (
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
            onAskRequest={onAskRequest}
          />

          {sessionAccountEmail != null && (
            <PanelAccountRow email={sessionAccountEmail} />
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
                    onRestart={(lost) => {
                      if (lost.workspace) {
                        startCard({
                          id: lost.id,
                          extraDirection: lost.extraDirection ?? "",
                        }).catch(console.error);
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
      )}
    </PanelFrame>
  );
}
