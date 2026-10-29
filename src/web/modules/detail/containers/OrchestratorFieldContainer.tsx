import { useState } from "react";
import type {
  BoardKey,
  Card as CardModel,
  OrchestratorRecord,
} from "../../../../shared/types.js";
import { refusalText } from "../../../../shared/decision-view.js";
import { cardOwner } from "../../../../shared/orchestrator-owner.js";
import { OrchestratorField } from "@/modules/detail/components/OrchestratorField";
import {
  assignableCard,
  orchestratorOptions,
} from "@/modules/detail/domain/orchestrator-field";
import { useSetCardOrchestratorMutation } from "@/modules/detail/queries/detail-queries";
import { useBoardListQuery } from "@/queries/board-list-queries";

const NO_RECORDS: OrchestratorRecord[] = [];

interface OrchestratorFieldContainerProps {
  card: CardModel;
  board: BoardKey;
}

export function OrchestratorFieldContainer({
  card,
  board,
}: OrchestratorFieldContainerProps) {
  const records =
    useBoardListQuery((list) => list.boards.find((b) => b.key === board)).data
      ?.orchestrators ?? NO_RECORDS;
  const { mutateAsync, isPending } = useSetCardOrchestratorMutation();
  const [error, setError] = useState<string | null>(null);

  if (!assignableCard(card, records)) return null;

  const assign = async (orchestratorId: string) => {
    const result = await mutateAsync({ board, id: card.id, orchestratorId });
    setError(result.ok ? null : refusalText(result.error, null));
  };

  return (
    <OrchestratorField
      options={orchestratorOptions(records)}
      value={cardOwner(records, card, undefined)}
      pending={isPending}
      error={error}
      onChange={(id) => void assign(id)}
    />
  );
}
