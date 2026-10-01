import { MEETING_CONNECTION } from "../../../../shared/connection-meta.js";
import type { SourceCardStatus } from "../../../../shared/types.js";
import { SourceIcon } from "@/components/badges";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";
import { LoadingButton } from "@/components/LoadingButton";
import {
  GRANOLA_WINDOW_LABELS,
  type GranolaWindowKey,
} from "@/modules/connections/domain/granola-round";

interface GranolaCardProps {
  status: SourceCardStatus;
  enabled: boolean;
  toggleDisabled: boolean;
  windowKey: GranolaWindowKey;
  checking: boolean;
  analyzeDisabled: boolean;
  checkLine: string | null;
  runLine: string | null;
  running: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onWindowChange: (key: GranolaWindowKey) => void;
  onCheck: () => void;
  onAnalyze: () => void;
}

export function GranolaCard({
  status,
  enabled,
  toggleDisabled,
  windowKey,
  checking,
  analyzeDisabled,
  checkLine,
  runLine,
  running,
  onToggleEnabled,
  onWindowChange,
  onCheck,
  onAnalyze,
}: GranolaCardProps) {
  return (
    <ConnectionCard
      badge={<SourceIcon source={MEETING_CONNECTION.source} />}
      name={MEETING_CONNECTION.name}
      status={status}
      credentialLabel={MEETING_CONNECTION.credentialLabel}
      steps={MEETING_CONNECTION.steps}
      footer={MEETING_CONNECTION.footer}
      toggle={{
        label: "Enabled",
        checked: enabled,
        disabled: toggleDisabled,
        onChange: onToggleEnabled,
      }}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">
            Review window
          </span>
          <Select
            value={windowKey}
            onValueChange={(key) => onWindowChange(key as GranolaWindowKey)}
          >
            <SelectTrigger size="sm" aria-label="Review window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(GRANOLA_WINDOW_LABELS) as GranolaWindowKey[]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {GRANOLA_WINDOW_LABELS[key]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <LoadingButton
            variant="secondary"
            onClick={onCheck}
            loading={checking}
          >
            Check connection
          </LoadingButton>
          <LoadingButton
            variant="secondary"
            onClick={onAnalyze}
            disabled={analyzeDisabled}
          >
            Analyze now
          </LoadingButton>
        </div>
        {checkLine !== null && (
          <span
            role="status"
            className="inline-flex items-center gap-1 text-sm [overflow-wrap:anywhere] text-muted-foreground"
          >
            {checkLine}
          </span>
        )}
        {runLine !== null && (
          <span className="inline-flex items-center gap-1 text-sm [overflow-wrap:anywhere] text-muted-foreground">
            {running && <Spinner aria-hidden="true" className="size-3.5" />}
            {runLine}
          </span>
        )}
      </div>
    </ConnectionCard>
  );
}
