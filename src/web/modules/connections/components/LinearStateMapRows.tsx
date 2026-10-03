import { AlertTriangle } from "lucide-react";
import { MAPPED_COLUMNS } from "../../../../shared/linear-state-map.js";
import { COLUMN_LABELS } from "../../../../shared/column-labels.js";
import type {
  LinearStateMap,
  MappedColumn,
  WorkflowTeam,
} from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingButton } from "@/components/LoadingButton";
import {
  choiceFromSelectValue,
  NO_SYNC_VALUE,
  selectValueFor,
} from "@/modules/connections/domain/linear-state-map";

interface LinearStateMapRowsProps {
  workflowError: string | null;
  loadError: boolean;
  teams: WorkflowTeam[] | null;
  draft: LinearStateMap | null;
  saving: boolean;
  saveResult: { ok: true } | { ok: false; error: string } | null;
  onChoose: (teamId: string, column: MappedColumn, value: string) => void;
  onSave: () => void;
}

const SECTION_LABEL = "text-sm font-semibold text-muted-foreground";

function Problem({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertDescription className="font-semibold">{message}</AlertDescription>
    </Alert>
  );
}

export function LinearStateMapRows({
  workflowError,
  loadError,
  teams,
  draft,
  saving,
  saveResult,
  onChoose,
  onSave,
}: LinearStateMapRowsProps) {
  return (
    <section
      aria-label="Linear state map"
      className="flex min-w-0 flex-col gap-4 border-t border-border py-4 pr-4"
    >
      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-foreground">
          Linear states for board columns
        </span>
        <span className="text-base text-muted-foreground">
          A manual move or a session start sets the chosen Linear state.
        </span>
      </div>
      {workflowError !== null && <Problem message={workflowError} />}
      {loadError && (
        <Problem message="Couldn't load the state map. Reopen settings to retry." />
      )}
      {teams &&
        draft &&
        teams.map((team) => (
          <div key={team.id} className="flex min-w-0 flex-col gap-2">
            <span className={SECTION_LABEL}>
              {team.name} ({team.key})
            </span>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-2">
              {MAPPED_COLUMNS.map((column) => (
                <div key={column} className="flex min-w-0 flex-col gap-1">
                  <span className="text-sm text-muted-foreground">
                    {COLUMN_LABELS[column]}
                  </span>
                  <Select
                    value={selectValueFor(draft[team.id]?.[column])}
                    onValueChange={(value) =>
                      onChoose(team.id, column, choiceFromSelectValue(value))
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full min-w-0"
                      aria-label={`${team.name} ${COLUMN_LABELS[column]}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {team.states.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                      <SelectItem value={NO_SYNC_VALUE}>Do not sync</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        ))}
      {teams && draft && (
        <div>
          <LoadingButton variant="secondary" onClick={onSave} loading={saving}>
            {saving ? "Saving…" : "Save state map"}
          </LoadingButton>
        </div>
      )}
      {saveResult?.ok === true && (
        <span className="text-sm text-muted-foreground">State map saved.</span>
      )}
      {saveResult?.ok === false && <Problem message={saveResult.error} />}
    </section>
  );
}
