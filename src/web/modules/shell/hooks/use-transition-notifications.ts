import { useEffect, useRef } from "react";
import type {
  BoardSnapshot,
  Column,
  ConnectionStatus,
} from "../../../../shared/types.js";
import { playChime } from "@/components/ui/hooks/chime";
import {
  INITIAL_NOTICE_STATE,
  noticeConnection,
  noticeSnapshot,
  noticeVisible,
  type NoticeState,
} from "@/modules/shell/domain/transition-notices";

const LABEL: Partial<Record<Column, string>> = {
  needs_input: "Needs Input",
  agent_done: "Agent Done",
};

const FALLBACK: Partial<Record<Column, string>> = {
  needs_input: "Waiting on your input",
  agent_done: "Agent finished",
};

/**
 * Fire one desktop notification per card that moves into an attention column, and at most one chime per batch.
 *
 * @remarks ATTN-01: the first snapshot after every connect or board change only seeds the previous
 * columns, so a reconnect or a switch to another board never notifies. PUSH-05: the `tag: card.id` and the
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
  const notices = useRef<NoticeState>(INITIAL_NOTICE_STATE);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    notices.current = noticeConnection(notices.current, connection);
  }, [connection]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        notices.current = noticeVisible(notices.current, Date.now());
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!board) return;
    const result = noticeSnapshot(notices.current, board, Date.now());
    notices.current = result.state;

    if (soundEnabled && result.notices.length > 0) playChime();

    const notifyGranted =
      "Notification" in window && Notification.permission === "granted";
    if (!notifyGranted) return;

    for (const card of result.notices) {
      const col = card.column;
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
  }, [board, onOpenCard, soundEnabled]);
}
