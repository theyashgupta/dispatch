import { useEffect, useRef } from "react";
import type {
  BoardSnapshot,
  Column,
  ConnectionStatus,
} from "../../../../shared/types.js";
import { playChime } from "@/components/ui/hooks/chime";

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
 * Fire one desktop notification per card that moves into an attention column, and at most one chime per batch.
 *
 * @remarks ATTN-01: the first snapshot after every connect only seeds the previous columns, so a
 * reconnect that re-sends the whole board never notifies. PUSH-05: the `tag: card.id` and the
 * hyphen title must match the service worker push, so a tab and a push coalesce into one
 * notification.
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
        const title = `${card.identifier} - ${LABEL[col]}`;
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
