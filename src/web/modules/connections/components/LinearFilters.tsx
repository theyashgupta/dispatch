import type { ReactNode } from "react";
import type {
  FilterDimension,
  FilterOption,
  SourceFilters,
} from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FilterMultiSelect } from "@/modules/connections/components/FilterMultiSelect";
import {
  MULTI_COPY,
  type MultiDim,
} from "@/modules/connections/domain/linear-filters";

interface LinearFiltersProps {
  loadError: boolean;
  dimensions: FilterDimension[] | null;
  draft: SourceFilters | null;
  options: Record<MultiDim, FilterOption[]>;
  optLoading: Record<MultiDim, boolean>;
  optError: Record<MultiDim, boolean>;
  optTruncated: Record<MultiDim, boolean>;
  previewText: string;
  saveError: boolean;
  onChange: (next: SourceFilters) => void;
  stateMap: ReactNode;
}

const SECTION_LABEL = "text-sm font-semibold text-muted-foreground";
const HELP = "text-base text-muted-foreground";

export function LinearFilters({
  loadError,
  dimensions,
  draft,
  options,
  optLoading,
  optError,
  optTruncated,
  previewText,
  saveError,
  onChange,
  stateMap,
}: LinearFiltersProps) {
  return (
    <>
      <h2 className="m-0 text-lg font-semibold text-foreground">
        Sync filters
      </h2>
      {loadError && (
        <span className={HELP}>
          Couldn't load filters. Reopen settings to retry.
        </span>
      )}
      {dimensions && draft && (
        <div className="flex min-h-0 flex-col gap-4">
          {dimensions.map((dim) =>
            dim === "cycle" ? (
              <div key="cycle" className="flex flex-col gap-1">
                <span className={SECTION_LABEL}>Current cycle</span>
                <Label className="cursor-pointer gap-2 text-base font-normal">
                  <Checkbox
                    checked={draft.currentCycle}
                    onCheckedChange={() =>
                      onChange({ ...draft, currentCycle: !draft.currentCycle })
                    }
                  />
                  Current cycle only
                </Label>
                <span className={HELP}>
                  Backlog tickets often have no cycle, so this can drop matches
                  to near zero.
                </span>
              </div>
            ) : (
              <div key={dim} className="flex flex-col gap-1">
                <span className={SECTION_LABEL}>{MULTI_COPY[dim].label}</span>
                <FilterMultiSelect
                  label={MULTI_COPY[dim].label}
                  placeholder={MULTI_COPY[dim].placeholder}
                  options={options[dim]}
                  selected={draft[dim]}
                  loading={optLoading[dim]}
                  loadError={optError[dim]}
                  emptyText={MULTI_COPY[dim].emptyText}
                  onChange={(next) => onChange({ ...draft, [dim]: next })}
                />
                {optError[dim] && (
                  <span className={HELP}>
                    Couldn't load options. Reopen settings to retry.
                  </span>
                )}
                {optTruncated[dim] && (
                  <span className={HELP}>Showing first 250 options.</span>
                )}
              </div>
            ),
          )}
          <div className="flex flex-col gap-1">
            <span className={SECTION_LABEL}>Active tickets</span>
            <Label className="cursor-pointer gap-2 text-base font-normal">
              <Checkbox
                checked={draft.includeActive}
                onCheckedChange={() =>
                  onChange({ ...draft, includeActive: !draft.includeActive })
                }
              />
              Include active tickets (In Progress, In Review, ...)
            </Label>
          </div>
          <span className={HELP}>{previewText}</span>
          {saveError && (
            <Alert variant="destructive">
              <AlertDescription className="font-semibold">
                Couldn't save filters. Try again.
              </AlertDescription>
            </Alert>
          )}
          {stateMap}
        </div>
      )}
    </>
  );
}
