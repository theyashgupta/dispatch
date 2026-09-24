import { useEffect, useState, type CSSProperties } from "react";
import type { BoardSnapshot } from "../../../shared/types.js";
import {
  bulkOutcomeCopy,
  runBulkCleanup,
  runBulkResume,
  type ActionServices,
} from "../../lib/actions.js";
import { nowMs } from "../../lib/format-age.js";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { SESSIONS_SHORTCUTS } from "../../lib/shortcuts.js";
import { useShortcuts } from "../../hooks/useShortcuts.js";
import {
  SESSION_SECTIONS,
  flattenSessions,
  accountOptions,
  sessionSection,
  type SessionFilter,
  type SessionRow as SessionRowModel,
} from "../../lib/sessions.js";
import { Chip } from "../../primitives/Chip.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Glyph } from "../../primitives/Glyph.js";
import { BulkConfirmModal } from "./BulkConfirmModal.js";
import { SessionRow } from "./SessionRow.js";
import { SessionsBulkBar } from "./SessionsBulkBar.js";
import { SessionsToolbar } from "./SessionsToolbar.js";
import { bulkEligibility, filterSessionRows } from "./sessions-filters.js";

interface SessionsPageProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
  services: ActionServices;
}

const ELAPSED_TICK_MS = 1000;

const emptyBlockStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  alignItems: "center",
};

const emptyHeadingStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const emptyBodyStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

function ticketLabels(
  targets: readonly SessionRowModel[],
  verb: "Clean up" | "Resume",
): string[] {
  const seen = new Map<string, number>();
  for (const row of targets) seen.set(row.identifier, row.siblings);
  return [...seen].map(([identifier, siblings]) =>
    verb === "Clean up" && siblings > 1
      ? `${identifier} (all ${siblings} sessions)`
      : identifier,
  );
}

export function SessionsPage({
  board,
  selectedCardId,
  onSelectCard,
  services,
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
  useEffect(() => {
    const timer = setInterval(() => setNow(nowMs()), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const rows = flattenSessions(board.cards, now);
  const accounts = accountOptions(rows);
  const visible = filterSessionRows(
    rows,
    accounts.includes(filter.account) ? filter : { ...filter, account: "" },
  );
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
  useShortcuts(
    SESSIONS_SHORTCUTS.map((entry) => ({
      ...entry,
      run: runs[entry.key] ?? (() => {}),
    })),
    { menuOpen: confirm != null, scopeId: "sessions-page" },
  );

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
    <div
      id="sessions-page"
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <SessionsToolbar
        filter={filter}
        accounts={accounts}
        onChange={setFilter}
      />
      <div
        className="scroll-stable-y"
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
      >
        {rows.length === 0 ? (
          <div style={emptyBlockStyle}>
            <Glyph size={48} style={{ opacity: 0.08 }} />
            <div style={emptyHeadingStyle}>No sessions yet</div>
            <div style={emptyBodyStyle}>
              Start a ticket from the Board and its session shows up here.
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div style={emptyBlockStyle}>
            <div style={emptyHeadingStyle}>No matching sessions</div>
            <div style={emptyBodyStyle}>Try a different filter.</div>
          </div>
        ) : (
          sections.map((entry) => (
            <div
              key={entry.section}
              style={{ padding: "0 var(--space-lg)" }}
              data-testid="sessions-section"
            >
              <Collapsible
                title={entry.section}
                badge={<Chip>{entry.rows.length}</Chip>}
                defaultOpen
              >
                <div
                  role="list"
                  style={{ margin: "0 calc(-1 * var(--space-lg))" }}
                >
                  {entry.rows.map((row) => (
                    <SessionRow
                      key={row.key}
                      row={row}
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
                  ))}
                </div>
              </Collapsible>
            </div>
          ))
        )}
      </div>
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
    </div>
  );
}
