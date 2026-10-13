import { Button } from "@/components/ui/button";
import { BranchBand } from "@/modules/orchestrator/components/BranchBand";
import {
  BranchTile,
  type TileBehaviour,
} from "@/modules/orchestrator/components/BranchTile";
import type { CentreBand } from "@/modules/orchestrator/domain/centre-graph";
import { NO_BRANCHES_TEXT } from "@/modules/orchestrator/domain/centre-page-state";

interface BranchListProps {
  bands: readonly CentreBand[];
  hiddenShipped: number;
  showOlderShipped: boolean;
  onToggleShipped: () => void;
  tile: TileBehaviour;
}

export function BranchList({
  bands,
  hiddenShipped,
  showOlderShipped,
  onToggleShipped,
  tile,
}: BranchListProps) {
  const empty =
    hiddenShipped === 0 && bands.every((band) => band.branches.length === 0);
  if (empty) {
    return (
      <p className="m-0 text-sm text-muted-foreground">{NO_BRANCHES_TEXT}</p>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-(--space-lg)">
      {bands.map((band) => (
        <BranchBand
          key={band.key}
          id={`band-${band.key}`}
          bandKey={band.key}
          label={band.label}
          count={band.count}
        >
          {band.branches.map((branch) => (
            <BranchTile key={branch.id} branch={branch} tile={tile} />
          ))}
        </BranchBand>
      ))}
      {(hiddenShipped > 0 || showOlderShipped) && (
        <div>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={onToggleShipped}
          >
            {showOlderShipped
              ? "Hide older shipped"
              : `Show ${hiddenShipped} older shipped`}
          </Button>
        </div>
      )}
    </div>
  );
}
