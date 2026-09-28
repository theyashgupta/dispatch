import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GranolaCheckResult,
  GranolaStatus,
  MeetingSourceConfig,
} from "../../shared/types.js";
import {
  checkGranola,
  getGranola,
  putGranola,
  runGranola,
} from "../lib/api.js";

const POLL_MS = 5_000;

export interface GranolaRoundState {
  status: GranolaStatus | null;
  saving: boolean;
  checking: boolean;
  check: GranolaCheckResult | null;
  loadFailed: boolean;
  setEnabled: (enabled: boolean) => Promise<void>;
  setWindow: (windowHours: number) => Promise<void>;
  checkConnection: () => Promise<void>;
  analyzeNow: () => Promise<void>;
}

/**
 * The Granola round behind its connection card: status, settings, check and Analyze now.
 *
 * @remarks Status is re-read on mount, after every action, and every 5 s only while a round runs,
 * so an idle Settings page makes no background requests. Only the newest request's answer is
 * applied, so a slow poll can never bring back "Analyzing meetings" after the round ended.
 */
export function useGranolaRound(): GranolaRoundState {
  const [status, setStatus] = useState<GranolaStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<GranolaCheckResult | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await getGranola();
      if (request !== latest.current) return;
      setStatus(next);
      setLoadFailed(false);
    } catch {
      if (request === latest.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.running === true;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [running, refresh]);

  const save = useCallback(
    async (patch: MeetingSourceConfig) => {
      setSaving(true);
      setCheck(null);
      const request = ++latest.current;
      try {
        const next = await putGranola(patch);
        if (request === latest.current) setStatus(next);
      } catch {
        await refresh();
      } finally {
        setSaving(false);
      }
    },
    [refresh],
  );

  const checkConnection = useCallback(async () => {
    setChecking(true);
    try {
      setCheck(await checkGranola());
    } catch {
      setCheck({ state: "failed" });
    } finally {
      setChecking(false);
    }
  }, []);

  const analyzeNow = useCallback(async () => {
    setCheck(null);
    await runGranola().catch(() => undefined);
    await refresh();
  }, [refresh]);

  return {
    status,
    saving,
    checking,
    check,
    loadFailed,
    setEnabled: (enabled) => save({ enabled }),
    setWindow: (windowHours) => save({ windowHours }),
    checkConnection,
    analyzeNow,
  };
}
