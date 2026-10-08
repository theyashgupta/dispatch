import { Router, type Request, type Response } from "express";
import { boardRepository as store } from "../store/board-repository.js";
import type {
  ActivityEvent,
  BoardKey,
  BoardSnapshot,
  OrchestrationEvent,
  TunnelState,
} from "../../shared/types.js";
import { DONE_PAGE_SIZE, parseDoneLimit } from "../../shared/done-limit.js";
import {
  getTunnelState,
  tunnelEmitter,
} from "../services/orchestration/tunnel.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";
import { boardParamSchema } from "./boards-schemas.js";

interface ClientWindow {
  board: BoardKey;
  doneLimit: number;
}

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

/** Serialize an orchestration event into a NAMED `orchestration` SSE frame that holds only the board key and the event id. */
function orchestrationFrame(event: OrchestrationEvent): string {
  return `event: orchestration\ndata: ${JSON.stringify({ boardKey: event.boardKey, lastEventId: event.id })}\n\n`;
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
 * Pick the board a stream client follows from its `board` query parameter.
 *
 * @remarks Never throws: an absent, malformed, unknown or archived key falls back to the default
 * board, because an `EventSource` retries a rejected connect forever.
 */
function streamBoard(query: unknown): BoardKey {
  const parsed = boardParamSchema.safeParse(query);
  const key = parsed.success ? parsed.data.board : undefined;
  if (key == null) return DEFAULT_BOARD_KEY;
  const board = store.getBoard(key);
  return board && !board.archived ? key : DEFAULT_BOARD_KEY;
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
  const board = streamBoard(req.query);
  safeWrite(res, frame(store.snapshot(board, { doneLimit })));
  safeWrite(res, tunnelFrame(getTunnelState()));
  clients.set(res, { board, doneLimit });

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
 * snapshot argument (see `board.store.ts#enqueue`), so it must build one PER DISTINCT board and
 * `doneLimit` among connected clients (a memo keyed by both, so N tabs on one board at the same
 * window still serialize once, preserving the `## SSE fan-out` baseline's serialize-once-per-frame
 * win in the common case) rather than trusting a single shared frame, which would silently prune
 * every client back to the default window the moment their limits diverge (load-more amnesia).
 */
function broadcastChange(): void {
  const byWindow = new Map<string, string>();
  for (const [client, window] of clients) {
    const memoKey = `${window.board}:${window.doneLimit}`;
    let payload = byWindow.get(memoKey);
    if (payload == null) {
      payload = frame(
        store.snapshot(window.board, { doneLimit: window.doneLimit }),
      );
      byWindow.set(memoKey, payload);
    }
    if (!safeWrite(client, payload)) clients.delete(client);
  }
}

store.on("change", broadcastChange);

store.on("activity", (event: ActivityEvent) => {
  const payload = activityFrame(event);
  const board = event.boardKey ?? DEFAULT_BOARD_KEY;
  for (const [client, window] of clients) {
    if (window.board !== board) continue;
    if (!safeWrite(client, payload)) clients.delete(client);
  }
});

store.on("orchestration", (event: OrchestrationEvent) => {
  const payload = orchestrationFrame(event);
  for (const [client, window] of clients) {
    if (window.board !== event.boardKey) continue;
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
