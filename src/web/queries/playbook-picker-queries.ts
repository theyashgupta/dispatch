import { queryOptions, useQuery } from "@tanstack/react-query";
import { getPickerPlaybooks } from "./playbook-picker-api.js";

export const playbookPickerKeys = {
  picker: ["playbooks", "picker"] as const,
};

/** Build the query options that read the start dialogs' playbook picker data. */
export function playbookPickerQueryOptions() {
  return queryOptions({
    queryKey: playbookPickerKeys.picker,
    queryFn: getPickerPlaybooks,
  });
}

/**
 * Read the playbooks the start dialogs offer, re-reading them on every mount.
 *
 * @remarks
 * The picker reflects the on-disk playbooks and the remembered default each time a dialog opens, so a cached read never stands in for it.
 */
export function usePlaybookPickerQuery() {
  return useQuery({
    ...playbookPickerQueryOptions(),
    refetchOnMount: "always",
  });
}
