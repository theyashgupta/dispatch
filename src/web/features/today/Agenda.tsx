import type { CSSProperties } from "react";
import type { Item } from "../../../shared/types.js";
import { Button } from "../../primitives/Button.js";
import { agendaTime, joinLink } from "./today-view.js";

interface AgendaProps {
  events: Item[];
}

const cardStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
};

const headerStyle: CSSProperties = {
  padding: "var(--space-lg)",
  paddingBottom: 0,
};

const titleStyle: CSSProperties = {
  fontSize: "var(--font-body)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-lg)",
  borderTop: "1px solid var(--border)",
};

const timeStyle: CSSProperties = {
  flex: "0 0 auto",
  fontSize: "var(--font-label)",
  color: "var(--text-muted)",
};

const eventTitleStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "var(--font-body)",
  color: "var(--text)",
};

export function Agenda({ events }: AgendaProps) {
  if (events.length === 0) return null;
  return (
    <section style={cardStyle} aria-label="Today's agenda">
      <div style={headerStyle}>
        <span style={titleStyle}>Today&apos;s agenda</span>
      </div>
      <div>
        {events.map((event) => {
          const link = joinLink(event);
          return (
            <div key={event.id} style={rowStyle}>
              <span style={timeStyle}>{agendaTime(event.meta.start)}</span>
              <span style={eventTitleStyle}>{event.title}</span>
              {link ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    window.open(link, "_blank", "noopener,noreferrer")
                  }
                >
                  Join
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
