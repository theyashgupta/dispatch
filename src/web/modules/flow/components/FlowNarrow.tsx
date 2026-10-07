import { PageBody } from "@/components/PageBody";
import { Card } from "@/components/ui/card";
import { FlowSourceMark } from "./FlowSourceMark";
import {
  TRAYS,
  type SourceNode,
  type TrayId,
} from "@/modules/flow/domain/flow-model";

interface FlowNarrowProps {
  sources: readonly SourceNode[];
  counts: Record<TrayId, number>;
  lastSync: string;
}

const HEADING = "m-0 text-sm font-semibold text-muted-foreground";
const LIST = "m-0 flex list-none flex-col gap-(--space-xs) p-0";
const ROW = "flex justify-between gap-(--space-sm) text-base text-foreground";

export function FlowNarrow({ sources, counts, lastSync }: FlowNarrowProps) {
  return (
    <PageBody>
      <Card className="gap-(--space-lg) border-0 bg-transparent p-0 shadow-none">
        <div className="mt-(--space-xs) overflow-hidden text-sm font-normal text-ellipsis whitespace-nowrap text-muted-foreground">
          Flow is best on a wider screen.
        </div>
        <h2 className={HEADING}>Sources</h2>
        <ul className={LIST} aria-label="Sources">
          {sources.map((s) => (
            <li key={s.id} className={ROW}>
              <span className="inline-flex items-center gap-(--space-xs)">
                <FlowSourceMark source={s.id} size={12} />
                {s.label}{" "}
                <span className="text-muted-foreground">
                  {s.lit ? "Enabled" : "Off"}
                </span>
              </span>
              <span>{s.count}</span>
            </li>
          ))}
        </ul>
        <h2 className={HEADING}>Poller</h2>
        <p className={`${ROW} m-0`}>{lastSync}</p>
        <h2 className={HEADING}>Trays</h2>
        <ul className={LIST} aria-label="Trays">
          {TRAYS.map((t) => (
            <li key={t.id} className={ROW}>
              <span>{t.label}</span>
              <span>{counts[t.id]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </PageBody>
  );
}
