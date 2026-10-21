import type { ClaudeAccountSummary } from "../../../../shared/types.js";

/** Returns the first meta line of an account row: its Default kind, or its organization name. */
export function accountMeta(
  account: Pick<
    ClaudeAccountSummary,
    "managedDefault" | "isDefault" | "orgName"
  >,
): string {
  if (account.managedDefault) return "Default (Dispatch login)";
  if (account.isDefault) return "Default (your home login)";
  return account.orgName;
}
