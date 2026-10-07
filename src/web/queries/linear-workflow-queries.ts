import { queryOptions, useQuery } from "@tanstack/react-query";
import { getLinearWorkflow } from "./linear-workflow-api.js";

export const linearWorkflowKeys = {
  all: ["linear-workflow"] as const,
};

/**
 * Build the options of the shared Linear workflow query.
 *
 * @remarks
 * The workflow loads once per page and stays fresh. A failed load throws its copy, so it is never
 * cached as a result and the next mount retries.
 */
export function linearWorkflowQueryOptions() {
  return queryOptions({
    queryKey: linearWorkflowKeys.all,
    queryFn: async () => {
      const result = await getLinearWorkflow();
      if (!result.ok) throw new Error(result.error);
      return result.workflow;
    },
    staleTime: Infinity,
  });
}

export function useLinearWorkflowQuery() {
  return useQuery(linearWorkflowQueryOptions());
}
