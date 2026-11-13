import { Gauge } from "lucide-react";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadError } from "@/modules/settings/components/LoadError";
import type {
  UsageThresholdField,
  UsageThresholdsDraft,
} from "@/modules/settings/domain/usage-thresholds-draft";

const FIELDS: { field: UsageThresholdField; label: string; hint: string }[] = [
  {
    field: "warning",
    label: "Warning (%)",
    hint: "Usage shows the warning colour from this percent.",
  },
  {
    field: "critical",
    label: "Critical (%)",
    hint: "Usage shows the critical colour from this percent.",
  },
  {
    field: "session",
    label: "Session limit (%)",
    hint: "The account counts as limited when the session window reaches this percent.",
  },
  {
    field: "weekly_all",
    label: "Weekly limit (%)",
    hint: "The account counts as limited when the weekly window reaches this percent.",
  },
  {
    field: "weekly_scoped",
    label: "Weekly scoped limit (%)",
    hint: "The same for the weekly window of one model, such as Opus.",
  },
];

interface UsageThresholdsSectionProps {
  draft: UsageThresholdsDraft;
  loaded: boolean;
  saving: boolean;
  invalidText: string | null;
  saveErrorText: string | null;
  loadError: boolean;
  onFieldChange: (field: UsageThresholdField, value: string) => void;
  onSave: () => void;
  onReset: () => void;
}

export function UsageThresholdsSection({
  draft,
  loaded,
  saving,
  invalidText,
  saveErrorText,
  loadError,
  onFieldChange,
  onSave,
  onReset,
}: UsageThresholdsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      {loadError && (
        <LoadError text="Couldn't load the usage thresholds. Reopen settings to retry." />
      )}
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge aria-hidden="true" className="size-4" />
            Usage thresholds
          </CardTitle>
          <FieldDescription>
            Colour usage by your own numbers, and treat an account as limited
            before Claude does. 100 means Claude's own limit.
          </FieldDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2">
          {FIELDS.map(({ field, label, hint }) => (
            <Field key={field} className="gap-1">
              <Label htmlFor={`usage-threshold-${field}`}>{label}</Label>
              <div>
                <Input
                  id={`usage-threshold-${field}`}
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={draft[field]}
                  disabled={!loaded}
                  aria-invalid={invalidText !== null || undefined}
                  onChange={(e) => onFieldChange(field, e.target.value)}
                  className="h-8 w-24 text-base md:text-base"
                />
              </div>
              <FieldDescription>{hint}</FieldDescription>
            </Field>
          ))}
        </CardContent>
        {(invalidText || saveErrorText) && (
          <CardContent className="flex flex-col gap-2 px-4">
            {invalidText && (
              <FieldError className="text-sm font-semibold">
                {invalidText}
              </FieldError>
            )}
            {saveErrorText && <ErrorAlert>{saveErrorText}</ErrorAlert>}
          </CardContent>
        )}
      </Card>
      <div className="flex items-center gap-2">
        <LoadingButton
          disabled={!loaded || invalidText !== null}
          loading={saving}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save thresholds"}
        </LoadingButton>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!loaded || saving}
          onClick={onReset}
        >
          Reset to defaults
        </Button>
      </div>
    </section>
  );
}
