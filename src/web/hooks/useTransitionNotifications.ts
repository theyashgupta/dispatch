import { useEffect, useRef } from "react";
import type { BoardSnapshot, Column } from "../../shared/types.js";
import { playChime } from "../lib/chime.js";
import type { ConnectionStatus } from "./useBoardStream.js";

const LABEL: Partial<Record<Column, string>> = {
  needs_input: "Needs Input",
  agent_done: "Agent Done",
};

const FALLBACK: Partial<Record<Column, string>> = {
  needs_input: "Waiting on your input",
  agent_done: "Agent finished",
};

function isAttentionColumn(col: Column): col is "needs_input" | "agent_done" {
  return col === "needs_input" || col === "agent_done";
}

/**
 * Fire one desktop notification, plus (independently) at most one chime, per batch of genuine
 * card transitions into an attention column.
 * @remarks ATTN-01: seed-on-reconnect is the load-bearing discipline — the first snapshot after
 * connect/reconnect only SEEDS the per-card previous-column ref (never notifies), and `seeded` is
 * reset on every disconnect, so a backend reboot or SSE reconnect (which re-broadcasts the full
 * board) can never spam notifications or the chime. Permission is requested once; a
 * denied/unsupported/throwing surface is silently absent so a cosmetic notification never crashes
 * the board. The chime is gated by `soundEnabled` (Settings ▸ Notifications) independently of the
 * Notification permission — a user may want one without the other — and plays at most ONCE per
 * effect run even when several cards transition in the same snapshot (e.g. two agents finish at
 * once), so a burst of arrivals stays a single gentle ding rather than an overlapping barrage;
 * each transitioned card still gets its own desktop Notification.
 * @see docs/ARCHITECTURE.md#attention-routing
 */
export function useTransitionNotifications(
  board: BoardSnapshot | null,
  connection: ConnectionStatus,
  onOpenCard: (id: string) => void,
  soundEnabled: boolean,
): void {
  const prevCols = useRef(new Map<string, Column>());
  const seeded = useRef(false);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (connection !== "connected") seeded.current = false;
  }, [connection]);

  useEffect(() => {
    if (!board) return;
    const next = new Map<string, Column>(
      board.cards.map((c) => [c.id, c.column]),
    );

    if (!seeded.current) {
      prevCols.current = next;
      seeded.current = true;
      return;
    }

    const notifyGranted =
      "Notification" in window && Notification.permission === "granted";
    let chimed = false;

    for (const card of board.cards) {
      const prev = prevCols.current.get(card.id);
      const col = card.column;
      if (col === prev || !isAttentionColumn(col)) continue;

      if (soundEnabled && !chimed) {
        playChime();
        chimed = true;
      }

      if (notifyGranted) {
        const title = `${card.identifier} — ${LABEL[col]}`;
        const body = card.statusReason?.trim() || FALLBACK[col] || "";
        try {
          const n = new Notification(title, { body, tag: card.id });
          n.onclick = () => {
            window.focus();
            onOpenCard(card.id);
            n.close();
          };
        } catch {}
      }
    }

    prevCols.current = next;
  }, [board, onOpenCard, soundEnabled]);
}
