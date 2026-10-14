import { useState } from "react";
import type { BoardKey } from "../../../../shared/types.js";
import {
  controlFor,
  failureCopy,
  startFailureFor,
  type ControlKind,
  type OrchestratorView,
} from "@/modules/orchestrator/domain/centre-model";
import {
  useBoardRecordQuery,
  useLifecycleMutation,
} from "@/modules/orchestrator/queries/orchestrator-queries";

/**
 * Give the Start, Stop or Resume control of one record, the action that runs it and the line of its last failure, which also covers a start that failed in the background.
 *
 * @remarks A board with no record gets Start, and the run adds the main orchestrator first.
 */
export function useCentreControl(
  board: BoardKey,
  record: OrchestratorView | null,
  stale: boolean,
) {
  const supervisor = useBoardRecordQuery(board).data?.policy.supervisor ?? "on";
  const lifecycle = useLifecycleMutation(board);
  const recordId = record?.id ?? null;
  const [mutationFailure, setFailure] = useState<{
    kind: ControlKind;
    reason: string;
    recordId: string | null;
  } | null>(null);
  const failure =
    mutationFailure?.recordId === recordId ? mutationFailure : null;
  const control = controlFor(record, {
    supervisor,
    stale,
    pending: lifecycle.isPending ? lifecycle.variables.kind : null,
  });

  async function run(kind: ControlKind) {
    setFailure(null);
    const result = await lifecycle.mutateAsync({
      kind,
      id: record?.id ?? "main",
      hasRecord: record !== null,
    });
    if (!result.ok) setFailure({ kind, reason: result.reason, recordId });
  }

  const backgroundFailure =
    control?.kind === "start" ? startFailureFor(record) : null;

  return {
    control,
    run,
    failure:
      failure === null
        ? backgroundFailure
        : failureCopy(failure.kind, failure.reason),
    retryFailed: () => {
      if (failure !== null) void run(failure.kind);
      else if (backgroundFailure !== null) void run("start");
    },
    pending: lifecycle.isPending,
  };
}
