import { queryOptions, useQuery } from "@tanstack/react-query";
import { getAccounts, getLoginState } from "./accounts-api.js";

export const accountsKeys = {
  all: ["accounts"] as const,
  list: ["accounts", "list"] as const,
  login: ["accounts", "login"] as const,
};

export function accountsQueryOptions() {
  return queryOptions({
    queryKey: accountsKeys.list,
    queryFn: getAccounts,
  });
}

export function loginStateQueryOptions() {
  return queryOptions({
    queryKey: accountsKeys.login,
    queryFn: getLoginState,
  });
}

export function useAccountsQuery() {
  return useQuery(accountsQueryOptions());
}
