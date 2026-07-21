import { ExternalLink, Globe } from "lucide-react";
import type { PreviewInfo } from "../../../shared/types.js";
import { IconButton } from "../../primitives/IconButton.js";

export function PreviewRow({ preview }: { preview: PreviewInfo }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}
    >
      <Globe
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ flex: "0 0 auto", color: "var(--status-ok)" }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: "var(--font-body)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-body)",
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {`localhost:${preview.port}`}
        </span>
        <span
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-regular)",
            lineHeight: "var(--line-label)",
            color: "var(--status-ok)",
          }}
        >
          Dev server
        </span>
      </div>
      <IconButton
        aria-label={`Open localhost:${preview.port} in browser`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          window.open(preview.url, "_blank", "noopener,noreferrer");
        }}
      >
        <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
