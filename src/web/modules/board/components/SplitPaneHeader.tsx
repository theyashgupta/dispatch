import { Columns2, Rows2, X } from "lucide-react";
import type { SplitDirection } from "../../../../shared/board-split.js";
import type { BoardKey } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface SplitPaneBoardOption {
  key: BoardKey;
  name: string;
}

interface SplitPaneHeaderProps {
  boardName: string;
  onClose: () => void;
  secondary?: {
    value: BoardKey;
    options: readonly SplitPaneBoardOption[];
    onValueChange: (key: BoardKey) => void;
    dir: SplitDirection;
    onDirChange: (dir: SplitDirection) => void;
  };
}

export function SplitPaneHeader({
  boardName,
  onClose,
  secondary,
}: SplitPaneHeaderProps) {
  return (
    <div className="flex flex-none items-center gap-(--space-sm) border-b border-border bg-background px-(--space-lg) py-(--space-sm)">
      {secondary === undefined ? (
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {boardName}
        </span>
      ) : (
        <>
          <Select
            value={secondary.value}
            onValueChange={(next) => {
              const option = secondary.options.find((o) => o.key === next);
              if (option !== undefined) secondary.onValueChange(option.key);
            }}
          >
            <SelectTrigger size="sm" aria-label="Board" className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {secondary.options.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={secondary.dir}
            onValueChange={(next) => {
              if (next === "row" || next === "column")
                secondary.onDirChange(next);
            }}
            aria-label="Split direction"
            className="ml-auto"
          >
            <ToggleGroupItem value="row" aria-label="Side by side">
              <Columns2 />
            </ToggleGroupItem>
            <ToggleGroupItem value="column" aria-label="Stacked">
              <Rows2 />
            </ToggleGroupItem>
          </ToggleGroup>
        </>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Close ${boardName} pane`}
        onClick={onClose}
      >
        <X />
      </Button>
    </div>
  );
}
