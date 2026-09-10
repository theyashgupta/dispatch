import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Play,
  Trash2,
  Upload,
  X,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  Card as CardModel,
  UnwindDestination,
} from "../../../shared/types.js";
import { UnwindPicker } from "./UnwindPicker.js";
import { moveCard, openEditor, syncCardToLinear } from "../../lib/api.js";
import { isDemoteEligible } from "../../../shared/demote-eligibility.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { IconButton } from "../../primitives/IconButton.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";

function VsCodeMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#007ACC"
        d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      />
    </svg>
  );
}

function CursorMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"
      />
    </svg>
  );
}

interface PanelHeaderProps {
  card: CardModel | null;
  editors?: { code: boolean; cursor: boolean };
  hasLiveSession: boolean;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  docked?: boolean;
  takeover?: boolean;
  onStartRequest?: (id: string) => void;
  onCleanupRequest?: (id: string) => void;
  onUnwindRequest?: (id: string, to: UnwindDestination) => void;
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
  docked = false,
  takeover = false,
  onStartRequest,
  onCleanupRequest,
  onUnwindRequest,
}: PanelHeaderProps) {
  const c = card;
  const [syncPending, setSyncPending] = useState(false);
  const [unwindRect, setUnwindRect] = useState<DOMRect | null>(null);
  const unwindIdentifier = c?.source === "group" ? c.identifier : c?.groupId;
  const unwindable = unwindIdentifier != null;
  const narrowViewport = useMediaQuery("(max-width: 520px)");
  const narrowPanel = (docked || takeover) && narrowViewport;
  const awaitingCleanup =
    c?.column === "done" && (c.tmuxSession != null || c.workspacePath != null);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "var(--space-lg)",
        padding: "var(--space-sm) var(--space-lg)",
        paddingLeft: "var(--space-xl)",
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
          flex: "0 1 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          flexWrap: "wrap",
          gap: "var(--space-sm)",
        }}
      >
        {hasLiveSession && (
          <Button
            variant="secondary"
            aria-expanded={detailsExpanded}
            onClick={onToggleDetails}
            aria-label={narrowPanel ? "Details" : undefined}
            title={narrowPanel ? "Details" : undefined}
          >
            {detailsExpanded ? (
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            ) : (
              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
            )}
            {!narrowPanel && "Details"}
          </Button>
        )}

        {editors?.code && c?.workspacePath && (
          <IconButton
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onClick={() => openEditor(c.id, "code").catch(console.error)}
          >
            <VsCodeMark />
          </IconButton>
        )}
        {editors?.cursor && c?.workspacePath && (
          <IconButton
            aria-label="Open in Cursor"
            title="Open in Cursor"
            onClick={() => openEditor(c.id, "cursor").catch(console.error)}
          >
            <CursorMark />
          </IconButton>
        )}

        {hasLiveSession && !docked && !takeover && (
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

        {c?.column === "inbox" && (
          <Button
            variant="primary"
            onClick={() => moveCard(c.id, "todo").catch(console.error)}
            aria-label={narrowPanel ? "Promote to To Do" : undefined}
            title={narrowPanel ? "Promote to To Do" : undefined}
          >
            <ArrowUp size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel && "Promote to To Do"}
          </Button>
        )}
        {c?.column === "todo" && isDemoteEligible(c) && (
          <Button
            variant="secondary"
            onClick={() => moveCard(c.id, "inbox").catch(console.error)}
            aria-label={narrowPanel ? "Move to Inbox" : undefined}
            title={narrowPanel ? "Move to Inbox" : undefined}
          >
            <ArrowDown size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel && "Move to Inbox"}
          </Button>
        )}
        {c?.source === "local" && (
          <Button
            variant="secondary"
            disabled={syncPending || c.syncing === true}
            onClick={() => {
              setSyncPending(true);
              syncCardToLinear(c.id)
                .then((result) => {
                  if (!result.ok && result.error === null) {
                    console.error("syncCardToLinear: network failure");
                  }
                })
                .catch(console.error)
                .finally(() => setSyncPending(false));
            }}
            aria-label={
              narrowPanel
                ? syncPending || c.syncing === true
                  ? "Syncing…"
                  : "Sync Linear"
                : undefined
            }
            title={
              narrowPanel
                ? syncPending || c.syncing === true
                  ? "Syncing…"
                  : "Sync Linear"
                : undefined
            }
          >
            <Upload size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel &&
              (syncPending || c.syncing === true ? "Syncing…" : "Sync Linear")}
          </Button>
        )}
        {unwindable && c && onUnwindRequest && (
          <Button
            variant="secondary"
            onClick={(e) =>
              setUnwindRect(e.currentTarget.getBoundingClientRect())
            }
            aria-expanded={unwindRect != null}
            aria-label={narrowPanel ? "Unwind" : undefined}
            title={
              c.source === "group"
                ? "Take this group apart; members return to the board"
                : "Take this ticket's group apart"
            }
          >
            <Undo2 size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel && (c.source === "group" ? "Unwind" : "Unwind group")}
          </Button>
        )}
        {unwindRect &&
          c &&
          unwindIdentifier != null &&
          onUnwindRequest &&
          createPortal(
            <UnwindPicker
              identifier={unwindIdentifier}
              anchorRect={unwindRect}
              onSelect={(to) => onUnwindRequest(c.id, to)}
              onClose={() => setUnwindRect(null)}
            />,
            document.body,
          )}
        {awaitingCleanup && (
          <Button
            variant="secondary"
            onClick={() => c && onCleanupRequest?.(c.id)}
            aria-label={narrowPanel ? "Clean up now" : undefined}
            title={narrowPanel ? "Clean up now" : undefined}
          >
            <Trash2 size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel && "Clean up now"}
          </Button>
        )}
        {docked && c?.column === "todo" && onStartRequest && (
          <Button
            variant="primary"
            onClick={() => onStartRequest(c.id)}
            aria-label={narrowPanel ? "Start" : undefined}
            title={narrowPanel ? "Start" : undefined}
          >
            <Play size={12} strokeWidth={2} aria-hidden="true" />
            {!narrowPanel && "Start"}
          </Button>
        )}

        {!docked && (
          <IconButton
            onClick={onClose}
            aria-label={takeover ? "Back to board" : "Close panel"}
            style={takeover ? { width: "44px", height: "44px" } : undefined}
          >
            {takeover ? (
              <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <X size={16} strokeWidth={2} aria-hidden="true" />
            )}
          </IconButton>
        )}
      </div>
    </div>
  );
}
