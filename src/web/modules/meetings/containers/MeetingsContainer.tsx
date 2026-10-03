import { useEffect, useMemo, useRef } from "react";
import type { Item } from "../../../../shared/types.js";
import { DetailPlaceholder, DetailScroll } from "@/components/DetailPaneBody";
import { SplitPane } from "@/components/SplitPane";
import { Button } from "@/components/ui/button";
import {
  CAROUSEL_QUERY,
  useMediaQuery,
} from "@/components/ui/hooks/use-media-query";
import { useSetItemStateMutation } from "@/queries/item-actions-queries";
import { MeetingList } from "@/modules/meetings/components/MeetingList";
import { MeetingsEmpty } from "@/modules/meetings/components/MeetingsEmpty";
import { meetingGroups } from "@/modules/meetings/domain/meetings";
import { MeetingDetailContainer } from "./MeetingDetailContainer";

interface MeetingsContainerProps {
  items: Item[];
  selectedId: string | undefined;
  onSelect: (id: string | null) => void;
  onOpenMeetingNotes: () => void;
  onNotice: (text: string) => void;
  onShowUndo: (label: string, undo: () => Promise<void>) => void;
  onStartPromoted: (cardId: string) => void;
}

export function MeetingsContainer({
  items,
  selectedId,
  onSelect,
  onOpenMeetingNotes,
  onNotice,
  onShowUndo,
  onStartPromoted,
}: MeetingsContainerProps) {
  const narrow = useMediaQuery(CAROUSEL_QUERY);
  const groups = useMemo(() => meetingGroups(items), [items]);
  const selected = items.find((item) => item.id === selectedId);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  });

  const markRead = useSetItemStateMutation();
  const unreadSelectedId =
    selected?.state === "unread" ? selected.id : undefined;
  const markReadAsync = markRead.mutateAsync;
  useEffect(() => {
    if (unreadSelectedId !== undefined) {
      markReadAsync({ itemId: unreadSelectedId, state: "read" }).catch(() => {
        onNotice("Couldn't mark this item read.");
      });
    }
  }, [unreadSelectedId, markReadAsync, onNotice]);

  if (items.length === 0) {
    return <MeetingsEmpty onOpenMeetingNotes={onOpenMeetingNotes} />;
  }

  const only = narrow ? (selectedId != null ? "detail" : "list") : undefined;

  return (
    <SplitPane
      only={only}
      list={
        <MeetingList
          groups={groups}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      }
      detail={
        selected ? (
          <MeetingDetailContainer
            key={selected.id}
            item={selected}
            onBack={narrow ? () => onSelect(null) : undefined}
            onNotice={onNotice}
            onShowUndo={onShowUndo}
            onStartPromoted={onStartPromoted}
            onActionComplete={() => {
              if (selectedIdRef.current === selected.id) onSelect(null);
            }}
          />
        ) : (
          <DetailScroll>
            {narrow && selectedId != null && (
              <div>
                <Button variant="secondary" onClick={() => onSelect(null)}>
                  Back
                </Button>
              </div>
            )}
            <DetailPlaceholder>Pick an action item.</DetailPlaceholder>
          </DetailScroll>
        )
      }
    />
  );
}
