import {
  DEFAULT_GRANOLA_WINDOW_HOURS,
  type GranolaCheckResult,
} from "../../../../shared/types.js";
import {
  granolaCardStatus,
  granolaRunLine,
} from "../../../../shared/connection-status.js";
import { nowMs } from "../../../../shared/format-age.js";
import { GranolaCard } from "@/modules/connections/components/GranolaCard";
import {
  granolaCheckLine,
  type GranolaWindowKey,
} from "@/modules/connections/domain/granola-round";
import { useGranolaStatusQuery } from "@/modules/connections/queries/connections-queries";
import {
  useCheckGranolaMutation,
  usePutGranolaMutation,
  useRunGranolaMutation,
} from "@/queries/granola-queries";

export function GranolaContainer() {
  const query = useGranolaStatusQuery();
  const put = usePutGranolaMutation();
  const check = useCheckGranolaMutation();
  const run = useRunGranolaMutation();
  const status = query.data ?? null;
  const enabled = status?.enabled === true;
  const running = status?.running === true;
  const saving = put.isPending;
  const checkResult: GranolaCheckResult | null =
    check.data ?? (check.isError ? { state: "failed" } : null);

  const save = (patch: { enabled: boolean } | { windowHours: number }) => {
    check.reset();
    put.mutate(patch);
  };

  return (
    <GranolaCard
      status={granolaCardStatus(status, checkResult, query.isError)}
      enabled={enabled}
      toggleDisabled={status === null || saving}
      windowKey={
        String(
          status?.windowHours ?? DEFAULT_GRANOLA_WINDOW_HOURS,
        ) as GranolaWindowKey
      }
      checking={check.isPending}
      analyzeDisabled={!enabled || running || saving}
      checkLine={granolaCheckLine(checkResult)}
      runLine={status !== null ? granolaRunLine(status, nowMs()) : null}
      running={running}
      onToggleEnabled={(next) => save({ enabled: next })}
      onWindowChange={(key) => save({ windowHours: Number(key) })}
      onCheck={() => check.mutate()}
      onAnalyze={() => {
        check.reset();
        run.mutate();
      }}
    />
  );
}
