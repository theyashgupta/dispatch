import { boardRepository as store } from "../../store/board-repository.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import { ValidationError } from "../domain/errors.js";
import { refreshLoopProgress } from "./loop-progress-reader.js";

export interface LoopGateReport {
  kind: "phase" | "unit";
  unit: number;
  phase?: number | undefined;
  result: "pass" | "fail";
  note?: string | undefined;
}

/**
 * Records a loop gate report as a `loop_gate` event for the reporting group card and refreshes its progress.
 *
 * @remarks The report is only a trigger: progress comes from the loop files, so a claim no file holds changes nothing.
 */
export function reportLoopGate(
  entry: { cardId: string; sessionId: string },
  report: LoopGateReport,
): void {
  const card = store.getCard(entry.cardId);
  if (card === undefined || card.source !== "group") {
    throw new ValidationError("not-group-card");
  }
  store.appendOrchestrationEvent({
    boardKey: card.boardKey ?? DEFAULT_BOARD_KEY,
    cardId: card.id,
    sessionId: entry.sessionId,
    kind: "loop_gate",
    data: { ...report },
    ts: new Date().toISOString(),
  });
  void refreshLoopProgress(card.id);
}
