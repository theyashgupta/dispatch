import type {
  GroupDimension,
  SortKey,
  SubgroupDimension,
} from "./orca-selectors.js";

export interface StoredChoice<T extends string> {
  key: string;
  allowed: readonly T[];
  fallback: T;
}

export const GROUP_CHOICE: StoredChoice<GroupDimension> = {
  key: "dsp.workspaceGroup",
  allowed: ["workspace"],
  fallback: "status",
};

export const SUBGROUP_CHOICE: StoredChoice<SubgroupDimension> = {
  key: "dsp.workspaceSubgroup",
  allowed: ["status", "workspace"],
  fallback: "none",
};

export const SORT_CHOICE: StoredChoice<SortKey> = {
  key: "dsp.workspaceSort",
  allowed: ["title"],
  fallback: "id",
};

/**
 * The Workspace choice a stored value selects.
 *
 * @remarks Only a non-default value is listed as allowed, so a missing, stale or default stored
 * value reads as the fallback, as legacy OrcaView.
 */
export function readChoice<T extends string>(
  choice: StoredChoice<T>,
  stored: string | null,
): T {
  return choice.allowed.find((value) => value === stored) ?? choice.fallback;
}
