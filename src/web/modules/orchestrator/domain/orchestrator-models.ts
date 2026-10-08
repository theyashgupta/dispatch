import {
  LOOP_EFFORTS,
  ORCHESTRATOR_MODELS,
} from "../../../../shared/orchestrator-models.js";

export interface SelectOption {
  value: string;
  label: string;
}

export const SESSION_SETTINGS = "session-settings";

/** The options of the Orchestrator model select: each model of the shared list. */
export function orchestratorModelOptions(): SelectOption[] {
  return ORCHESTRATOR_MODELS.map((m) => ({ value: m.id, label: m.label }));
}

/** The options of the Loop model select: Session settings, then each model with the effort `high` or `max`. */
export function loopModelOptions(): SelectOption[] {
  return [
    { value: SESSION_SETTINGS, label: "Session settings" },
    ...ORCHESTRATOR_MODELS.flatMap((m) =>
      LOOP_EFFORTS.map((effort) => ({
        value: `${m.id}:${effort}`,
        label: `${m.label}, ${effort} effort`,
      })),
    ),
  ];
}

/** Turn the stored loop model into the value of the select. */
export function loopModelValue(stored: string | null): string {
  return stored ?? SESSION_SETTINGS;
}

/** Turn the value of the loop model select into the stored loop model. */
export function storedLoopModel(value: string): string | null {
  return value === SESSION_SETTINGS ? null : value;
}
