import { Button } from "@/components/ui/button";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SelectOption } from "@/modules/orchestrator/domain/orchestrator-models";
import {
  ROADMAP_APPROVAL_OPTIONS,
  SHIP_RIGHTS_OPTIONS,
  USAGE_LIMIT_OPTIONS,
  type PolicyFormErrors,
  type PolicyFormValues,
} from "@/modules/orchestrator/domain/policy-form";
import { SelectField } from "./SelectField";
import { TextField } from "./TextField";

interface PolicyFormProps {
  boardName: string;
  values: PolicyFormValues;
  errors: PolicyFormErrors;
  loopOptions: readonly SelectOption[];
  modelOptions: readonly SelectOption[];
  dirty: boolean;
  pending: boolean;
  onChange: (patch: Partial<PolicyFormValues>) => void;
  onSubmit: () => void;
}

export function PolicyForm({
  boardName,
  values,
  errors,
  loopOptions,
  modelOptions,
  dirty,
  pending,
  onChange,
  onSubmit,
}: PolicyFormProps) {
  return (
    <form
      noValidate
      aria-label={`Policy for ${boardName}`}
      className="flex flex-col gap-(--space-md)"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex flex-col gap-(--space-xs)">
        <h3 className="m-0 text-lg font-semibold text-foreground">
          {`Policy for ${boardName}`}
        </h3>
        <p className="m-0 text-sm text-muted-foreground">
          Only you can change this policy. The orchestrator reads it. No tool
          can change it.
        </p>
      </div>
      <SelectField
        id="policy-roadmap-approval"
        label="Roadmap approval"
        value={values.roadmapApproval}
        options={ROADMAP_APPROVAL_OPTIONS}
        onChange={(value) =>
          onChange({
            roadmapApproval: value as PolicyFormValues["roadmapApproval"],
          })
        }
      />
      <TextField
        id="policy-concurrency-cap"
        label="Loops at once"
        value={values.concurrencyCap}
        error={errors.concurrencyCap}
        onChange={(concurrencyCap) => onChange({ concurrencyCap })}
      />
      <SelectField
        id="policy-loop-model"
        label="Loop model"
        value={values.loopModel}
        options={loopOptions}
        onChange={(loopModel) => onChange({ loopModel })}
      />
      <SelectField
        id="policy-orchestrator-model"
        label="Orchestrator model"
        value={values.orchestratorModel}
        options={modelOptions}
        onChange={(orchestratorModel) => onChange({ orchestratorModel })}
      />
      <TextField
        id="policy-handoff-percent"
        label="Handoff at context percent"
        value={values.handoffPercent}
        error={errors.handoffPercent}
        onChange={(handoffPercent) => onChange({ handoffPercent })}
      />
      <TextField
        id="policy-handoff-hard-percent"
        label="Hard handoff at context percent"
        value={values.handoffHardPercent}
        error={errors.handoffHardPercent}
        onChange={(handoffHardPercent) => onChange({ handoffHardPercent })}
      />
      <Field>
        <Label id="policy-usage-limit-label">At a usage limit</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby="policy-usage-limit-label"
          value={values.usageLimit}
          onValueChange={(value) => {
            if (value !== "") {
              onChange({ usageLimit: value as PolicyFormValues["usageLimit"] });
            }
          }}
        >
          {USAGE_LIMIT_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
      <SelectField
        id="policy-ship-rights"
        label="Ship rights"
        value={values.shipRights}
        options={SHIP_RIGHTS_OPTIONS}
        onChange={(value) =>
          onChange({ shipRights: value as PolicyFormValues["shipRights"] })
        }
      />
      <TextField
        id="policy-budget"
        label="Budget per group (USD)"
        value={values.budgetPerGroup}
        placeholder="No limit"
        error={errors.budgetPerGroup}
        onChange={(budgetPerGroup) => onChange({ budgetPerGroup })}
      />
      <Field>
        <Label htmlFor="policy-supervisor">Supervisor</Label>
        <div className="flex items-center gap-(--space-sm)">
          <Switch
            id="policy-supervisor"
            checked={values.supervisor === "on"}
            onCheckedChange={(checked) =>
              onChange({ supervisor: checked ? "on" : "off" })
            }
          />
          <span className="text-sm text-foreground">
            {values.supervisor === "on" ? "On" : "Off"}
          </span>
        </div>
        <FieldDescription>
          The supervisor watches the loops of this board. An orchestrator needs
          it.
        </FieldDescription>
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={!dirty || pending}>
          Save policy
        </Button>
      </div>
    </form>
  );
}
