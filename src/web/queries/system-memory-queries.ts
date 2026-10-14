import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import type { SystemMemory } from "../../shared/types.js";
import { getSystemMemory } from "./system-memory-api.js";

export const systemMemoryKeys = {
  reading: ["system-memory"] as const,
};

export function systemMemoryQueryOptions() {
  return queryOptions({
    queryKey: systemMemoryKeys.reading,
    queryFn: getSystemMemory,
  });
}

export function useSystemMemoryQuery() {
  return useQuery(systemMemoryQueryOptions());
}

export function applyMemoryFrame(
  queryClient: QueryClient,
  memory: SystemMemory,
): void {
  queryClient.setQueryData(systemMemoryKeys.reading, memory);
}
