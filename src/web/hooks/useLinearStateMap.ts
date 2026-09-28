import { useEffect, useMemo, useState } from "react";
import {
  MAPPED_COLUMNS,
  resolveTargetState,
} from "../../shared/linear-state-map.js";
import type {
  LinearStateMap,
  LinearWorkflow,
  MappedColumn,
} from "../../shared/types.js";
import { getLinearStateMap, saveLinearStateMap } from "../lib/api.js";
import { useLinearWorkflow } from "./useLinearWorkflow.js";

/** Every team's six columns resolved against the saved map, so defaults show as chosen. */
function resolvedMap(
  workflow: LinearWorkflow,
  saved: LinearStateMap,
): LinearStateMap {
  return Object.fromEntries(
    workflow.teams.map((team) => [
      team.id,
      Object.fromEntries(
        MAPPED_COLUMNS.map((column) => [
          column,
          resolveTargetState(saved[team.id], team.states, column),
        ]),
      ),
    ]),
  );
}

/**
 * Load the Linear workflow and the saved state map, and hold the Settings edits and save state.
 *
 * @remarks Save writes every team's six columns explicitly (U4-11), so the defaults the user saw
 * become the stored choice.
 */
export function useLinearStateMap() {
  const workflow = useLinearWorkflow();
  const [saved, setSaved] = useState<LinearStateMap | null>(null);
  const [edits, setEdits] = useState<LinearStateMap>({});
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<
    { ok: true } | { ok: false; error: string } | null
  >(null);

  useEffect(() => {
    let live = true;
    getLinearStateMap().then(
      (map) => {
        if (live) setSaved(map);
      },
      () => {
        if (live) setLoadError(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const draft = useMemo(() => {
    if (workflow.status !== "ready" || !saved) return null;
    const base = resolvedMap(workflow.workflow, saved);
    return Object.fromEntries(
      Object.entries(base).map(([teamId, columns]) => [
        teamId,
        { ...columns, ...edits[teamId] },
      ]),
    );
  }, [workflow, saved, edits]);

  const handleChoose = (
    teamId: string,
    column: MappedColumn,
    value: string,
  ): void => {
    setSaveResult(null);
    setEdits((prev) => ({
      ...prev,
      [teamId]: { ...prev[teamId], [column]: value === "" ? null : value },
    }));
  };

  const handleSave = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    setSaveResult(await saveLinearStateMap(draft));
    setSaving(false);
  };

  return {
    workflow,
    draft,
    loadError,
    saving,
    saveResult,
    handleChoose,
    handleSave,
  };
}
