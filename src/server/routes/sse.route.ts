import { Router, type Request, type Response } from "express";
import { boardRepository as store } from "../store/board-repository.js";
import type {
  ActivityEvent,
  BoardSnapshot,
  TunnelState,
} from "../../shared/types.js";
import { DONE_PAGE_SIZE, parseDoneLimit } from "../../shared/done-limit.js";
import {
  getTunnelState,
  tunnelEmitter,
} from "../services/orchestration/tunnel.js";

/** A connected SSE client's current Done-page window (`BOARD-08`). */
interface ClientWindow {
  doneLimit: number;
}

/** Active SSE clients, each carrying its own window; broadcast writes to each and drops them on disconnect. */
const clients = new Map<Response, ClientWindow>();

const KEEPALIVE_MS = 15_000;

/**
 * Serialize a snapshot into one SSE data frame.
 * @remarks BOARD-04: the hand-rolled SSE transport — a module `Map<Response, ClientWindow>` of
 * clients, resync-on-connect, a per-connection-windowed `BoardSnapshot` broadcast on every store
 * "change" (`BOARD-08`), and a 15s NAMED `ping` heartbeat whose KEEPALIVE_MS must stay in
 * lockstep with the client's HEARTBEAT_MS watchdog (trips at 3× the window). No SSE library;
 * un-buffered; every write is safeWrite-guarded and dead clients pruned.
 * @see docs/ARCHITECTURE.md#sse-transport
 */
function frame(snapshot: BoardSnapshot): string {
  return `data: ${JSON.stringify(snapshot)}\n\n`;
}

/** Serialize one durably-inserted event into a NAMED `activity` SSE frame, distinct from the board `data:` frame. */
function activityFrame(event: ActivityEvent): string {
  return `event: activity\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Serialize a tunnel status transition into a NAMED `tunnel` SSE frame. */
function tunnelFrame(state: TunnelState): string {
  return `event: tunnel\ndata: ${JSON.stringify(state)}\n\n`;
}

/**
 * Write to a client only if its response stream is still alive. The socket can be torn
 * down a tick BEFORE the req "close" handler runs; a write in that window emits a stream
 * 'error' (ERR_STREAM_DESTROYED) that would crash the process if unhandled. Returns
 * whether the client is still usable so callers can drop dead ones.
 */
function safeWrite(res: Response, payload: string): boolean {
  if (res.destroyed || res.writableEnded) return false;
  res.write(payload);
  return true;
}

/**
 * Express handler for GET /api/stream.
 * @remarks `BOARD-08` / `T-82-01`: `doneLimit` is parsed ONCE at connect and never re-derived from
 * an un-windowed read of the store — an invalid or absent value falls back to
 * {@link DONE_PAGE_SIZE} rather than rejecting the connection, deliberately unlike the REST
 * route's 400: an `EventSource` retries a failed connect forever, so 400ing here would be an
 * infinite reconnect loop, not an actionable error. The parsed window is stored alongside the
 * client so every later broadcast (not just the resync frame below) re-applies it.
 */
export function sseHandler(req: Request, res: Response): void {
  res.on("error", () => {});

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const doneLimit = parseDoneLimit(req.query.doneLimit) ?? DONE_PAGE_SIZE;
  safeWrite(res, frame(store.snapshot({ doneLimit })));
  safeWrite(res, tunnelFrame(getTunnelState()));
  clients.set(res, { doneLimit });

  const keepAlive = setInterval(() => {
    if (!safeWrite(res, "event: ping\ndata: 1\n\n")) {
      clearInterval(keepAlive);
      clients.delete(res);
    }
  }, KEEPALIVE_MS);

  req.on("close", () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

/**
 * Board-change broadcast (`BOARD-08`). Unlike `activity`/`tunnel`, this listener receives NO
 * snapshot argument (see `board.store.ts#enqueue`) — it must build one PER DISTINCT `doneLimit`
 * among connected clients (a `byLimit` memo so N tabs at the same window still serialize once,
 * preserving the `## SSE fan-out` baseline's serialize-once-per-frame win in the common
 * single-window case) rather than trusting a single shared frame, which would silently prune
 * every client back to the default window the moment their limits diverge (load-more amnesia).
 */
function broadcastChange(): void {
  const byLimit = new Map<number, string>();
  for (const [client, window] of clients) {
    let payload = byLimit.get(window.doneLimit);
    if (payload == null) {
      payload = frame(store.snapshot({ doneLimit: window.doneLimit }));
      byLimit.set(window.doneLimit, payload);
    }
    if (!safeWrite(client, payload)) clients.delete(client);
  }
}

store.on("change", broadcastChange);

store.on("activity", (event: ActivityEvent) => {
  const payload = activityFrame(event);
  for (const client of clients.keys()) {
    if (!safeWrite(client, payload)) clients.delete(client);
  }
});

tunnelEmitter.on("change", (state: TunnelState) => {
  const payload = tunnelFrame(state);
  for (const client of clients.keys()) {
    if (!safeWrite(client, payload)) clients.delete(client);
  }
});

export const sseRouter = Router();

sseRouter.get("/stream", sseHandler);
