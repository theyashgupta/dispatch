import { Globe } from "lucide-react";
import { useState } from "react";
import type { PreviewInfo } from "../../../shared/types.js";

export function PreviewBadge({ preview }: { preview: PreviewInfo }) {
  const [hovered, setHovered] = useState(false);
  const label = `Open preview — localhost:${preview.port}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        window.open(preview.url, "_blank", "noopener,noreferrer");
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        borderRadius: "var(--radius)",
        padding: "0 var(--space-xs)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        whiteSpace: "nowrap",
        border: "none",
        background:
          "color-mix(in srgb, var(--status-ok) 16%, var(--surface-card))",
        color: "var(--status-ok)",
        cursor: "pointer",
        fontFamily: "inherit",
        opacity: hovered ? 0.85 : 1,
      }}
    >
      <Globe size={12} strokeWidth={2} aria-hidden="true" />
      {`:${preview.port}`}
    </button>
  );
}
