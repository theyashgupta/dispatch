import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { PolicyForm } from "@/modules/orchestrator/components/PolicyForm";
import {
  loopModelOptions,
  orchestratorModelOptions,
} from "@/modules/orchestrator/domain/orchestrator-models";
import { actionErrorCopy } from "@/modules/orchestrator/domain/panel-model";
import {
  isPolicyDirty,
  listedModels,
  policyFormValues,
  policyPayload,
  validatePolicyForm,
  type PolicyFormValues,
} from "@/modules/orchestrator/domain/policy-form";
import {
  useBoardRecordQuery,
  useSavePolicyMutation,
} from "@/modules/orchestrator/queries/orchestrator-queries";
import type { BoardKey } from "../../../../shared/types.js";

export function PolicyContainer({ board }: { board: BoardKey }) {
  const record = useBoardRecordQuery(board).data ?? null;
  const save = useSavePolicyMutation(board);
  const [edited, setEdited] = useState<PolicyFormValues | null>(null);
  if (record === null) return <Skeleton className="h-16 w-full" />;

  const saved = policyFormValues(record.policy);
  const values = listedModels(edited ?? saved);
  const errors = validatePolicyForm(values);

  async function submit(): Promise<void> {
    if (Object.keys(errors).length > 0) return;
    const result = await save.mutateAsync(policyPayload(values));
    if (result.ok) {
      setEdited(null);
      toast.success("Policy saved.");
    } else {
      toast.error(actionErrorCopy("Save policy", result.reason), {
        action: { label: "Try again", onClick: () => void submit() },
      });
    }
  }

  return (
    <PolicyForm
      boardName={record.name}
      values={values}
      errors={errors}
      loopOptions={loopModelOptions()}
      modelOptions={orchestratorModelOptions()}
      dirty={isPolicyDirty(values, saved)}
      pending={save.isPending}
      onChange={(patch) => setEdited({ ...values, ...patch })}
      onSubmit={() => void submit()}
    />
  );
}
