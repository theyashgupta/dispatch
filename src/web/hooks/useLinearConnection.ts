import { useCallback, useEffect, useState } from "react";
import type {
  SourceCardStatus,
  SourceConnection,
  SourceKeyError,
} from "../../shared/types.js";
import {
  deleteSourceKey,
  getSourceConnection,
  saveSourceKey,
} from "../lib/api.js";
import { cardStatusFrom } from "../lib/connection-status.js";
import type { CredentialBusy } from "../primitives/CredentialForm.js";

export interface LinearConnectionState {
  connection: SourceConnection | null;
  startedConnected: boolean | null;
  status: SourceCardStatus;
  busy: CredentialBusy;
  formError: SourceKeyError | null;
  connect: (apiKey: string) => Promise<boolean>;
  test: () => Promise<void>;
  disconnect: () => Promise<void>;
}

/**
 * The Linear connection behind a connection card: status, connect or replace, test, disconnect.
 *
 * @remarks `startedConnected` freezes the first result so a card picks its initial open state once
 * and never collapses under the user after that.
 */
export function useLinearConnection(): LinearConnectionState {
  const [connection, setConnection] = useState<SourceConnection | null>(null);
  const [startedConnected, setStartedConnected] = useState<boolean | null>(
    null,
  );
  const [busy, setBusy] = useState<CredentialBusy>("load");
  const [formError, setFormError] = useState<SourceKeyError | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getSourceConnection("linear");
      setConnection(next);
      setStartedConnected((prev) => prev ?? next.connected);
    } catch {
      setStartedConnected((prev) => prev ?? false);
      setConnection((prev) => ({
        configured: prev?.configured ?? false,
        connected: false,
        error: "unreachable",
      }));
    }
  }, []);

  useEffect(() => {
    void refresh().then(() => setBusy(null));
  }, [refresh]);

  const connect = useCallback(
    async (apiKey: string) => {
      setBusy("connect");
      setFormError(null);
      try {
        const result = await saveSourceKey("linear", apiKey);
        if (!result.ok) {
          setFormError(result.reason);
          if (result.reason === "superseded") await refresh();
          return false;
        }
        setConnection(
          result.account
            ? { configured: true, connected: true, account: result.account }
            : { configured: true, connected: true },
        );
        return true;
      } catch {
        setFormError("unreachable");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const test = useCallback(async () => {
    setBusy("test");
    setFormError(null);
    await refresh();
    setBusy(null);
  }, [refresh]);

  const disconnect = useCallback(async () => {
    setBusy("disconnect");
    setFormError(null);
    try {
      await deleteSourceKey("linear");
      setConnection({ configured: false, connected: false });
    } catch {
      setFormError("failed");
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    connection,
    startedConnected,
    status: cardStatusFrom(connection),
    busy,
    formError,
    connect,
    test,
    disconnect,
  };
}
