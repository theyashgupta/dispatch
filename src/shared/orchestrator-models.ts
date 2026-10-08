export const ORCHESTRATOR_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
] as const;

export const LOOP_EFFORTS = ["high", "max"] as const;

export const DEFAULT_ORCHESTRATOR_MODEL = ORCHESTRATOR_MODELS[0].id;

export const LOOP_MODEL_VALUES: readonly string[] = ORCHESTRATOR_MODELS.flatMap(
  (m) => LOOP_EFFORTS.map((effort) => `${m.id}:${effort}`),
);

const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  opus: DEFAULT_ORCHESTRATOR_MODEL,
};

/** Map the legacy stored name `opus` to Opus 5.5 and keep every other value as it is. */
export function normalizeOrchestratorModel(value: string): string {
  return Object.hasOwn(LEGACY_ALIASES, value) ? LEGACY_ALIASES[value] : value;
}

/**
 * True when a value is an orchestrator model of the list, the legacy name `opus` included.
 *
 * @remarks
 * The policy route uses it, so no board policy can hold a model that the list does not name.
 */
export function isOrchestratorModel(value: string): boolean {
  const id = normalizeOrchestratorModel(value);
  return ORCHESTRATOR_MODELS.some((m) => m.id === id);
}

/** True when a value is `null` (session settings) or one of the loop model values of the list. */
export function isLoopModel(value: string | null): boolean {
  return value === null || LOOP_MODEL_VALUES.includes(value);
}
