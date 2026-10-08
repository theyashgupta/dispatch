import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";

export interface StoppedLoopRow {
  cardId: string;
  text: string;
}

interface StoppedLoopsProps {
  rows: readonly StoppedLoopRow[];
  disabled: boolean;
  onResume: (cardId: string) => void;
}

export function StoppedLoops({ rows, disabled, onResume }: StoppedLoopsProps) {
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="stopped-loops-heading"
      className="flex flex-col gap-(--space-xs)"
    >
      <h3
        id="stopped-loops-heading"
        className="m-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        Stopped loops
      </h3>
      <ItemGroup className="gap-(--space-xs)">
        {rows.map((row) => (
          <Item key={row.cardId} variant="muted" size="sm">
            <ItemContent>
              <ItemTitle>{row.text}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onResume(row.cardId)}
              >
                Resume loop
              </Button>
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
    </section>
  );
}
