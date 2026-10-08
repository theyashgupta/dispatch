import { useState } from "react";
import { toast } from "sonner";
import { ExtraFormDialog } from "@/modules/orchestrator/components/ExtraFormDialog";
import {
  emptyOverrideValues,
  isOverrideDirty,
  overrideOptions,
  overridePayload,
  overrideValues,
  validateOverride,
  type OverrideValues,
} from "@/modules/orchestrator/domain/override-form";
import {
  nextExtra,
  scopeOf,
  scopeRows,
  type OwnerRecord,
} from "@/modules/orchestrator/domain/ownership";
import { actionErrorCopy } from "@/modules/orchestrator/domain/panel-model";
import {
  useAddExtraMutation,
  useSaveOverridesMutation,
} from "@/modules/orchestrator/queries/orchestrator-queries";
import type { BoardKey, BoardPolicy, Card } from "../../../../shared/types.js";

interface ExtraFormContainerProps {
  board: BoardKey;
  policy: BoardPolicy;
  records: readonly OwnerRecord[];
  cards: readonly Card[];
  editing: OwnerRecord | null;
  onClose: () => void;
}

export function ExtraFormContainer({
  board,
  policy,
  records,
  cards,
  editing,
  onClose,
}: ExtraFormContainerProps) {
  const add = useAddExtraMutation(board);
  const edit = useSaveOverridesMutation(board);
  const saved =
    editing === null
      ? emptyOverrideValues()
      : overrideValues(editing.policyOverride, policy);
  const [values, setValues] = useState<OverrideValues>(saved);
  const [picked, setPicked] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const rows = editing === null ? scopeRows(cards, records, null) : null;
  const errors = validateOverride(values, policy);
  const valid = Object.keys(errors).length === 0;
  const canSubmit =
    valid &&
    (editing === null ? picked.length > 0 : isOverrideDirty(values, saved));
  const pending = add.isPending || edit.isPending;

  async function submit(): Promise<void> {
    if (!canSubmit || pending) return;
    setFailure(null);
    const policyOverride = overridePayload(values);
    if (editing === null) {
      const result = await add.mutateAsync({
        ...nextExtra(records),
        scope: scopeOf(picked, rows ?? []),
        policyOverride,
      });
      if (!result.ok) {
        setFailure(actionErrorCopy("Add extra orchestrator", result.reason));
        return;
      }
    } else {
      const result = await edit.mutateAsync({
        id: editing.id,
        policyOverride,
      });
      if (!result.ok) {
        setFailure(actionErrorCopy("Save overrides", result.reason));
        return;
      }
      toast.success(`Overrides of ${editing.name} saved.`);
    }
    onClose();
  }

  return (
    <ExtraFormDialog
      title={
        editing === null
          ? "Add extra orchestrator"
          : `Edit overrides of ${editing.name}`
      }
      submitLabel={editing === null ? "Add orchestrator" : "Save overrides"}
      scopeRows={rows}
      picked={picked}
      values={values}
      options={overrideOptions(policy)}
      errors={errors}
      canSubmit={canSubmit}
      failure={failure}
      pending={pending}
      onTogglePick={(id) =>
        setPicked((prev) =>
          prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
        )
      }
      onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
      onSubmit={() => void submit()}
      onClose={onClose}
    />
  );
}
