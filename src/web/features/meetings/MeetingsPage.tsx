import { useEffect, useRef, type CSSProperties } from "react";
import type { Item } from "../../../shared/types.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import type { ActionServices } from "../../lib/actions.js";
import { meetingGroups } from "../../lib/meetings.js";
import { Button } from "../../primitives/Button.js";
import { MeetingDetail } from "./MeetingDetail.js";
import { MeetingList } from "./MeetingList.js";

interface MeetingsPageProps {
  items: Item[];
  selectedId: string | undefined;
  onSelect: (id: string | null) => void;
  onOpenMeetingNotes: () => void;
  services: ActionServices;
  onStartPromoted: (cardId: string) => void;
}

const frameStyle: CSSProperties = {
  display: "flex",
  height: "100%",
  minWidth: 0,
};

const paneStyle: CSSProperties = {
  minWidth: 0,
  overflowY: "auto",
};

const listPaneStyle: CSSProperties = {
  ...paneStyle,
  flex: "1 1 auto",
  padding: "var(--space-sm) var(--space-lg)",
};

const wideListPaneStyle: CSSProperties = {
  ...listPaneStyle,
  flex: "0 0 480px",
  borderRight: "1px solid var(--border)",
};

const detailPaneStyle: CSSProperties = {
  ...paneStyle,
  flex: "1 1 auto",
  padding: "var(--space-lg)",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  alignContent: "start",
  gap: "var(--space-sm)",
};

const emptyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-sm)",
  height: "100%",
  padding: "var(--space-lg)",
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: "var(--font-body)",
};

const detailEmptyStyle: CSSProperties = {
  color: "var(--text-muted)",
  fontSize: "var(--font-body)",
};

export function MeetingsPage({
  items,
  selectedId,
  onSelect,
  onOpenMeetingNotes,
  services,
  onStartPromoted,
}: MeetingsPageProps) {
  const wide = !useMediaQuery(CAROUSEL_QUERY);
  const groups = meetingGroups(items);
  const selected = items.find((item) => item.id === selectedId);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  });

  const unreadSelectedId =
    selected?.state === "unread" ? selected.id : undefined;
  useEffect(() => {
    if (unreadSelectedId !== undefined) {
      services.api.setItemState(unreadSelectedId, "read").catch(() => {
        services.notice("Couldn't mark this item read.");
      });
    }
  }, [unreadSelectedId, services]);

  if (items.length === 0) {
    return (
      <div style={emptyStyle}>
        <span>
          No meeting action items yet. Paste meeting notes, or turn on Granola
          in Settings.
        </span>
        <Button variant="primary" onClick={onOpenMeetingNotes}>
          From meeting notes
        </Button>
      </div>
    );
  }

  const list = (
    <MeetingList groups={groups} selectedId={selectedId} onSelect={onSelect} />
  );

  const detail = (
    <div style={detailPaneStyle}>
      {!wide && selectedId != null ? (
        <Button variant="secondary" onClick={() => onSelect(null)}>
          Back
        </Button>
      ) : null}
      {selected ? (
        <MeetingDetail
          key={selected.id}
          item={selected}
          services={services}
          onStartPromoted={onStartPromoted}
          onActionComplete={() => {
            if (selectedIdRef.current === selected.id) onSelect(null);
          }}
        />
      ) : (
        <span style={detailEmptyStyle}>Pick an action item.</span>
      )}
    </div>
  );

  if (wide) {
    return (
      <div style={frameStyle}>
        <div style={wideListPaneStyle}>{list}</div>
        {detail}
      </div>
    );
  }

  if (selectedId == null) {
    return <div style={listPaneStyle}>{list}</div>;
  }

  return detail;
}
