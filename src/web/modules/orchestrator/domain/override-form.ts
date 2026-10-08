import type {
  BoardPolicy,
  OrchestratorPolicyOverride,
} from "../../../../shared/types.js";
import type { SelectOption } from "./orchestrator-models.js";
import {
  ROADMAP_APPROVAL_OPTIONS,
  SHIP_RIGHTS_OPTIONS,
  USAGE_LIMIT_OPTIONS,
} from "./policy-form.js";

export const SAME_AS_BOARD = "same";

export interface OverrideValues {
  roadmapApproval: string;
  concurrencyCap: string;
  usageLimit: string;
  shipRights: string;
  budgetPerGroup: string;
}

export interface OverrideOptions {
  roadmapApproval: SelectOption[];
  concurrencyCap: SelectOption[];
  usageLimit: SelectOption[];
  shipRights: SelectOption[];
}

export interface OverrideErrors {
  budgetPerGroup?: string;
}

export const OVERRIDE_ERRORS = {
  aboveBoard: "Enter an amount at or below the board budget.",
  notPositive:
    "Enter an amount above 0, or leave it empty to use the board budget.",
} as const;

const SAME_OPTION: SelectOption = {
  value: SAME_AS_BOARD,
  label: "Same as board",
};

const NARROW_ORDER = {
  roadmapApproval: ["all", "rules", "ask"],
  usageLimit: ["wait", "stop"],
  shipRights: ["merge", "open_prs", "none"],
} as const;

function narrower(
  order: readonly string[],
  labels: readonly SelectOption[],
  board: string,
): SelectOption[] {
  const rest = order.slice(order.indexOf(board) + 1);
  return rest.map((value) => ({
    value,
    label: labels.find((o) => o.value === value)?.label ?? value,
  }));
}

/**
 * The option lists of the override selects, narrow values only, each led by "Same as board".
 *
 * @remarks
 * Each list holds only values strictly narrower than the board value, so a wider override cannot be picked. A board at the narrowest value leaves "Same as board" alone.
 */
export function overrideOptions(policy: BoardPolicy): OverrideOptions {
  const caps: SelectOption[] = [];
  for (let n = policy.concurrencyCap - 1; n >= 1; n--) {
    caps.push({ value: String(n), label: String(n) });
  }
  return {
    roadmapApproval: [
      SAME_OPTION,
      ...narrower(
        NARROW_ORDER.roadmapApproval,
        ROADMAP_APPROVAL_OPTIONS,
        policy.roadmapApproval,
      ),
    ],
    concurrencyCap: [SAME_OPTION, ...caps],
    usageLimit: [
      SAME_OPTION,
      ...narrower(
        NARROW_ORDER.usageLimit,
        USAGE_LIMIT_OPTIONS,
        policy.usageLimit,
      ),
    ],
    shipRights: [
      SAME_OPTION,
      ...narrower(
        NARROW_ORDER.shipRights,
        SHIP_RIGHTS_OPTIONS,
        policy.shipRights,
      ),
    ],
  };
}

/** The values of a form with every field on "Same as board" and the budget empty. */
export function emptyOverrideValues(): OverrideValues {
  return {
    roadmapApproval: SAME_AS_BOARD,
    concurrencyCap: SAME_AS_BOARD,
    usageLimit: SAME_AS_BOARD,
    shipRights: SAME_AS_BOARD,
    budgetPerGroup: "",
  };
}

function pick(
  options: SelectOption[],
  value: string | number | undefined,
): string {
  const text = value === undefined ? SAME_AS_BOARD : String(value);
  return options.some((o) => o.value === text) ? text : SAME_AS_BOARD;
}

/**
 * Fill the form from a saved override.
 *
 * @remarks
 * A saved value that is no longer narrower than the board shows as "Same as board", because the board narrowed after the override was saved.
 */
export function overrideValues(
  override: OrchestratorPolicyOverride,
  policy: BoardPolicy,
): OverrideValues {
  const options = overrideOptions(policy);
  return {
    roadmapApproval: pick(options.roadmapApproval, override.roadmapApproval),
    concurrencyCap: pick(options.concurrencyCap, override.concurrencyCap),
    usageLimit: pick(options.usageLimit, override.usageLimit),
    shipRights: pick(options.shipRights, override.shipRights),
    budgetPerGroup:
      typeof override.budgetPerGroup === "number"
        ? String(override.budgetPerGroup)
        : "",
  };
}

/** Check the budget field against the board budget; an empty field means "Same as board". */
export function validateOverride(
  values: OverrideValues,
  policy: BoardPolicy,
): OverrideErrors {
  const text = values.budgetPerGroup.trim();
  if (text === "") return {};
  const amount = Number(text);
  if (!(amount > 0)) return { budgetPerGroup: OVERRIDE_ERRORS.notPositive };
  if (policy.budgetPerGroup !== null && amount > policy.budgetPerGroup) {
    return { budgetPerGroup: OVERRIDE_ERRORS.aboveBoard };
  }
  return {};
}

/** True when a field of the form differs from the saved values. */
export function isOverrideDirty(
  values: OverrideValues,
  saved: OverrideValues,
): boolean {
  return (Object.keys(saved) as (keyof OverrideValues)[]).some(
    (key) => values[key].trim() !== saved[key].trim(),
  );
}

/**
 * Build the override of a save: only the fields that are not "Same as board".
 *
 * @remarks
 * The edit route replaces the whole override, so a field set back to "Same as board" leaves the body and the server drops it.
 */
export function overridePayload(
  values: OverrideValues,
): OrchestratorPolicyOverride {
  const override: OrchestratorPolicyOverride = {};
  if (values.roadmapApproval !== SAME_AS_BOARD) {
    override.roadmapApproval =
      values.roadmapApproval as BoardPolicy["roadmapApproval"];
  }
  if (values.concurrencyCap !== SAME_AS_BOARD) {
    override.concurrencyCap = Number(values.concurrencyCap);
  }
  if (values.usageLimit !== SAME_AS_BOARD) {
    override.usageLimit = values.usageLimit as BoardPolicy["usageLimit"];
  }
  if (values.shipRights !== SAME_AS_BOARD) {
    override.shipRights = values.shipRights as BoardPolicy["shipRights"];
  }
  if (values.budgetPerGroup.trim() !== "") {
    override.budgetPerGroup = Number(values.budgetPerGroup);
  }
  return override;
}
