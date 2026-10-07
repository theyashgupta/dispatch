import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { NumberSettingSection } from "@/components/NumberSettingSection";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { THRESHOLD_MAX } from "@/modules/accounts/domain/chain-settings";

const TERMS_TEXT =
  "Anthropic's terms do not address automatic moves between your own accounts. Automatic moves are off by default.";

export interface ChainThresholdControl {
  draft: string;
  invalid: boolean;
  saving: boolean;
  saveErrorText: string | null;
  savedText?: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export interface ChainSwitchNowControl {
  pending: boolean;
  note: { tone: "error" | "info"; text: string } | null;
  onSwitchNow: () => void;
}

interface ChainSettingsProps {
  autoMove: boolean;
  autoMovePending: boolean;
  autoMoveErrorText: string | null;
  threshold: ChainThresholdControl;
  switchNow: ChainSwitchNowControl;
  onAutoMoveChange: (value: boolean) => void;
}

export function ChainSettings({
  autoMove,
  autoMovePending,
  autoMoveErrorText,
  threshold,
  switchNow,
  onAutoMoveChange,
}: ChainSettingsProps) {
  return (
    <div className="flex flex-col gap-4" data-testid="chain-settings">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Switch
            id="chain-auto-move"
            checked={autoMove}
            disabled={autoMovePending}
            onCheckedChange={onAutoMoveChange}
            data-testid="chain-auto-move"
          />
          <Label htmlFor="chain-auto-move" className="text-sm font-semibold">
            Automatic moves
          </Label>
        </div>
        <p
          className="m-0 text-xs text-muted-foreground"
          data-testid="chain-terms"
        >
          {TERMS_TEXT}
        </p>
        {autoMoveErrorText && <ErrorAlert>{autoMoveErrorText}</ErrorAlert>}
      </div>

      <NumberSettingSection
        id="chain-threshold"
        label="Move threshold (percent)"
        ariaLabel="Automatic move threshold in percent"
        max={THRESHOLD_MAX}
        hint="An account counts as limited once any usage window reaches this percent. 50 to 100."
        value={threshold.draft}
        invalid={threshold.invalid}
        invalidText="Enter a whole number between 50 and 100."
        saveErrorText={threshold.saveErrorText}
        saveLabel="Save threshold"
        saving={threshold.saving}
        savedText={threshold.savedText}
        inlineAction
        onChange={threshold.onChange}
        onSave={threshold.onSave}
      />

      <div className="flex flex-wrap items-center gap-2">
        <LoadingButton
          variant="secondary"
          loading={switchNow.pending}
          onClick={switchNow.onSwitchNow}
          data-testid="chain-switch-now"
        >
          Switch now
        </LoadingButton>
        {switchNow.note && (
          <span
            role={switchNow.note.tone === "error" ? "alert" : "status"}
            className={
              switchNow.note.tone === "error"
                ? "min-w-0 text-xs text-destructive-text"
                : "min-w-0 text-xs text-muted-foreground"
            }
            data-testid="chain-switch-now-note"
          >
            {switchNow.note.text}
          </span>
        )}
      </div>
    </div>
  );
}
