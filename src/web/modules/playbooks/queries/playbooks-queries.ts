import { queryOptions, useQuery } from "@tanstack/react-query";
import { getPickerPlaybooks, getPlaybooks } from "./playbooks-api.js";

export const playbooksKeys = {
  all: ["playbooks"] as const,
  list: ["playbooks", "list"] as const,
  picker: ["playbooks", "picker"] as const,
};

export function playbooksQueryOptions() {
  return queryOptions({
    queryKey: playbooksKeys.list,
    queryFn: getPlaybooks,
  });
}

export function pickerPlaybooksQueryOptions() {
  return queryOptions({
    queryKey: playbooksKeys.picker,
    queryFn: getPickerPlaybooks,
  });
}

export function usePlaybooksQuery() {
  return useQuery(playbooksQueryOptions());
}
