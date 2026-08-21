import { useState } from "react";
import type { PrInfo } from "../../../shared/types.js";
import { prCiDotColor, prStateLabel, prStyleFor } from "./pr-style.js";

export function PrBadge({ pr }: { pr: PrInfo }) {
  const [hovered, setHovered] = useState(false);
  const { icon: Icon, border, background, color } = prStyleFor(pr);
  const showCiDot = !pr.isDraft && pr.state === "open" && pr.ci != null;
  const ciLabel =
    pr.ci != null
      ? ` · Checks ${pr.ci === "pass" ? "passing" : pr.ci === "fail" ? "failing" : "pending"}`
      : "";
  const label = `PR #${pr.number} — ${prStateLabel(pr)}${ciLabel}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        window.open(pr.url, "_blank", "noopener,noreferrer");
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        borderRadius: "var(--radius-sm)",
        padding: "0 var(--space-xs)",
        fontSize: "var(--font-label)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: "var(--line-label)",
        whiteSpace: "nowrap",
        border,
        background,
        color,
        cursor: "pointer",
        fontFamily: "inherit",
        opacity: hovered ? 0.85 : 1,
      }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {`#${pr.number}`}
      {showCiDot && (
        <span
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            flex: "0 0 auto",
            background: prCiDotColor(pr.ci),
          }}
        />
      )}
    </button>
  );
}
