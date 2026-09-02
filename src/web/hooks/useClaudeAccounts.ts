import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_CLAUDE_ACCOUNT_ID,
  type ClaudeAccountSummary,
} from "../../shared/types.js";
import {
  getAccounts,
  refreshAccountUsage,
  setActiveAccount,
} from "../lib/api.js";

const REFETCH_MS = 60_000;

export interface ClaudeAccountsState {
  activeId: string;
  accounts: ClaudeAccountSummary[];
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  switchAccount: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  refreshUsage: (
    id: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

/**
 * Accounts plus their usage snapshots for the header chip and the popover: fetched on mount,
 * refetched every minute and on window focus, and after every mutation.
 * @remarks The server owns the 15 minute endpoint cadence; this hook only polls the local API,
 * which serves the cache, so the interval costs nothing against the usage budget.
 */
export function useClaudeAccounts(): ClaudeAccountsState {
  const [activeId, setActiveId] = useState(DEFAULT_CLAUDE_ACCOUNT_ID);
  const [accounts, setAccounts] = useState<ClaudeAccountSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await getAccounts();
      setActiveId(data.activeId);
      setAccounts(data.accounts);
      setError(null);
    } catch {
      setError("Couldn't load Claude accounts.");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = setInterval(() => void reload(), REFETCH_MS);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const switchAccount = useCallback(
    async (id: string) => {
      const result = await setActiveAccount(id);
      await reload();
      return result;
    },
    [reload],
  );

  const refreshUsage = useCallback(
    async (id: string) => {
      const result = await refreshAccountUsage(id);
      await reload();
      return result.ok ? { ok: true as const } : result;
    },
    [reload],
  );

  return {
    activeId,
    accounts,
    loaded,
    error,
    reload,
    switchAccount,
    refreshUsage,
  };
}
