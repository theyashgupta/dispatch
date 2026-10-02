import { Inbox, Monitor } from "lucide-react";
import { ALL_CONNECTIONS } from "../../../../shared/connection-meta.js";
import { SourceIcon, sourceAccent } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sourceConnected } from "@/modules/setup/domain/linear-lit";

interface SetupMapProps {
  linearConnected: boolean;
}

const BOX =
  "flex min-w-0 items-center gap-2 rounded-md border border-border bg-sidebar px-2 py-1 text-base text-foreground";

const HUB_ICON =
  "inline-flex size-8 flex-none items-center justify-center rounded-md border border-border text-muted-foreground";

const CONNECTOR =
  "h-4 w-px self-center bg-border md:h-px md:w-auto md:min-w-4 md:flex-1 md:self-auto";

export function SetupMap({ linearConnected }: SetupMapProps) {
  return (
    <div
      role="img"
      aria-label={
        linearConnected
          ? "Connection map: Linear connected"
          : "Connection map: no source connected yet"
      }
      className="flex flex-col items-stretch rounded-md border border-border bg-card p-4 md:flex-row md:items-center"
    >
      <div className="grid grid-cols-2 gap-2 md:flex-none">
        {ALL_CONNECTIONS.map(({ source, name }) => {
          const lit = sourceConnected(source, linearConnected);
          return (
            <Badge
              key={source}
              variant="outline"
              stateColor={sourceAccent(source)}
              data-source={source}
              data-lit={lit}
              className={cn(
                BOX,
                "h-auto w-auto justify-start overflow-visible font-normal whitespace-normal",
                lit ? "border-(--badge-state)" : "text-muted-foreground",
              )}
            >
              <span className={cn("inline-flex", !lit && "opacity-45")}>
                <SourceIcon source={source} />
              </span>
              <span>{name}</span>
            </Badge>
          );
        })}
      </div>
      <div className={CONNECTOR} />
      <div className={BOX}>
        <span className={HUB_ICON}>
          <Monitor size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>
          This Mac
          <span className="block text-sm text-muted-foreground">
            Local store
          </span>
        </span>
      </div>
      <div className={CONNECTOR} />
      <div className={BOX}>
        <span className={HUB_ICON}>
          <Inbox size={16} strokeWidth={2} aria-hidden="true" />
        </span>
        <span>Inbox</span>
      </div>
    </div>
  );
}
