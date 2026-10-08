import { useEffect, useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import { routeHash } from "../../../../shared/route.js";
import {
  bulkOutcomeCopy,
  runBulkCleanup,
  runBulkResume,
  type ActionServices,
} from "../../../../shared/item-actions.js";
import { nowMs } from "../../../../shared/format-age.js";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import {
  SESSION_SECTIONS,
  accountOptions,
  flattenSessions,
  sessionSection,
  type SessionFilter,
  type SessionRow as SessionRowModel,
} from "../../../../shared/sessions.js";
import { sessionAccountView } from "../../../../shared/session-account-view.js";
import {
  SESSIONS_SHORTCUTS,
  bindShortcuts,
} from "../../../../shared/shortcuts.js";
import type { BoardSnapshot } from "../../../../shared/types.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { useShortcuts } from "@/components/ui/hooks/use-shortcuts";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useAccountsQuery } from "@/queries/accounts-queries";
import { actionServices } from "@/queries/action-services";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { useSessionAccountMove } from "@/queries/session-account-queries";
import { BulkConfirmModal } from "@/modules/sessions/components/BulkConfirmModal";
import { SessionRow } from "@/modules/sessions/components/SessionRow";
import { SessionsBulkBar } from "@/modules/sessions/components/SessionsBulkBar";
import {
  SessionsNoMatch,
  SessionsNoRows,
  SessionsScroll,
  SessionsSection,
} from "@/modules/sessions/components/SessionsList";
import { SessionsToolbar } from "@/modules/sessions/components/SessionsToolbar";
import {
  applyFilterEdit,
  bulkEligibility,
  filterSessionRows,
  ticketLabels,
} from "@/modules/sessions/domain/sessions-filters";

interface SessionsPageProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  services: ActionServices;
  scopeId: string;
}

const ELAPSED_TICK_MS = 1000;

export function SessionsContainer({ scopeId }: { scopeId: string }) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const selectedId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  const services = useMemo(
    () =>
      actionServices({
        board: boardKey,
        showUndo: appStore.showUndo,
        notice: appStore.notice,
        openStart: appStore.openStart,
        askAbout: (question) =>
          void router.navigate({
            href: routeHash({ page: "ask", id: question }).slice(1),
          }),
      }),
    [appStore, router, boardKey],
  );
  if (board == null) return null;
  return (
    <SessionsPage
      board={board}
      selectedCardId={
        selectedCardOf(board.cards, selectedId, pinned) != null
          ? selectedId
          : null
      }
      onSelectCard={(id) =>
        appStore.selectCard(id, pinFromBoard(id, board.cards))
      }
      services={services}
      scopeId={scopeId}
    />
  );
}

function SessionsPage({
  board,
  selectedCardId,
  onSelectCard,
  services,
  scopeId,
}: SessionsPageProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [now, setNow] = useState(nowMs);
  const [filter, setFilter] = useState<SessionFilter>({
    liveOnly: false,
    account: "",
    status: "",
    query: "",
  });
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<{
    verb: "Clean up" | "Resume";
    targets: SessionRowModel[];
  } | null>(null);
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [lastCursorIndex, setLastCursorIndex] = useState(0);
  const { data: accountsData } = useAccountsQuery();
  const accountMove = useSessionAccountMove();
  useEffect(() => {
    const timer = setInterval(() => setNow(nowMs()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const rows = flattenSessions(board.cards, now);
  const accounts = accountOptions(rows);
  const effectiveFilter = accounts.includes(filter.account)
    ? filter
    : { ...filter, account: "" };
  const visible = filterSessionRows(rows, effectiveFilter);
  const checkedRows = visible.filter((row) => checked.has(row.key));
  const checkedTickets = [...new Set(checkedRows.map((row) => row.identifier))];
  const eligibility = bulkEligibility(checkedRows);
  const sections = SESSION_SECTIONS.map((section) => ({
    section,
    rows: visible.filter((row) => sessionSection(row) === section),
  })).filter((entry) => entry.rows.length > 0);
  const orderedRows = sections.flatMap((entry) => entry.rows);
  const foundIndex = orderedRows.findIndex((row) => row.key === cursorKey);
  const cursorIndex =
    foundIndex >= 0
      ? foundIndex
      : Math.min(lastCursorIndex, orderedRows.length - 1);
  const cursorRow = cursorIndex >= 0 ? orderedRows[cursorIndex] : undefined;
  useEffect(() => {
    if (cursorIndex >= 0) setLastCursorIndex(cursorIndex);
  }, [cursorIndex]);

  const handleSelect = (row: SessionRowModel) => {
    setCursorKey(row.key);
    const open = () => onSelectCard(row.cardId);
    const liveActive = rows.some(
      (r) => r.cardId === row.cardId && r.active && !r.lost,
    );
    if (row.active || row.siblings < 2 || (row.lost && liveActive)) {
      open();
      return;
    }
    services.api
      .switchSession(row.cardId, row.sessionId)
      .then(open, (err: unknown) => {
        services.notice(
          err instanceof Error ? err.message : "Could not switch session",
        );
        open();
      });
  };

  const handleRestart = (row: SessionRowModel, accountId: string) =>
    accountMove.move(
      row.sessionId,
      "restart",
      { cardId: row.cardId, accountId, sessionId: row.sessionId },
      "Restarted",
    );

  const handleMoveCursor = (step: number) => {
    const next = Math.max(
      0,
      Math.min(orderedRows.length - 1, cursorIndex + step),
    );
    const target = orderedRows[next];
    if (!target) return;
    setCursorKey(target.key);
    const el = document.getElementById(`session-row-${target.key}`);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  };

  const runs: Record<string, () => void> = {
    j: () => handleMoveCursor(1),
    k: () => handleMoveCursor(-1),
    Enter: () => {
      if (cursorRow) handleSelect(cursorRow);
    },
  };
  useShortcuts(bindShortcuts(SESSIONS_SHORTCUTS, runs), {
    menuOpen: confirm != null,
    scopeId,
  });

  const handleToggleChecked = (row: SessionRowModel) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };

  const handleConfirm = () => {
    if (confirm == null) return;
    const [run, verb] =
      confirm.verb === "Clean up"
        ? [runBulkCleanup, "Cleanup started for"]
        : [runBulkResume, "Resume started for"];
    const targets = confirm.targets;
    setChecked(new Set());
    void run(services.api, targets).then((outcome) =>
      services.notice(bulkOutcomeCopy(verb, outcome)),
    );
  };

  return (
    <>
      <SessionsToolbar
        filter={effectiveFilter}
        accounts={accounts}
        onChange={(next) =>
          setFilter(applyFilterEdit(next, effectiveFilter, filter))
        }
      />
      <SessionsScroll>
        {rows.length === 0 ? (
          <SessionsNoRows />
        ) : visible.length === 0 ? (
          <SessionsNoMatch />
        ) : (
          sections.map((entry) => (
            <SessionsSection
              key={entry.section}
              label={entry.section}
              count={entry.rows.length}
            >
              {entry.rows.map((row) => {
                const account = sessionAccountView({
                  sessionId: row.sessionId,
                  accountId: row.account,
                  accounts: accountsData?.accounts,
                  sessions: accountsData?.sessions,
                });
                return (
                  <SessionRow
                    key={row.key}
                    row={row}
                    account={account}
                    pending={accountMove.pending?.key === row.sessionId}
                    disabled={accountMove.pending !== null}
                    note={accountMove.notes[row.sessionId]}
                    onRestart={() => {
                      if (account != null)
                        handleRestart(row, account.accountId);
                    }}
                    now={now}
                    selected={
                      row.key === cursorRow?.key ||
                      (row.active && row.cardId === selectedCardId)
                    }
                    checked={checked.has(row.key)}
                    narrow={narrow}
                    onSelect={handleSelect}
                    onToggleChecked={handleToggleChecked}
                  />
                );
              })}
            </SessionsSection>
          ))
        )}
      </SessionsScroll>
      <SessionsBulkBar
        count={checkedRows.length}
        tickets={checkedTickets.length}
        cleanup={eligibility.cleanup}
        resume={eligibility.resume}
        onCleanup={() => setConfirm({ verb: "Clean up", targets: checkedRows })}
        onResume={() => setConfirm({ verb: "Resume", targets: checkedRows })}
        onClear={() => setChecked(new Set())}
      />
      {confirm ? (
        <BulkConfirmModal
          verb={confirm.verb}
          identifiers={ticketLabels(confirm.targets, confirm.verb)}
          onConfirm={handleConfirm}
          onClose={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
