import type { BoardPolicy } from "../../../../shared/types.js";
import {
  DEFAULT_ORCHESTRATOR_MODEL,
  isLoopModel,
  isOrchestratorModel,
  normalizeOrchestratorModel,
} from "../../../../shared/orchestrator-models.js";
import {
  loopModelValue,
  SESSION_SETTINGS,
  storedLoopModel,
  type SelectOption,
} from "./orchestrator-models.js";

export interface PolicyFormValues {
  roadmapApproval: BoardPolicy["roadmapApproval"];
  concurrencyCap: string;
  loopModel: string;
  orchestratorModel: string;
  handoffPercent: string;
  handoffHardPercent: string;
  usageLimit: BoardPolicy["usageLimit"];
  shipRights: BoardPolicy["shipRights"];
  budgetPerGroup: string;
  supervisor: BoardPolicy["supervisor"];
  groupPlaybook: string | null;
  wakeMinutes: string;
}

export type PolicyFormErrors = Partial<
  Record<
    | "concurrencyCap"
    | "handoffPercent"
    | "handoffHardPercent"
    | "wakeMinutes"
    | "budgetPerGroup",
    string
  >
>;

export const ROADMAP_APPROVAL_OPTIONS: {
  value: BoardPolicy["roadmapApproval"];
  label: string;
}[] = [
  { value: "ask", label: "Ask me for each roadmap" },
  { value: "rules", label: "Approve when the rules pass, else ask" },
  { value: "all", label: "Approve each roadmap" },
];

export const USAGE_LIMIT_OPTIONS: {
  value: BoardPolicy["usageLimit"];
  label: string;
}[] = [
  { value: "wait", label: "Wait for the reset" },
  { value: "stop", label: "Stop and ask me" },
];

export const SHIP_RIGHTS_OPTIONS: {
  value: BoardPolicy["shipRights"];
  label: string;
}[] = [
  { value: "none", label: "None, I ship" },
  { value: "open_prs", label: "Open PRs" },
  { value: "merge", label: "Open and merge PRs" },
];

export const POLICY_ERRORS = {
  concurrencyCap: "Enter a number from 1 to 10.",
  handoffPercent: "Enter a number from 10 to 95.",
  handoffHardPercent: "Enter a number above the handoff percent.",
  wakeMinutes: "Enter a whole number from 0 to 1440.",
  budgetPerGroup: "Enter an amount above 0, or leave it empty for no limit.",
  budgetPerGroupMax: "Enter an amount of 100000 or less.",
} as const;

export const MAX_BUDGET_PER_GROUP = 100_000;

export const NO_GROUP_PLAYBOOK = "__none__";

/**
 * Build the Group playbook options: None, each playbook name, then the stored name if unlisted.
 *
 * @remarks
 * While `names` is undefined (the picker query is loading or failed) the stored name shows as a plain option.
 * Once the names are known, an unlisted stored name reads "<name> (not found)", so the select still shows it and a save keeps it.
 */
export function groupPlaybookOptions(
  names: readonly string[] | undefined,
  stored: string | null,
): SelectOption[] {
  const options: SelectOption[] = [
    { value: NO_GROUP_PLAYBOOK, label: "None" },
    ...(names ?? []).map((name) => ({ value: name, label: name })),
  ];
  if (stored !== null && !names?.includes(stored)) {
    options.push({
      value: stored,
      label: names === undefined ? stored : `${stored} (not found)`,
    });
  }
  return options;
}

/** Map the stored group playbook to the value of the select item. */
export function groupPlaybookSelectValue(stored: string | null): string {
  return stored ?? NO_GROUP_PLAYBOOK;
}

/** Map the value of the select item back to the group playbook, null for None. */
export function groupPlaybookFromSelect(value: string): string | null {
  return value === NO_GROUP_PLAYBOOK ? null : value;
}

/** Fill the form values from the stored board policy, with the legacy model name shown as Opus 5.5. */
export function policyFormValues(policy: BoardPolicy): PolicyFormValues {
  return {
    roadmapApproval: policy.roadmapApproval,
    concurrencyCap: String(policy.concurrencyCap),
    loopModel: loopModelValue(policy.loopModel),
    orchestratorModel: normalizeOrchestratorModel(policy.orchestratorModel),
    handoffPercent: String(policy.handoffPercent),
    handoffHardPercent: String(policy.handoffHardPercent),
    usageLimit: policy.usageLimit,
    shipRights: policy.shipRights,
    budgetPerGroup:
      policy.budgetPerGroup === null ? "" : String(policy.budgetPerGroup),
    supervisor: policy.supervisor,
    groupPlaybook: policy.groupPlaybook,
    wakeMinutes: String(policy.wakeMinutes),
  };
}

/**
 * Replace a model that is not on the shared list with the default option.
 *
 * @remarks
 * The saved values keep the stored model, so the form counts as changed and Save writes a valid value, which the policy route requires.
 */
export function listedModels(values: PolicyFormValues): PolicyFormValues {
  return {
    ...values,
    orchestratorModel: isOrchestratorModel(values.orchestratorModel)
      ? values.orchestratorModel
      : DEFAULT_ORCHESTRATOR_MODEL,
    loopModel: isLoopModel(storedLoopModel(values.loopModel))
      ? values.loopModel
      : SESSION_SETTINGS,
  };
}

function wholeNumber(text: string): number | null {
  return /^\d{1,6}$/.test(text.trim()) ? Number(text.trim()) : null;
}

function inRange(text: string, min: number, max: number): boolean {
  const n = wholeNumber(text);
  return n !== null && n >= min && n <= max;
}

function budgetAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Check the number fields of the policy form and return the contract error for each bad one.
 *
 * @remarks
 * The hard handoff has to be above the handoff percent, so it stays clean while the handoff percent itself is not a number.
 */
export function validatePolicyForm(values: PolicyFormValues): PolicyFormErrors {
  const errors: PolicyFormErrors = {};
  if (!inRange(values.concurrencyCap, 1, 10)) {
    errors.concurrencyCap = POLICY_ERRORS.concurrencyCap;
  }
  if (!inRange(values.handoffPercent, 10, 95)) {
    errors.handoffPercent = POLICY_ERRORS.handoffPercent;
  }
  const soft = wholeNumber(values.handoffPercent);
  const hard = wholeNumber(values.handoffHardPercent);
  if (hard === null || hard > 100 || (soft !== null && hard <= soft)) {
    errors.handoffHardPercent = POLICY_ERRORS.handoffHardPercent;
  }
  if (!inRange(values.wakeMinutes, 0, 1440)) {
    errors.wakeMinutes = POLICY_ERRORS.wakeMinutes;
  }
  const budget = budgetAmount(values.budgetPerGroup);
  if (budget !== null && !(budget > 0)) {
    errors.budgetPerGroup = POLICY_ERRORS.budgetPerGroup;
  } else if (budget !== null && budget > MAX_BUDGET_PER_GROUP) {
    errors.budgetPerGroup = POLICY_ERRORS.budgetPerGroupMax;
  }
  return errors;
}

/** True when a field of the form differs from the saved values. */
export function isPolicyDirty(
  values: PolicyFormValues,
  saved: PolicyFormValues,
): boolean {
  return (Object.keys(saved) as (keyof PolicyFormValues)[]).some(
    (key) => values[key] !== saved[key],
  );
}

/**
 * Build the body of the policy save: the twelve policy fields and nothing else.
 *
 * @remarks
 * `usageLimit` is `wait` or `stop`, so the body never holds a usage credits value.
 */
export function policyPayload(values: PolicyFormValues): BoardPolicy {
  return {
    roadmapApproval: values.roadmapApproval,
    concurrencyCap: Number(values.concurrencyCap),
    loopModel: storedLoopModel(values.loopModel),
    orchestratorModel: normalizeOrchestratorModel(values.orchestratorModel),
    handoffPercent: Number(values.handoffPercent),
    handoffHardPercent: Number(values.handoffHardPercent),
    usageLimit: values.usageLimit,
    shipRights: values.shipRights,
    budgetPerGroup: budgetAmount(values.budgetPerGroup),
    supervisor: values.supervisor,
    groupPlaybook: values.groupPlaybook,
    wakeMinutes: Number(values.wakeMinutes),
  };
}
