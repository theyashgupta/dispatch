import { STALE_REASON } from "@/modules/orchestrator/domain/centre-model";

interface StaleReasonProps {
  id: string;
  padded: boolean;
}

export function StaleReason({ id, padded }: StaleReasonProps) {
  const reason = (
    <p id={id} role="status" className="m-0 text-sm text-muted-foreground">
      {STALE_REASON}
    </p>
  );
  return padded ? (
    <div className="px-(--space-xl) pt-(--space-md)">{reason}</div>
  ) : (
    reason
  );
}
