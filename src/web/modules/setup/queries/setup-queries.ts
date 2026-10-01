import { queryOptions, useQuery } from "@tanstack/react-query";
import { getSetup } from "./setup-api.js";

export const setupKeys = {
  all: ["setup"] as const,
  status: ["setup", "status"] as const,
};

export function setupQueryOptions() {
  return queryOptions({
    queryKey: setupKeys.status,
    queryFn: getSetup,
  });
}

export function useSetupQuery() {
  return useQuery(setupQueryOptions());
}
