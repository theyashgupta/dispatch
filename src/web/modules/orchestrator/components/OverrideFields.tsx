import type {
  OverrideErrors,
  OverrideOptions,
  OverrideValues,
} from "@/modules/orchestrator/domain/override-form";
import { SelectField } from "./SelectField";
import { TextField } from "./TextField";

interface OverrideFieldsProps {
  idPrefix: string;
  values: OverrideValues;
  options: OverrideOptions;
  errors: OverrideErrors;
  onChange: (patch: Partial<OverrideValues>) => void;
}

export function OverrideFields({
  idPrefix,
  values,
  options,
  errors,
  onChange,
}: OverrideFieldsProps) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-(--space-md) border-0 p-0">
      <legend className="mb-(--space-sm) p-0 text-sm font-semibold text-foreground">
        Overrides (narrow only)
      </legend>
      <SelectField
        id={`${idPrefix}-concurrency-cap`}
        label="Loops at once"
        value={values.concurrencyCap}
        options={options.concurrencyCap}
        onChange={(concurrencyCap) => onChange({ concurrencyCap })}
      />
      <SelectField
        id={`${idPrefix}-ship-rights`}
        label="Ship rights"
        value={values.shipRights}
        options={options.shipRights}
        onChange={(shipRights) => onChange({ shipRights })}
      />
      <SelectField
        id={`${idPrefix}-roadmap-approval`}
        label="Roadmap approval"
        value={values.roadmapApproval}
        options={options.roadmapApproval}
        onChange={(roadmapApproval) => onChange({ roadmapApproval })}
      />
      <SelectField
        id={`${idPrefix}-usage-limit`}
        label="At a usage limit"
        value={values.usageLimit}
        options={options.usageLimit}
        onChange={(usageLimit) => onChange({ usageLimit })}
      />
      <TextField
        id={`${idPrefix}-budget`}
        label="Budget per group (USD)"
        value={values.budgetPerGroup}
        placeholder="Same as board"
        error={errors.budgetPerGroup}
        onChange={(budgetPerGroup) => onChange({ budgetPerGroup })}
      />
    </fieldset>
  );
}
