import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { SystemMemory } from "../../shared/types.js";
import { getSystemMemory } from "./system-memory-api.js";

export const systemMemoryKeys = {
  reading: ["system-memory"] as const,
};

/** Build the query options that read the memory reading once. */
export function systemMemoryQueryOptions() {
  return queryOptions({
    queryKey: systemMemoryKeys.reading,
    queryFn: getSystemMemory,
  });
}

/** Write the body of a stream `memory` frame into the reading cache entry. */
export function applyMemoryFrame(
  queryClient: QueryClient,
  memory: SystemMemory,
): void {
  queryClient.setQueryData(systemMemoryKeys.reading, memory);
}
