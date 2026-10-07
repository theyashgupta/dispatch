import { useState } from "react";
import type { LinearStateMap, MappedColumn } from "../../../../shared/types.js";
import { LinearStateMapRows } from "@/modules/connections/components/LinearStateMapRows";
import {
  chooseState,
  stateMapDraft,
} from "@/modules/connections/domain/linear-state-map";
import {
  useLinearStateMapQuery,
  useSaveLinearStateMapMutation,
} from "@/modules/connections/queries/connections-queries";
import { useLinearWorkflowQuery } from "@/queries/linear-workflow-queries";

export function LinearStateMapContainer() {
  const workflowQuery = useLinearWorkflowQuery();
  const savedQuery = useLinearStateMapQuery();
  const save = useSaveLinearStateMapMutation();
  const [edits, setEdits] = useState<LinearStateMap>({});

  const ready = workflowQuery.data ?? null;
  const draft =
    ready && savedQuery.data
      ? stateMapDraft(ready, savedQuery.data, edits)
      : null;

  const handleChoose = (
    teamId: string,
    column: MappedColumn,
    value: string,
  ) => {
    save.reset();
    setEdits((prev) => chooseState(prev, teamId, column, value));
  };

  return (
    <LinearStateMapRows
      workflowError={workflowQuery.isError ? workflowQuery.error.message : null}
      loadError={savedQuery.isError}
      teams={ready?.teams ?? null}
      draft={draft}
      saving={save.isPending}
      saveResult={save.data ?? null}
      onChoose={handleChoose}
      onSave={() => {
        if (draft) save.mutate(draft);
      }}
    />
  );
}
