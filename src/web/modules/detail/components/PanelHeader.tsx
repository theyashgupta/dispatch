import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Maximize2,
  MessageCircleQuestion,
  Minimize2,
  Play,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Card as CardModel,
  Column,
  UnwindDestination,
} from "../../../../shared/types.js";
import { isDemoteEligible } from "../../../../shared/demote-eligibility.js";
import { isResetEligible } from "../../../../shared/reset-eligibility.js";
import { LinearStateChip } from "@/components/badges/LinearStateChip";
import { TeamCycleText } from "@/components/badges/TeamCycleText";
import { CursorMark } from "@/components/icons/brands/CursorMark";
import { VsCodeMark } from "@/components/icons/brands/VsCodeMark";
import { LoadingButton } from "@/components/LoadingButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UnwindPicker } from "./UnwindPicker";

interface PanelHeaderProps {
  card: CardModel | null;
  editors?: { code: boolean; cursor: boolean };
  hasLiveSession: boolean;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  docked: boolean;
  takeover: boolean;
  narrowPanel: boolean;
  onOpenEditor: (id: string, editor: "code" | "cursor") => void;
  onMove: (id: string, column: Column) => void;
  onStartRequest?: (id: string) => void;
  onCleanupRequest?: (id: string) => void;
  onUnwindRequest?: (id: string, to: UnwindDestination) => void;
  onResetRequest?: (id: string) => void;
  onSyncRequest?: (id: string) => void;
  onAskRequest?: (card: CardModel) => void;
}

const ICON_BUTTON_CLASS = "text-muted-foreground hover:text-muted-foreground";

export function PanelHeader({
  card,
  editors,
  hasLiveSession,
  detailsExpanded,
  onToggleDetails,
  fullscreen,
  onToggleFullscreen,
  onClose,
  docked,
  takeover,
  narrowPanel,
  onOpenEditor,
  onMove,
  onStartRequest,
  onCleanupRequest,
  onUnwindRequest,
  onResetRequest,
  onSyncRequest,
  onAskRequest,
}: PanelHeaderProps) {
  const c = card;
  const unwindIdentifier = c?.source === "group" ? c.identifier : c?.groupId;
  const unwindable = unwindIdentifier != null;
  const narrowName = (label: string) =>
    narrowPanel ? { "aria-label": label, title: label } : {};
  const awaitingCleanup =
    c?.column === "done" && (c.tmuxSession != null || c.workspacePath != null);
  const syncLabel = c?.syncing === true ? "Syncing…" : "Sync Linear";
  return (
    <div className="flex flex-wrap items-center justify-between gap-(--space-lg) border-b border-border py-(--space-sm) pr-(--space-lg) pl-(--space-xl)">
      <div className="flex min-w-0 items-baseline gap-(--space-sm)">
        <span className="flex-none font-mono text-xs leading-(--line-label) font-semibold text-muted-foreground">
          {c?.identifier}
        </span>
        {c && <TeamCycleText card={c} />}
        {c && <LinearStateChip card={c} />}
        <h1
          title={c?.title}
          className="m-0 min-w-0 truncate text-lg font-semibold text-foreground"
        >
          {c?.title}
        </h1>
      </div>

      <div className="flex flex-[0_1_auto] flex-wrap items-center justify-end gap-(--space-sm)">
        {hasLiveSession && (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={detailsExpanded}
            onClick={onToggleDetails}
            {...narrowName("Details")}
          >
            {detailsExpanded ? (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden="true" />
            )}
            {!narrowPanel && "Details"}
          </Button>
        )}

        {editors?.code && c?.workspacePath && (
          <Button
            variant="ghost"
            size="icon-md"
            className={ICON_BUTTON_CLASS}
            aria-label="Open in VS Code"
            title="Open in VS Code"
            onClick={() => onOpenEditor(c.id, "code")}
          >
            <VsCodeMark />
          </Button>
        )}
        {editors?.cursor && c?.workspacePath && (
          <Button
            variant="ghost"
            size="icon-md"
            className={ICON_BUTTON_CLASS}
            aria-label="Open in Cursor"
            title="Open in Cursor"
            onClick={() => onOpenEditor(c.id, "cursor")}
          >
            <CursorMark />
          </Button>
        )}
        {c && onAskRequest && (
          <Button
            variant="ghost"
            size="icon-md"
            className={ICON_BUTTON_CLASS}
            aria-label="Ask about this"
            title="Ask about this"
            onClick={() => onAskRequest(c)}
          >
            <MessageCircleQuestion className="size-4" aria-hidden="true" />
          </Button>
        )}

        {hasLiveSession && !docked && !takeover && (
          <Button
            variant="ghost"
            size="icon-md"
            className={ICON_BUTTON_CLASS}
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fullscreen ? (
              <Minimize2 className="size-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-4" aria-hidden="true" />
            )}
          </Button>
        )}

        {c?.column === "inbox" && (
          <Button
            size="sm"
            onClick={() => onMove(c.id, "todo")}
            {...narrowName("Promote to To Do")}
          >
            <ArrowUp className="size-3" aria-hidden="true" />
            {!narrowPanel && "Promote to To Do"}
          </Button>
        )}
        {c?.column === "todo" && isDemoteEligible(c) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onMove(c.id, "inbox")}
            {...narrowName("Move to Inbox")}
          >
            <ArrowDown className="size-3" aria-hidden="true" />
            {!narrowPanel && "Move to Inbox"}
          </Button>
        )}
        {c?.source === "local" && (
          <Button
            variant="outline"
            size="sm"
            disabled={c.syncing === true}
            onClick={() => onSyncRequest?.(c.id)}
            {...narrowName(syncLabel)}
          >
            <Upload className="size-3" aria-hidden="true" />
            {!narrowPanel && syncLabel}
          </Button>
        )}
        {unwindable && c && onUnwindRequest && (
          <UnwindPicker
            identifier={unwindIdentifier}
            label={
              narrowPanel
                ? null
                : c.source === "group"
                  ? "Unwind"
                  : "Unwind group"
            }
            ariaLabel={narrowPanel ? "Unwind" : undefined}
            title={
              c.source === "group"
                ? "Take this group apart; members return to the board"
                : "Take this ticket's group apart"
            }
            onSelect={(to) => onUnwindRequest(c.id, to)}
          />
        )}
        {c && isResetEligible(c) && onResetRequest && (
          <Button
            variant="outline"
            size="sm"
            disabled={c.cleaningUp === true}
            onClick={() => onResetRequest(c.id)}
            aria-label={narrowPanel ? "Reset" : undefined}
            title="Undo the start: delete the session, workspace and branch, then return to Inbox"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            {!narrowPanel && "Reset"}
          </Button>
        )}
        {awaitingCleanup && c?.cleaningUp && (
          <LoadingButton
            variant="outline"
            loading
            {...narrowName("Cleaning up")}
          >
            {!narrowPanel && "Cleaning up…"}
          </LoadingButton>
        )}
        {awaitingCleanup && !c?.cleaningUp && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => c && onCleanupRequest?.(c.id)}
            {...narrowName("Clean up now")}
          >
            <Trash2 className="size-3" aria-hidden="true" />
            {!narrowPanel && "Clean up now"}
          </Button>
        )}
        {docked && c?.column === "todo" && onStartRequest && (
          <Button
            size="sm"
            onClick={() => onStartRequest(c.id)}
            {...narrowName("Start")}
          >
            <Play className="size-3" aria-hidden="true" />
            {!narrowPanel && "Start"}
          </Button>
        )}

        {!docked && (
          <Button
            variant="ghost"
            size="icon-md"
            className={cn(ICON_BUTTON_CLASS, takeover && "size-11")}
            onClick={(event) => {
              event.currentTarget.blur();
              onClose();
            }}
            aria-label={takeover ? "Back to board" : "Close panel"}
          >
            {takeover ? (
              <ArrowLeft className="size-4" aria-hidden="true" />
            ) : (
              <X className="size-4" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
