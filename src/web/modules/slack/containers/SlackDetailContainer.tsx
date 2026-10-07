import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import {
  snoozeUntil,
  SNOOZE_LABELS,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import {
  usePromoteItemMutation,
  useSetItemStateMutation,
  useSnoozeItemMutation,
} from "@/queries/item-actions-queries";
import { SlackDetail } from "@/modules/slack/components/SlackDetail";
import { SlackThreadContainer } from "./SlackThreadContainer";
import {
  slackActions,
  type SlackActionId,
} from "@/modules/slack/domain/slack-actions";
import type { SlackRow } from "../../../../shared/slack-rows.js";
import { useDraftSlackReplyMutation } from "@/modules/slack/queries/slack-queries";

interface SlackDetailContainerProps {
  row: SlackRow;
  onBack?: () => void;
  onLeave: (id: string) => void;
  onNotice: (text: string) => void;
  onShowUndo: (label: string, undo: () => Promise<void>) => void;
  onCopyText: (text: string) => Promise<void>;
  onStartAgent: (target: { itemId: string }, prompt: string) => Promise<void>;
}

export function SlackDetailContainer({
  row,
  onBack,
  onLeave,
  onNotice,
  onShowUndo,
  onCopyText,
  onStartAgent,
}: SlackDetailContainerProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useAppStore(appStore, (s) => s.board);
  const promote = usePromoteItemMutation(board);
  const setState = useSetItemStateMutation();
  const snooze = useSnoozeItemMutation();
  const draftReply = useDraftSlackReplyMutation();

  const itemId = row.id;
  const prior = row.unread ? "unread" : "read";

  function showUndo(label: string) {
    onShowUndo(label, async () => {
      await setState.mutateAsync({ itemId, state: prior });
    });
  }

  async function submit(label: string, task: () => Promise<boolean>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const pressed = document.activeElement;
    setBusy(true);
    let leave = false;
    try {
      leave = await task();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      inFlight.current = false;
      flushSync(() => setBusy(false));
    }
    if (leave) onLeave(itemId);
    else if (
      pressed instanceof HTMLElement &&
      document.activeElement === document.body
    ) {
      pressed.focus();
    }
  }

  function handleAction(id: SlackActionId) {
    const label = slackActions(row).find((a) => a.id === id)?.label ?? id;
    if (id === "snooze") {
      setSnoozeOpen((open) => !open);
      return;
    }
    void submit(label, async () => {
      switch (id) {
        case "draftReply": {
          const prompt = await draftReply.mutateAsync(row.item);
          await onStartAgent({ itemId }, prompt);
          return false;
        }
        case "promote": {
          const { card } = await promote.mutateAsync({ itemId });
          onNotice(`Created ${card.identifier}`);
          return true;
        }
        case "done":
          await setState.mutateAsync({ itemId, state: "done" });
          showUndo(`${row.title} marked done`);
          return true;
        case "copyLink":
          if (!isWebUrl(row.url)) return false;
          await onCopyText(row.url);
          onNotice("Link copied");
          return false;
        default:
          return id satisfies never;
      }
    });
  }

  function handleSnooze(preset: SnoozePreset) {
    setSnoozeOpen(false);
    void submit("Snooze", async () => {
      await snooze.mutateAsync({
        itemId,
        until: snoozeUntil(preset, new Date()).toISOString(),
      });
      showUndo(`${row.title} snoozed for ${SNOOZE_LABELS[preset]}`);
      return true;
    });
  }

  return (
    <SlackDetail
      row={row}
      thread={
        row.item.meta.threadTs ? (
          <SlackThreadContainer
            itemId={itemId}
            replyCount={row.item.meta.replyCount}
          />
        ) : null
      }
      busy={busy}
      snoozeOpen={snoozeOpen}
      onBack={onBack}
      onAction={handleAction}
      onSnooze={handleSnooze}
    />
  );
}
