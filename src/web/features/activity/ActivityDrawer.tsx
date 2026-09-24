import { useEffect } from "react";
import { X } from "lucide-react";
import type { ActivityEvent } from "../../../shared/types.js";
import { IconButton } from "../../primitives/IconButton.js";
import { ActivityList } from "./ActivityList.js";

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
          transition: open
            ? "transform var(--motion-panel-open) var(--easing-enter)"
            : "transform var(--motion-panel-close) var(--easing-exit)",
          zIndex: 13,
        }}
      >
        <div
          style={{
            flex: "0 0 auto",
            height: "var(--page-header-height)",
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
          className="scroll-stable-y"
          aria-live="polite"
          aria-relevant="additions"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "var(--space-sm) 0",
          }}
        >
          <ActivityList
            events={events}
            identifiers={identifiers}
            onSelectCard={onSelectCard}
            ticking={open}
          />
        </div>
      </aside>
    </>
  );
}
