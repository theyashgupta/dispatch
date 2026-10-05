import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

interface FlowToolbarProps {
  speed: Speed;
  canReplay: boolean;
  syncing: boolean;
  notice: string | null;
  onSpeedChange: (speed: Speed) => void;
  onReplay: () => void;
  onSync: () => void;
}

const BASE_CLASS =
  "h-8 rounded-md border-border px-(--space-sm) text-sm font-semibold text-foreground shadow-none";

const SPEED_ITEM_CLASS = `${BASE_CLASS} active:bg-(--pressed-card-hover) data-[state=on]:border-(color:--text-muted) data-[state=on]:bg-(--pressed-card) data-[state=on]:text-(--accent-text) data-[state=on]:hover:bg-(--pressed-card) data-[state=on]:active:bg-(--pressed-card)`;

const ACTION_CLASS = `${BASE_CLASS} bg-transparent has-[>svg]:px-(--space-sm) dark:border-border dark:bg-transparent dark:hover:bg-accent`;

export function FlowToolbar({
  speed,
  canReplay,
  syncing,
  notice,
  onSpeedChange,
  onReplay,
  onSync,
}: FlowToolbarProps) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-(--space-sm)">
        <ToggleGroup
          type="multiple"
          role="group"
          rovingFocus={false}
          variant="outline"
          size="sm"
          spacing={1}
          aria-label="Animation speed"
          value={[String(speed)]}
          onValueChange={(values) => {
            const next = values.find((value) => value !== String(speed));
            const found = SPEEDS.find((value) => String(value) === next);
            if (found !== undefined) onSpeedChange(found);
          }}
        >
          {SPEEDS.map((value) => (
            <ToggleGroupItem
              key={value}
              value={String(value)}
              className={SPEED_ITEM_CLASS}
            >
              {`${value}x`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          variant="outline"
          size="sm"
          className={ACTION_CLASS}
          disabled={!canReplay}
          onClick={onReplay}
        >
          Replay latest
        </Button>
        <Button
          variant="outline"
          size="sm"
          className={ACTION_CLASS}
          disabled={syncing}
          onClick={onSync}
        >
          Sync now
        </Button>
      </div>
      <p role="status" className="m-0 text-right text-sm text-muted-foreground">
        {notice}
      </p>
    </>
  );
}
