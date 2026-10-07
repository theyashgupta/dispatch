import { queryOptions } from "@tanstack/react-query";
import { getAccounts } from "./accounts-api.js";

export const accountsKeys = {
  all: ["accounts"] as const,
  list: ["accounts", "list"] as const,
  login: ["accounts", "login"] as const,
  start: ["accounts", "login", "start"] as const,
};

export const ACCOUNTS_REFETCH_MS = 60_000;

/**
 * Read the accounts, refetching every minute and whenever the tab regains focus.
 *
 * @remarks
 * The poll reads the local API, which serves the server's cached usage, so it costs nothing
 * against the usage budget. Focus always refetches and a new observer never does, so the page and
 * the chip read as often as the one legacy hook did, whatever the shared 30 s staleTime says.
 */
export function accountsQueryOptions() {
  return queryOptions({
    queryKey: accountsKeys.list,
    queryFn: getAccounts,
    refetchInterval: ACCOUNTS_REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
    refetchOnMount: false,
  });
}
