import {
  CircleDashedIcon,
  CircleDotIcon,
  LoaderCircleIcon,
  PlusIcon,
} from "lucide-react";
import { formatCount } from "../../../../shared/format-count.js";
import { Badge } from "@/components/ui/badge";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { attentionLabel } from "@/modules/shell/domain/board-switcher";
import type { SidebarOrchestrator } from "@/modules/shell/domain/sidebar-orchestrator";

function StateGlyph({ state }: { state: SidebarOrchestrator["state"] }) {
  switch (state) {
    case "running":
      return (
        <CircleDotIcon
          aria-hidden="true"
          className="text-(--col-in-progress)"
        />
      );
    case "starting":
    case "stopping":
      return (
        <LoaderCircleIcon
          aria-hidden="true"
          className="text-muted-foreground motion-safe:animate-spin"
        />
      );
    case "stopped":
      return (
        <CircleDashedIcon
          aria-hidden="true"
          className="text-muted-foreground"
        />
      );
  }
}

export function SidebarOrchestratorRow({
  entry,
  active,
  onOpen,
}: {
  entry: SidebarOrchestrator;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <SidebarMenuSub>
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          asChild
          isActive={active && entry.hasOrchestrator}
          className={
            entry.hasOrchestrator ? undefined : "text-muted-foreground"
          }
        >
          <button
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={onOpen}
          >
            {entry.hasOrchestrator ? (
              <>
                <StateGlyph state={entry.state} />
                <span className="sr-only">{entry.stateLabel}</span>
                <span className="min-w-0 flex-1 truncate">Orchestrator</span>
                {entry.badge !== null ? (
                  <Badge tone="accent" aria-label={attentionLabel(entry.badge)}>
                    {formatCount(entry.badge)}
                  </Badge>
                ) : null}
              </>
            ) : (
              <>
                <PlusIcon aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">
                  Add orchestrator
                </span>
              </>
            )}
          </button>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    </SidebarMenuSub>
  );
}
