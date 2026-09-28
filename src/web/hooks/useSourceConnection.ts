import { useCallback, useEffect, useState } from "react";
import type {
  SourceCardStatus,
  SourceConnection,
  SourceKeyError,
} from "../../shared/types.js";
import {
  connectSource,
  deleteSourceKey,
  disableSource,
  getSourceConnection,
  saveSourceKey,
} from "../lib/api.js";
import { cardStatusFrom } from "../lib/connection-status.js";
import type { CredentialBusy } from "../primitives/CredentialForm.js";

export interface SourceConnectionState {
  connection: SourceConnection | null;
  startedConnected: boolean | null;
  status: SourceCardStatus;
  busy: CredentialBusy;
  formError: SourceKeyError | null;
  formProviderError: string | null;
  connect: (apiKey: string) => Promise<boolean>;
  connectExisting: () => Promise<void>;
  test: () => Promise<void>;
  disconnect: () => Promise<void>;
  disable: () => Promise<void>;
}

/**
 * One source's connection behind a connection card: status, connect or replace, use the existing
 * credential, test, pause, disconnect.
 *
 * @remarks `startedConnected` freezes the first result so a card picks its initial open state once
 * and never collapses under the user after that.
 */
export function useSourceConnection(
  source: string,
  copy?: Record<SourceKeyError, string>,
): SourceConnectionState {
  const [connection, setConnection] = useState<SourceConnection | null>(null);
  const [startedConnected, setStartedConnected] = useState<boolean | null>(
    null,
  );
  const [busy, setBusy] = useState<CredentialBusy>("load");
  const [formError, setFormError] = useState<SourceKeyError | null>(null);
  const [formProviderError, setFormProviderError] = useState<string | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const next = await getSourceConnection(source);
      setConnection(next);
      setStartedConnected((prev) => prev ?? next.connected);
    } catch {
      setStartedConnected((prev) => prev ?? false);
      setConnection((prev) => ({
        configured: prev?.configured ?? false,
        connected: false,
        ...(prev?.enabled !== undefined ? { enabled: prev.enabled } : {}),
        ...(prev?.account ? { account: prev.account } : {}),
        error: "unreachable",
      }));
    }
  }, [source]);

  useEffect(() => {
    void refresh().then(() => setBusy(null));
  }, [refresh]);

  const connect = useCallback(
    async (apiKey: string) => {
      setBusy("connect");
      setFormError(null);
      setFormProviderError(null);
      try {
        const result = await saveSourceKey(source, apiKey);
        if (!result.ok) {
          setFormError(result.reason);
          setFormProviderError(result.providerError ?? null);
          if (result.reason === "superseded" || result.reason === "failed") {
            await refresh();
          }
          return false;
        }
        setConnection({
          configured: true,
          connected: true,
          enabled: true,
          ...(result.account ? { account: result.account } : {}),
        });
        await refresh();
        return true;
      } catch {
        setFormError("unreachable");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [source, refresh],
  );

  const test = useCallback(async () => {
    setBusy("test");
    setFormError(null);
    setFormProviderError(null);
    await refresh();
    setBusy(null);
  }, [refresh]);

  const connectExisting = useCallback(async () => {
    setBusy("connect");
    setFormError(null);
    setFormProviderError(null);
    try {
      const result = await connectSource(source);
      if (!result.ok) {
        setFormError(result.reason);
        setFormProviderError(result.providerError ?? null);
        return;
      }
      await refresh();
    } catch {
      setFormError("unreachable");
    } finally {
      setBusy(null);
    }
  }, [source, refresh]);

  const disconnect = useCallback(async () => {
    setBusy("disconnect");
    setFormError(null);
    setFormProviderError(null);
    try {
      await deleteSourceKey(source);
    } catch {
      setFormError("failed");
      await refresh();
      setBusy(null);
      return;
    }
    setConnection({ configured: false, connected: false });
    await refresh();
    setBusy(null);
  }, [source, refresh]);

  const disable = useCallback(async () => {
    setBusy("connect");
    setFormError(null);
    setFormProviderError(null);
    try {
      await disableSource(source);
    } catch {
      setFormError("failed");
    }
    await refresh();
    setBusy(null);
  }, [source, refresh]);

  return {
    connection,
    startedConnected,
    status: cardStatusFrom(connection, copy),
    busy,
    formError,
    formProviderError,
    connect,
    connectExisting,
    test,
    disconnect,
    disable,
  };
}
