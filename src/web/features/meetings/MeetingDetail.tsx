import { useState, type CSSProperties } from "react";
import type { Item } from "../../../shared/types.js";
import {
  isWebUrl,
  markDone,
  snoozeWithUndo,
  type ActionServices,
} from "../../lib/actions.js";
import { getMeetingTranscript } from "../../lib/api.js";
import { parseSiblings } from "../../lib/meetings.js";
import { SNOOZE_LABELS } from "../../lib/snooze.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Markdown } from "../../primitives/Markdown.js";
import { Select } from "../../primitives/Select.js";
import { focusRing } from "../../primitives/focus-ring.js";

interface MeetingDetailProps {
  item: Item;
  services: ActionServices;
  onStartPromoted: (cardId: string) => void;
  onActionComplete: () => void;
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-heading)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
  overflowWrap: "anywhere",
};

const metaLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const metaTextStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: "anywhere",
  fontSize: "var(--font-body)",
  color: "var(--text-muted)",
};

const linkStyle: CSSProperties = {
  color: "var(--text)",
  fontSize: "var(--font-body)",
  textDecoration: "underline",
  justifySelf: "start",
};

const sectionHeadingStyle: CSSProperties = {
  margin: "var(--space-sm) 0 var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-medium)",
  color: "var(--text-muted)",
};

const siblingListStyle: CSSProperties = {
  margin: 0,
  padding: "0 0 0 var(--space-lg)",
  listStyleType: "disc",
};

const siblingItemStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  color: "var(--text)",
  marginBottom: "var(--space-xs)",
  overflowWrap: "anywhere",
};

const currentSiblingTitleStyle: CSSProperties = {
  fontWeight: "var(--weight-semibold)",
  minWidth: 0,
  overflowWrap: "anywhere",
};

const transcriptBlockStyle: CSSProperties = {
  maxHeight: "50vh",
  overflowY: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontSize: "var(--font-body)",
  color: "var(--text)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  padding: "var(--space-sm)",
};

const transcriptErrorStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  color: "var(--destructive-text)",
};

const actionsRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
  marginTop: "var(--space-sm)",
};

function GranolaLink({ url }: { url: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...linkStyle, ...focusRing(focused) }}
    >
      Open in Granola
    </a>
  );
}

function TranscriptSection({ meetingId }: { meetingId: string }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick() {
    if (visible || transcript != null) {
      setVisible(!visible);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      setTranscript(await getMeetingTranscript(meetingId));
      setVisible(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button
        variant="secondary"
        loading={loading}
        aria-expanded={visible}
        onClick={() => void handleClick()}
      >
        {visible ? "Hide transcript" : "Load transcript"}
      </Button>
      {error ? (
        <div role="alert" style={transcriptErrorStyle}>
          Couldn't load the transcript.
        </div>
      ) : null}
      {visible && transcript != null ? (
        <div style={transcriptBlockStyle}>{transcript}</div>
      ) : null}
    </div>
  );
}

export function MeetingDetail({
  item,
  services,
  onStartPromoted,
  onActionComplete,
}: MeetingDetailProps) {
  const [busy, setBusy] = useState(false);

  const siblings = parseSiblings(item.meta.siblings);
  const row = {
    id: item.id,
    title: item.title,
    unread: item.state === "unread",
  };

  async function runGuarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
      onActionComplete();
    } catch {
      services.notice("Couldn't update this item.");
    } finally {
      setBusy(false);
    }
  }

  async function runAgent(): Promise<void> {
    const { card } = await services.api.promoteItem(item.id);
    try {
      await services.api.moveCard(card.id, "todo");
    } catch {
      services.notice(
        `Created ${card.identifier}, but couldn't move it to To Do.`,
      );
      return;
    }
    onStartPromoted(card.id);
  }

  return (
    <>
      <h2 style={titleStyle}>{item.title}</h2>
      <div style={metaLineStyle}>
        <span style={metaTextStyle}>
          {item.meta.meeting} on {item.meta.meetingDate}
        </span>
        <Chip>{item.meta.feed === "granola" ? "Granola" : "Pasted"}</Chip>
      </div>
      {isWebUrl(item.url) ? <GranolaLink url={item.url} /> : null}
      <Markdown source={item.snippet} />
      <div>
        <h3 style={sectionHeadingStyle}>Action items from this meeting</h3>
        <ul style={siblingListStyle}>
          <li style={siblingItemStyle}>
            <span style={metaLineStyle}>
              <span style={currentSiblingTitleStyle}>{item.title}</span>
              <Chip>This item</Chip>
            </span>
          </li>
          {siblings.map((title, index) => (
            <li key={index} style={siblingItemStyle}>
              {title}
            </li>
          ))}
        </ul>
      </div>
      {item.meta.transcript === "paste" ? (
        <TranscriptSection meetingId={item.meta.meetingId} />
      ) : null}
      <div style={actionsRowStyle}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void runGuarded(async () => {
              const { card } = await services.api.promoteItem(item.id);
              services.notice(`Created ${card.identifier}`);
            })
          }
        >
          Promote to ticket
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void runGuarded(runAgent)}
        >
          Run agent
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void runGuarded(() => markDone(services, row))}
        >
          Done
        </Button>
        <Select
          label="Snooze"
          placeholder="Snooze"
          value=""
          labels={SNOOZE_LABELS}
          disabled={busy}
          onChange={(preset) =>
            void runGuarded(() =>
              snoozeWithUndo(services, row, preset, new Date()),
            )
          }
        />
      </div>
    </>
  );
}
