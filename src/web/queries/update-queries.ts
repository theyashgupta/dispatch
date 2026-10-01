import { queryOptions } from "@tanstack/react-query";
import { getUpdateStatus } from "./update-api.js";

export const updateKeys = {
  all: ["update"] as const,
  status: ["update", "status"] as const,
};

export function updateStatusQueryOptions() {
  return queryOptions({
    queryKey: updateKeys.status,
    queryFn: getUpdateStatus,
  });
}
