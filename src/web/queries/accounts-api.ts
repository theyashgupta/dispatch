import type {
  AccountSessionEntry,
  ChainView,
  ClaudeAccountSummary,
} from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Fetch every Claude account with its usage snapshot plus the active pointer: GET /api/accounts.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getAccounts(): Promise<{
  activeId: string;
  accounts: ClaudeAccountSummary[];
  sessions: AccountSessionEntry[];
  chain: ChainView;
  managedDefaultOffer: boolean;
}> {
  const result = await http<{
    activeId: string;
    accounts: ClaudeAccountSummary[];
    sessions: AccountSessionEntry[];
    chain: ChainView;
    managedDefaultOffer?: boolean;
  }>("/api/accounts");
  if (!result.ok) {
    throw httpError("getAccounts", result);
  }
  return {
    ...result.data,
    managedDefaultOffer: result.data.managedDefaultOffer === true,
  };
}
