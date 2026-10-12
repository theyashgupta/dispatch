import { ExternalTextLink } from "@/components/ExternalTextLink";
import { Badge } from "@/components/ui/badge";
import { REVIEW_CHECK_BADGE, type ReviewHeader } from "../domain/review-header";

export function ReviewPrBlock({ label, url, checks, verdict }: ReviewHeader) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-(--space-md) gap-y-(--space-xs) text-sm text-foreground">
      <ExternalTextLink href={url} className="font-semibold">
        {label}
      </ExternalTextLink>
      {checks != null && (
        <Badge tone={REVIEW_CHECK_BADGE[checks].tone}>
          {REVIEW_CHECK_BADGE[checks].label}
        </Badge>
      )}
      {verdict != null && (
        <span className="min-w-0 wrap-anywhere text-muted-foreground">
          {verdict}
        </span>
      )}
    </div>
  );
}
