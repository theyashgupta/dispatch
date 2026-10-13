import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  TicketTile,
  TileState,
} from "@/modules/dashboard/domain/ticket-tiles";
import { TILE_PILLS } from "./tile-pills";

const SURFACES: Record<TileState, string> = {
  done: cardVariants({ identity: "rest", surface: "rest" }),
  current: cardVariants({ identity: "attention", surface: "rest" }),
  needs_input: cn(
    cardVariants({ identity: "warn", surface: "rest" }),
    "bg-[linear-gradient(var(--warn-soft),var(--warn-soft))]",
  ),
  stuck: cn(
    cardVariants({ identity: "danger", surface: "rest" }),
    "segment-hatch-danger",
  ),
  not_started: cardVariants({ identity: "pending", surface: "rest" }),
};

interface TicketTileViewProps {
  tile: TicketTile;
}

export function TicketTileView({ tile }: TicketTileViewProps) {
  const { tone, Glyph, label } = TILE_PILLS[tile.state];
  const tinted = tile.state === "needs_input" || tile.state === "stuck";
  const secondary = tinted ? "text-foreground" : "text-muted-foreground";
  return (
    <li
      className={cn(
        "flex h-full min-w-0 flex-col gap-2 rounded-(--radius) border p-(--space-md)",
        SURFACES[tile.state],
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("font-mono text-xs", secondary)}>
          {tile.identifier}
        </span>
        <Badge tone={tone} className="max-w-full">
          <Glyph aria-hidden="true" />
          {tile.pill}
          <span className="sr-only">, {label}</span>
        </Badge>
      </div>
      <p
        className={cn(
          "m-0 line-clamp-2 text-base font-medium wrap-anywhere",
          tile.state === "not_started"
            ? "text-muted-foreground"
            : "text-foreground",
        )}
      >
        {tile.title}
      </p>
      {tile.progress !== null && (
        <Progress
          value={tile.progress}
          tone={tile.state === "current" ? "accent" : "default"}
          aria-label={`${tile.identifier} progress ${tile.progress}%`}
          className="h-1 rounded-sm bg-border"
        />
      )}
      {tile.footer !== null && (
        <p className={cn("m-0 mt-auto text-xs tabular-nums", secondary)}>
          {tile.footer}
        </p>
      )}
    </li>
  );
}
