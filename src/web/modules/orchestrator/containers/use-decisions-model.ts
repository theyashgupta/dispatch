import { nowMs } from "../../../../shared/format-age.js";
import type { BoardKey, Card } from "../../../../shared/types.js";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { decisionViews } from "../../../../shared/decision-view.js";
import {
  attentionRows,
  decisionCount,
  stoppedLoops,
} from "@/modules/orchestrator/domain/decision-view";
import type { OrchestratorView } from "@/modules/orchestrator/domain/panel-model";
import { usePanelDecisionsQuery } from "@/modules/orchestrator/queries/orchestrator-queries";

const NO_CARDS: Card[] = [];

/**
 * Compose the open decision items, the board snapshot and the orchestrator records into what the Decisions tab and the stopped loops list show.
 *
 * @remarks
 * The snapshot comes from the shared query that the shell already holds, so the panel adds no snapshot request.
 */
export function useDecisionsModel(
  board: BoardKey,
  doneLimit: number,
  orchestrators: readonly OrchestratorView[],
) {
  const decisions = usePanelDecisionsQuery(board);
  const cards = useBoardSnapshot(board, doneLimit)?.cards ?? NO_CARDS;
  const names = new Map(orchestrators.map((o) => [o.id, o.name]));
  const views = decisionViews(decisions.data ?? [], names, nowMs());
  const rows = attentionRows(cards);
  return {
    cards,
    views,
    rows,
    loops: stoppedLoops(cards),
    count: decisionCount(views, rows),
    loading: decisions.isPending,
  };
}
