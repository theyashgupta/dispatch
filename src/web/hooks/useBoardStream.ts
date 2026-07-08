import { useEffect, useState } from "react";
import type { BoardSnapshot } from "../../shared/types.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface BoardStream {
  board: BoardSnapshot | null;
  connection: ConnectionStatus;
}

const HEARTBEAT_MS = 15_000;
const WATCHDOG_MS = HEARTBEAT_MS * 3;
const WATCHDOG_TICK_MS = 5_000;

const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 5_000;

export function useBoardStream(): BoardStream {
  const [board, setBoard] = useState<BoardSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let backoffMs = BACKOFF_START_MS;
    let lastEventAt = Date.now();
    let disposed = false;

    const scheduleReconnect = () => {
      if (disposed) return;
      if (es != null) {
        es.close();
        es = null;
      }
      setConnection("disconnected");
      if (reconnectTimer != null) return;
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (disposed) return;
      lastEventAt = Date.now();
      const src = new EventSource("/api/events");
      es = src;

      src.onopen = () => {
        lastEventAt = Date.now();
        setConnection("connected");
      };
      src.onmessage = (e) => {
        lastEventAt = Date.now();
        backoffMs = BACKOFF_START_MS;
        setBoard(JSON.parse(e.data) as BoardSnapshot);
        setConnection("connected");
      };
      src.addEventListener("ping", () => {
        lastEventAt = Date.now();
        setConnection("connected");
      });
      src.onerror = () => {
        if (es === src) scheduleReconnect();
      };
    };

    connect();

    watchdog = setInterval(() => {
      if (disposed) return;
      if (Date.now() - lastEventAt > WATCHDOG_MS) scheduleReconnect();
    }, WATCHDOG_TICK_MS);

    return () => {
      disposed = true;
      if (reconnectTimer != null) clearTimeout(reconnectTimer);
      if (watchdog != null) clearInterval(watchdog);
      if (es != null) es.close();
    };
  }, []);

  return { board, connection };
}
