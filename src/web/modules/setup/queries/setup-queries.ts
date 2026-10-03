import { queryOptions, useMutation } from "@tanstack/react-query";
import { getSetup, runPrerequisiteInstall } from "./setup-api.js";

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

export function useRunPrerequisiteInstallMutation() {
  return useMutation({ mutationFn: runPrerequisiteInstall });
}
