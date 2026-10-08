import { useState } from "react";
import { OrchestratorsTable } from "@/modules/orchestrator/components/OrchestratorsTable";
import {
  movableGroups,
  orchestratorRows,
} from "@/modules/orchestrator/domain/ownership";
import type { OrchestratorView } from "@/modules/orchestrator/domain/panel-model";
import { useBoardRecordQuery } from "@/modules/orchestrator/queries/orchestrator-queries";
import type { BoardKey, Card } from "../../../../shared/types.js";
import { ExtraFormContainer } from "./ExtraFormContainer";
import { MoveGroupsContainer } from "./MoveGroupsContainer";

type Dialog =
  { kind: "add" } | { kind: "edit"; id: string } | { kind: "move"; id: string };

interface OrchestratorsContainerProps {
  board: BoardKey;
  orchestrators: readonly OrchestratorView[];
  cards: readonly Card[];
  loading: boolean;
}

export function OrchestratorsContainer({
  board,
  orchestrators,
  cards,
  loading,
}: OrchestratorsContainerProps) {
  const policy = useBoardRecordQuery(board).data?.policy ?? null;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const target =
    dialog?.kind === "add"
      ? null
      : (orchestrators.find((o) => o.id === dialog?.id) ?? null);
  const close = () => setDialog(null);

  return (
    <>
      <OrchestratorsTable
        rows={orchestratorRows(orchestrators, cards)}
        loading={loading}
        canAdd={policy !== null && orchestrators.some((o) => o.role === "main")}
        canMove={(id) => {
          const source = orchestrators.find((o) => o.id === id);
          return (
            source !== undefined &&
            orchestrators.length > 1 &&
            movableGroups(source, orchestrators, cards).length > 0
          );
        }}
        onAdd={() => setDialog({ kind: "add" })}
        onMove={(id) => setDialog({ kind: "move", id })}
        onEdit={(id) => setDialog({ kind: "edit", id })}
      />
      {policy !== null && dialog?.kind === "add" && (
        <ExtraFormContainer
          board={board}
          policy={policy}
          records={orchestrators}
          cards={cards}
          editing={null}
          onClose={close}
        />
      )}
      {policy !== null && dialog?.kind === "edit" && target !== null && (
        <ExtraFormContainer
          board={board}
          policy={policy}
          records={orchestrators}
          cards={cards}
          editing={target}
          onClose={close}
        />
      )}
      {dialog?.kind === "move" && target !== null && (
        <MoveGroupsContainer
          board={board}
          source={target}
          records={orchestrators}
          cards={cards}
          onClose={close}
        />
      )}
    </>
  );
}
