import type { PrDetail } from "../../../../shared/types.js";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import { ExternalTextLink } from "@/components/ExternalTextLink";
import {
  CHECK_LABEL,
  CHECK_TONE,
} from "@/modules/pull-requests/domain/pr-detail-state";

interface PrChecksProps {
  detail: PrDetail;
  failing: boolean;
}

export function PrChecks({ detail, failing }: PrChecksProps) {
  return (
    <CollapsibleSection
      title="CI checks"
      badge={<Badge tone="neutral">{detail.checks.length}</Badge>}
      defaultOpen={failing}
    >
      {detail.checks.length === 0 ? (
        <div className="text-base text-muted-foreground">No checks</div>
      ) : (
        detail.checks.map((check) => (
          <div
            key={`${check.name}-${check.url ?? ""}`}
            className="flex min-w-0 items-center gap-2 py-1 text-sm text-foreground"
          >
            <Badge tone={CHECK_TONE[check.state]}>
              {CHECK_LABEL[check.state]}
            </Badge>
            {check.url ? (
              <ExternalTextLink href={check.url}>{check.name}</ExternalTextLink>
            ) : (
              <span>{check.name}</span>
            )}
          </div>
        ))
      )}
      {detail.checksTruncated && (
        <div className="text-base text-muted-foreground">
          Showing the first {detail.checks.length} checks.
        </div>
      )}
    </CollapsibleSection>
  );
}
