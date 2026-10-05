import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardSnapshot } from "../../../../shared/types.js";
import { nowMs } from "../../../../shared/format-age.js";
import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { sourceAccent } from "@/components/badges";
import type { FlowToken } from "@/components/FlowStage";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { usePollSourceMutation } from "@/queries/source-poll-queries";
import { FlowWideFrame } from "@/modules/flow/components/FlowWideFrame";
import { FlowDiagram } from "@/modules/flow/components/FlowDiagram";
import { FlowNarrow } from "@/modules/flow/components/FlowNarrow";
import { FlowToolbar, type Speed } from "@/modules/flow/components/FlowToolbar";
import {
  admitAll,
  diffArrivals,
  flowRows,
  latestRow,
  pollerTone,
  ridePath,
  sourceNodes,
  syncLine,
  syncOutcome,
  trayCounts,
  type FlowRow,
} from "@/modules/flow/domain/flow-model";

export interface FlowContainerProps {
  board: BoardSnapshot;
  onOpenList: () => void;
}

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

export function FlowContainer({ board, onOpenList }: FlowContainerProps) {
  const narrow = useMediaQuery(NARROW_QUERY);
  const { mutateAsync: poll } = usePollSourceMutation();
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
    const results = await Promise.allSettled(ids.map((id) => poll(id))).finally(
      () => {
        syncInFlight.current = false;
      },
    );
    const { started, notice: outcome } = syncOutcome(ids, results);
    if (started.length === 0) setSyncRun(0);
    setNotice(outcome);
  };

  if (narrow) {
    return <FlowNarrow sources={sources} counts={counts} lastSync={lastSync} />;
  }

  return (
    <FlowWideFrame>
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
    </FlowWideFrame>
  );
}
