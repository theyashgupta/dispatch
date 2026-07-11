import { Router, type Request, type Response } from "express";
import { store } from "../store/board.store.js";
import type { BoardSnapshot } from "../../shared/types.js";

/** Active SSE clients; broadcast writes to each and drops them on disconnect. */
const clients = new Set<Response>();

const KEEPALIVE_MS = 15_000;

/**
 * Serialize a snapshot into one SSE data frame.
 * @remarks BOARD-04: the hand-rolled SSE transport — a module `Set` of clients, resync-on-connect,
 * a full-BoardSnapshot broadcast on every store "change", and a 15s NAMED `ping` heartbeat whose
 * KEEPALIVE_MS must stay in lockstep with the client's HEARTBEAT_MS watchdog (trips at 3× the
 * window). No SSE library; un-buffered; every write is safeWrite-guarded and dead clients pruned.
 * @see docs/ARCHITECTURE.md#sse-transport
 */
function frame(snapshot: BoardSnapshot): string {
  return `data: ${JSON.stringify(snapshot)}\n\n`;
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

/** Express handler for GET /api/events. */
export function sseHandler(req: Request, res: Response): void {
  res.on("error", () => {});

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  safeWrite(res, frame(store.snapshot()));
  clients.add(res);

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

store.on("change", (snapshot: BoardSnapshot) => {
  const payload = frame(snapshot);
  for (const client of clients) {
    if (!safeWrite(client, payload)) clients.delete(client);
  }
});

export const sseRouter = Router();

sseRouter.get("/events", sseHandler);
