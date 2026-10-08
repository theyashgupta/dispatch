import type { SectionState } from "@/modules/dashboard/domain/section-state";
import type { CostRow } from "@/modules/dashboard/domain/cost-rows";
import type { AccountMeters } from "@/modules/dashboard/domain/usage-meters";
import { CostMeterRow } from "./CostMeterRow";
import { DashboardSection } from "./DashboardSection";

const METER_LABELS = { window: "Current window", week: "Current week" };

interface CostSectionProps {
  state: SectionState;
  rows: CostRow[];
  accounts: AccountMeters[];
  onRetry: () => void;
}

export function CostSection({
  state,
  rows,
  accounts,
  onRetry,
}: CostSectionProps) {
  return (
    <DashboardSection
      title="Cost and usage"
      count={rows.length}
      state={state}
      onRetry={onRetry}
    >
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No cost yet.</p>
        ) : (
          <>
            <p className="m-0 text-xs text-muted-foreground">Cost per group</p>
            {rows.map((row) => (
              <CostMeterRow
                key={row.cardId}
                label={row.groupId}
                percent={row.percent}
                text={row.text}
                near={row.near}
                groupLabel
              />
            ))}
          </>
        )}
        {accounts.length > 0 && (
          <p className="m-0 text-xs text-muted-foreground">Account usage</p>
        )}
        {accounts.map((account) => (
          <div key={account.accountId} className="flex flex-col gap-2">
            {account.name !== null && (
              <span className="text-xs text-muted-foreground">
                {account.name}
              </span>
            )}
            {account.meters.map((meter) => (
              <CostMeterRow
                key={meter.kind}
                label={METER_LABELS[meter.kind]}
                percent={meter.percent}
                text={meter.text}
                near={meter.near}
              />
            ))}
          </div>
        ))}
      </div>
    </DashboardSection>
  );
}
