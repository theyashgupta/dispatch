import { useEffect, useState, type CSSProperties } from "react";
import type { Card, CalendarStatus, Item } from "../../../shared/types.js";
import { isWebUrl, type ActionServices } from "../../lib/actions.js";
import { createLocalTicket, getCalendarStatus } from "../../lib/api.js";
import {
  agendaDays,
  prepareTitle,
  preparePrompt,
  soonLabel,
  timeRange,
} from "../../lib/calendar.js";
import {
  CALENDAR_ERROR_COPY,
  CALENDAR_LOAD_FAILED_COPY,
} from "../../../shared/connection-status.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { Notice } from "../../primitives/Notice.js";
import { PageBody } from "../../primitives/PageBody.js";

interface CalendarPageProps {
  items: Item[];
  cards: Card[];
  services: ActionServices;
  onStartPromoted: (cardId: string) => void;
  onOpenSettings: () => void;
}

const TICK_MS = 30_000;

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

const dayHeadingStyle: CSSProperties = {
  margin: "0 0 var(--space-xs)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-medium)",
  color: "var(--text-muted)",
};

const listStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: "var(--space-xs)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  minWidth: 0,
};

const timeStyle: CSSProperties = {
  flex: "0 0 auto",
  whiteSpace: "nowrap",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
  fontVariantNumeric: "tabular-nums",
};

const textStyle: CSSProperties = {
  flex: "1 1 200px",
  minWidth: 0,
  display: "grid",
  gap: "2px",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  color: "var(--text)",
  overflowWrap: "anywhere",
};

const metaStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
  overflowWrap: "anywhere",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-xs)",
};

interface AgendaRowProps {
  item: Item;
  now: Date;
  busy: boolean;
  onJoin: (url: string) => void;
  onPrepare: () => void;
}

function AgendaRow({ item, now, busy, onJoin, onPrepare }: AgendaRowProps) {
  const soon = soonLabel(item, now);
  const joinUrl = item.meta.joinUrl;
  const place = [item.meta.location, item.meta.calendar]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  return (
    <li style={rowStyle}>
      <span style={timeStyle}>{timeRange(item)}</span>
      <span style={textStyle}>
        <span style={titleStyle}>{item.title}</span>
        {place !== "" && <span style={metaStyle}>{place}</span>}
      </span>
      <span style={actionsStyle}>
        {soon !== undefined && <Chip tone="warning">{soon}</Chip>}
        {isWebUrl(joinUrl) && (
          <Button onClick={() => onJoin(joinUrl)}>Join</Button>
        )}
        <Button onClick={onPrepare} loading={busy} disabled={busy}>
          Prepare with agent
        </Button>
      </span>
    </li>
  );
}

export function CalendarPage({
  items,
  cards,
  services,
  onStartPromoted,
  onOpenSettings,
}: CalendarPageProps) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [preparing, setPreparing] = useState<ReadonlySet<string>>(new Set());
  const days = agendaDays(items, now);

  useEffect(() => {
    const read = () => {
      setNow(new Date());
      getCalendarStatus().then(
        (next) => {
          setStatus(next);
          setLoadFailed(false);
        },
        () => setLoadFailed(true),
      );
    };
    read();
    const id = setInterval(read, TICK_MS);
    return () => clearInterval(id);
  }, []);

  async function handlePrepare(item: Item) {
    setPreparing((current) => new Set(current).add(item.id));
    const result = await createLocalTicket(
      prepareTitle(item),
      preparePrompt(item, cards),
    );
    setPreparing((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    if (result.ok) onStartPromoted(result.card.id);
    else services.notice("Couldn't create the prepare ticket.");
  }

  const loadFailedNotice = loadFailed && (
    <Notice tone="destructive" label={CALENDAR_LOAD_FAILED_COPY} />
  );
  if (status === null) {
    return loadFailed ? <PageBody>{loadFailedNotice}</PageBody> : null;
  }
  if (!status.enabled) {
    return (
      <div style={emptyStyle}>
        {loadFailedNotice}
        <span>Calendar is off. Connect it in Settings.</span>
        <Button variant="primary" onClick={onOpenSettings}>
          Open Settings
        </Button>
      </div>
    );
  }
  return (
    <PageBody>
      {loadFailedNotice}
      {status.lastError !== undefined && (
        <Notice
          tone="destructive"
          label={CALENDAR_ERROR_COPY[status.lastError]}
        />
      )}
      {days.length === 0 ? (
        <span style={metaStyle}>Nothing in the next 48 hours.</span>
      ) : (
        days.map((day) => (
          <section key={day.key} aria-label={day.label}>
            <h2 style={dayHeadingStyle}>{day.label}</h2>
            <ul style={listStyle}>
              {day.items.map((item) => (
                <AgendaRow
                  key={item.id}
                  item={item}
                  now={now}
                  busy={preparing.has(item.id)}
                  onJoin={services.openUrl}
                  onPrepare={() => void handlePrepare(item)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </PageBody>
  );
}
