import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ActivityEvent } from "../../../shared/types.js";
import { describeEvent } from "../../lib/event-copy.js";
import { formatAge } from "../../lib/format-age.js";
import { ActivityItem } from "../../primitives/ActivityItem.js";
import { IconButton } from "../../primitives/IconButton.js";

interface ActivityDrawerProps {
  open: boolean;
  events: ActivityEvent[];
  identifiers?: Record<string, string>;
  onClose: () => void;
  onSelectCard: (cardId: string) => void;
}

export function ActivityDrawer({
  open,
  events,
  identifiers,
  onClose,
  onSelectCard,
}: ActivityDrawerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) document.getElementById("activity-drawer-close")?.focus();
  }, [open]);

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "transparent",
          pointerEvents: open ? "auto" : "none",
          zIndex: 12,
        }}
      />

      <aside
        role="dialog"
        aria-label="Activity feed"
        id="activity-drawer"
        inert={!open}
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100dvh",
          width: "var(--drawer-width)",
          maxWidth: "100vw",
          background: "var(--surface-column)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 150ms ease-out",
          zIndex: 13,
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            height: "var(--strip-height)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 var(--space-lg)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span
            style={{
              fontSize: "var(--font-heading)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-heading)",
              color: "var(--text)",
            }}
          >
            Activity
          </span>
          <IconButton
            id="activity-drawer-close"
            aria-label="Close activity feed"
            onClick={onClose}
          >
            <X size={16} />
          </IconButton>
        </div>

        <div
          aria-live="polite"
          aria-relevant="additions"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--space-sm) 0",
          }}
        >
          {events.length === 0 ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "var(--space-xl)",
                fontSize: "var(--font-body)",
                lineHeight: "var(--line-body)",
                fontStyle: "italic",
                color: "var(--text-muted)",
              }}
            >
              No activity yet.
            </div>
          ) : (
            events.map((event, index) => (
              <div
                key={event.id}
                style={{
                  padding: "var(--space-sm) var(--space-lg)",
                  borderBottom:
                    index < events.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                }}
              >
                <ActivityItem
                  type={event.type}
                  cardId={event.cardId ?? undefined}
                  description={describeEvent(event)}
                  age={formatAge(event.ts, now)}
                  identifiers={identifiers}
                  onSelect={onSelectCard}
                />
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
