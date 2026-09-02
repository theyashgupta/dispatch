import type { ClaudeAccountSummary } from "../../../shared/types.js";
import {
  logoutClaudeConfigDir,
  readClaudeIdentity,
  type ClaudeIdentity,
} from "../../adapters/claude-cli.js";
import {
  accountDir,
  listAccounts,
  readRegistry,
  removeAccount,
} from "../domain/claude-accounts.js";
import { forgetUsage, getUsage } from "./claude-usage.js";

const IDENTITY_TTL_MS = 5 * 60 * 1000;

let homeIdentityCache: { at: number; identity: ClaudeIdentity } | null = null;

/**
 * The home login's identity, cached for five minutes because every read spawns the CLI.
 */
export async function homeIdentity(): Promise<ClaudeIdentity> {
  if (
    homeIdentityCache &&
    Date.now() - homeIdentityCache.at < IDENTITY_TTL_MS
  ) {
    return homeIdentityCache.identity;
  }
  const identity = await readClaudeIdentity();
  homeIdentityCache = { at: Date.now(), identity };
  return identity;
}

/**
 * Every account with its cached usage snapshot, the shape `GET /api/accounts` returns.
 */
export async function listAccountSummaries(): Promise<ClaudeAccountSummary[]> {
  const accounts = await listAccounts(await homeIdentity());
  return accounts.map((a) => ({ ...a, usage: getUsage(a.id) }));
}

/**
 * Remove an added account end to end: sign its dir out so Claude Code deletes its own keychain
 * item, then drop the dir, the registry record, and the cached usage.
 */
export async function removeAccountAndLogout(
  id: string,
): Promise<{ ok: true } | { ok: false; error: "not-found" }> {
  const known = (await readRegistry()).some((a) => a.id === id);
  if (!known) return { ok: false, error: "not-found" };
  await logoutClaudeConfigDir(accountDir(id));
  const result = await removeAccount(id);
  if (result.ok) forgetUsage(id);
  return result;
}
