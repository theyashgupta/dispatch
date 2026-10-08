import { useState } from "react";
import { toast } from "sonner";
import { MoveGroupsDialog } from "@/modules/orchestrator/components/MoveGroupsDialog";
import {
  movableGroups,
  movePlan,
  type OwnerRecord,
} from "@/modules/orchestrator/domain/ownership";
import { actionErrorCopy } from "@/modules/orchestrator/domain/panel-model";
import { useMoveGroupsMutation } from "@/modules/orchestrator/queries/orchestrator-queries";
import type { BoardKey, Card } from "../../../../shared/types.js";

interface MoveGroupsContainerProps {
  board: BoardKey;
  source: OwnerRecord;
  records: readonly OwnerRecord[];
  cards: readonly Card[];
  onClose: () => void;
}

export function MoveGroupsContainer({
  board,
  source,
  records,
  cards,
  onClose,
}: MoveGroupsContainerProps) {
  const move = useMoveGroupsMutation(board);
  const others = records.filter((r) => r.id !== source.id);
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [failure, setFailure] = useState<string | null>(null);
  const plan = movePlan(records, source.id, target, picked);
  const targetName = others.find((r) => r.id === target)?.name ?? "";

  async function submit(): Promise<void> {
    if (plan.steps.length === 0 || move.isPending) return;
    setFailure(null);
    const result = await move.mutateAsync(plan.steps);
    if (!result.ok) {
      setFailure(actionErrorCopy("Move groups", result.reason));
      return;
    }
    toast.success(`Groups moved to ${targetName}.`);
    onClose();
  }

  return (
    <MoveGroupsDialog
      title={`Move groups from ${source.name}`}
      groups={movableGroups(source, records, cards)}
      picked={picked}
      targets={others.map((r) => ({ value: r.id, label: r.name }))}
      target={target}
      blocked={plan.blocked}
      failure={failure}
      pending={move.isPending}
      canSubmit={plan.steps.length > 0 && plan.blocked === null}
      onTogglePick={(id) =>
        setPicked((prev) =>
          prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        )
      }
      onTargetChange={setTarget}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}
