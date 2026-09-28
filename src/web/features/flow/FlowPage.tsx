import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { BoardSnapshot } from "../../../shared/types.js";
import type { FlowToken } from "../../primitives/FlowStage.js";
import { pageColumnStyle } from "../../primitives/PageBody.js";
import { admitToken } from "../../lib/flow-geometry.js";
import { pollSource } from "../../lib/api.js";
import { nowMs } from "../../lib/format-age.js";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { sourceAccent } from "../badges/index.js";
import {
  diffArrivals,
  flowRows,
  latestRow,
  pollerTone,
  ridePath,
  sourceNodes,
  STAGE_WIDTH,
  syncLine,
  trayCounts,
  type FlowRow,
} from "./flow-model.js";
import { FlowDiagram } from "./FlowDiagram.js";
import { FlowNarrow } from "./FlowNarrow.js";
import { FlowToolbar, type Speed } from "./FlowToolbar.js";

interface FlowPageProps {
  board: BoardSnapshot;
  onOpenList: () => void;
}

const scrollStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const columnStyle: CSSProperties = {
  ...pageColumnStyle,
  maxWidth: `calc(${STAGE_WIDTH}px + 2 * var(--space-lg))`,
};

const RIDE_MS = 2400;
const SYNC_WAIT_MS = 30_000;
const SYNC_FLASH_MS = 1200;

function rideToken(row: FlowRow, id: string, speed: Speed): FlowToken {
  return {
    id,
    path: ridePath(row),
    color: sourceAccent(row.source),
    durationMs: RIDE_MS / speed,
  };
}

function admitAll(
  current: readonly FlowToken[],
  incoming: readonly FlowToken[],
): FlowToken[] {
  const next = [...current];
  for (const token of incoming) {
    if (admitToken(next.length) && !next.some((t) => t.id === token.id)) {
      next.push(token);
    }
  }
  return next;
}

export function FlowPage({ board, onOpenList }: FlowPageProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const [speed, setSpeed] = useState<Speed>(1);
  const [tokens, setTokens] = useState<FlowToken[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncRun, setSyncRun] = useState(0);
  const [flash, setFlash] = useState(false);
  const [lastSynced, setLastSynced] = useState(board.syncedAt);
  const [seen, setSeen] = useState<{
    key: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  const replaySeq = useRef(0);
  const syncInFlight = useRef(false);

  const rows = flowRows(board.items ?? [], board.cards);
  const rowKey = rows.map((r) => r.id).join("\n");
  if (seen === null || seen.key !== rowKey) {
    const arrivals = diffArrivals(seen === null ? null : seen.ids, rows);
    setSeen({ key: rowKey, ids: new Set(rows.map((r) => r.id)) });
    if (arrivals.length > 0 && !narrow) {
      setTokens((ts) =>
        admitAll(
          ts,
          arrivals.map((r) => rideToken(r, `arrive-${r.id}`, speed)),
        ),
      );
    }
  }
  if (board.syncedAt !== lastSynced) {
    setLastSynced(board.syncedAt);
    setSyncRun(0);
    setNotice(null);
    setFlash(true);
  }
  if (narrow && tokens.length > 0) setTokens([]);

  const sources = sourceNodes(board.enabledSources ?? [], rows);
  const counts = trayCounts(rows);
  const now = nowMs();
  const lastSync = syncLine(board.syncedAt, now);

  useEffect(() => {
    if (syncRun === 0) return;
    const t = setTimeout(() => setSyncRun(0), SYNC_WAIT_MS);
    return () => clearTimeout(t);
  }, [syncRun]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), SYNC_FLASH_MS);
    return () => clearTimeout(t);
  }, [flash, lastSynced]);

  const handleTokenEnd = useCallback((id: string) => {
    setTokens((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const handleReplay = () => {
    const row = latestRow(rows);
    if (row === null) return;
    replaySeq.current += 1;
    const token = rideToken(row, `replay-${replaySeq.current}`, speed);
    setTokens((ts) => admitAll(ts, [token]));
  };

  const handleSync = async () => {
    if (syncInFlight.current) return;
    const ids = board.enabledSources ?? [];
    if (ids.length === 0) {
      setNotice("No source is enabled");
      return;
    }
    syncInFlight.current = true;
    setSyncRun((n) => n + 1);
    const results = await Promise.all(
      ids.map(async (id) => ({ id, result: await pollSource(id) })),
    ).finally(() => {
      syncInFlight.current = false;
    });
    const started = results.filter((r) => r.result.ok).map((r) => r.id);
    const errors = results.flatMap((r) =>
      r.result.ok ? [] : [`${r.id}: ${r.result.error}`],
    );
    if (started.length === 0) setSyncRun(0);
    setNotice(
      [started.length > 0 ? `Syncing ${started.join(", ")}` : null, ...errors]
        .filter((part) => part !== null)
        .join(". "),
    );
  };

  if (narrow) {
    return <FlowNarrow sources={sources} counts={counts} lastSync={lastSync} />;
  }

  return (
    <div className="scroll-stable-y" style={scrollStyle}>
      <div style={columnStyle}>
        <FlowToolbar
          speed={speed}
          canReplay={latestRow(rows) !== null}
          syncing={syncRun > 0}
          notice={notice}
          onSpeedChange={setSpeed}
          onReplay={handleReplay}
          onSync={() => void handleSync()}
        />
        <FlowDiagram
          sources={sources}
          counts={counts}
          tone={pollerTone(
            board.syncedAt,
            board.pollIntervalMs,
            board.syncUnreachable,
            now,
          )}
          pulsing={syncRun > 0 || flash}
          lastSync={lastSync}
          tokens={tokens}
          onTokenEnd={handleTokenEnd}
          onOpenList={onOpenList}
        />
      </div>
    </div>
  );
}
