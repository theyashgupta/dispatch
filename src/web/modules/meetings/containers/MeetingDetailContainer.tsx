import { useRef, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import type { Item } from "../../../../shared/types.js";
import {
  SNOOZE_LABELS,
  snoozeUntil,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import {
  usePromoteItemMutation,
  useSetItemStateMutation,
  useSnoozeItemMutation,
} from "@/queries/item-actions-queries";
import { MeetingDetail } from "@/modules/meetings/components/MeetingDetail";
import { MeetingTranscriptContainer } from "./MeetingTranscriptContainer";
import { parseSiblings } from "@/modules/meetings/domain/meetings";
import { useRunMeetingAgentMutation } from "@/modules/meetings/queries/meetings-queries";

interface MeetingDetailContainerProps {
  item: Item;
  onBack?: () => void;
  onNotice: (text: string) => void;
  onShowUndo: (label: string, undo: () => Promise<void>) => void;
  onStartPromoted: (cardId: string) => void;
  onActionComplete: () => void;
}

export function MeetingDetailContainer({
  item,
  onBack,
  onNotice,
  onShowUndo,
  onStartPromoted,
  onActionComplete,
}: MeetingDetailContainerProps) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useAppStore(appStore, (s) => s.board);
  const promote = usePromoteItemMutation(board);
  const runAgent = useRunMeetingAgentMutation(board);
  const setState = useSetItemStateMutation();
  const snooze = useSnoozeItemMutation();
  const prior = item.state === "unread" ? "unread" : "read";

  async function submit(task: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await task();
      onActionComplete();
    } catch {
      onNotice("Couldn't update this item.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function showUndo(label: string) {
    onShowUndo(label, async () => {
      await setState.mutateAsync({ itemId: item.id, state: prior });
    });
  }

  async function promoteTask() {
    const { card } = await promote.mutateAsync({ itemId: item.id });
    onNotice(`Created ${card.identifier}`);
  }

  async function runAgentTask() {
    const { card, moved } = await runAgent.mutateAsync({ itemId: item.id });
    if (!moved) {
      onNotice(`Created ${card.identifier}, but couldn't move it to To Do.`);
      return;
    }
    onStartPromoted(card.id);
  }

  async function doneTask() {
    await setState.mutateAsync({ itemId: item.id, state: "done" });
    showUndo(`${item.title} marked done`);
  }

  async function snoozeTask(preset: SnoozePreset) {
    await snooze.mutateAsync({
      itemId: item.id,
      until: snoozeUntil(preset, new Date()).toISOString(),
    });
    showUndo(`${item.title} snoozed for ${SNOOZE_LABELS[preset]}`);
  }

  return (
    <MeetingDetail
      item={item}
      siblings={parseSiblings(item.meta.siblings)}
      transcript={
        item.meta.transcript === "paste" ? (
          <MeetingTranscriptContainer meetingId={item.meta.meetingId} />
        ) : null
      }
      busy={busy}
      onBack={onBack}
      onPromote={() => void submit(promoteTask)}
      onRunAgent={() => void submit(runAgentTask)}
      onDone={() => void submit(doneTask)}
      onSnooze={(preset) => void submit(() => snoozeTask(preset))}
    />
  );
}
