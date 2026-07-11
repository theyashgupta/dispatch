import {
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import type { Card as CardModel } from "../../../shared/types.js";
import { openEditor } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";

interface PanelHeaderProps {
  card: CardModel | null;
  editors?: { code: boolean; cursor: boolean };
  hasLiveSession: boolean;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
}

export function PanelHeader({
  card,
  editors,
  hasLiveSession,
  detailsExpanded,
  onToggleDetails,
  fullscreen,
  onToggleFullscreen,
  onClose,
}: PanelHeaderProps) {
  const c = card;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-lg)",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-sm)",
          minWidth: 0,
        }}
      >
        <Field mono style={{ flex: "0 0 auto" }}>
          {c?.identifier}
        </Field>
        <h1
          title={c?.title}
          style={{
            margin: 0,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            fontSize: "var(--font-heading)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-heading)",
            color: "var(--text)",
          }}
        >
          {c?.title}
        </h1>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
        }}
      >
        {hasLiveSession && (
          <Button
            variant="secondary"
            aria-expanded={detailsExpanded}
            onClick={onToggleDetails}
          >
            {detailsExpanded ? (
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            )}
            Details
          </Button>
        )}

        {editors?.code && c?.workspacePath && (
          <Button
            variant="secondary"
            onClick={() => openEditor(c.id, "code").catch(console.error)}
          >
            VS Code
          </Button>
        )}
        {editors?.cursor && c?.workspacePath && (
          <Button
            variant="secondary"
            onClick={() => openEditor(c.id, "cursor").catch(console.error)}
          >
            Cursor
          </Button>
        )}

        {hasLiveSession && (
          <IconButton
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </IconButton>
        )}

        <IconButton onClick={onClose} aria-label="Close panel">
          <X size={16} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
