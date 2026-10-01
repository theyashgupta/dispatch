import { queryOptions, useQuery } from "@tanstack/react-query";
import { listArchive } from "./archive-api.js";

export const archiveKeys = {
  all: ["archive"] as const,
  list: ["archive", "list"] as const,
};

export function archiveQueryOptions() {
  return queryOptions({
    queryKey: archiveKeys.list,
    queryFn: listArchive,
  });
}

export function useArchiveQuery() {
  return useQuery(archiveQueryOptions());
}
