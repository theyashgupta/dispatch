import { useRef } from "react";
import { TriangleAlert } from "lucide-react";
import type { WorkflowTeam } from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { CardActionDialog } from "./CardActionDialog";
import { ModalActions } from "./ModalActions";
import { ModalBody } from "./ModalBody";
import { ModalFieldLabel } from "./ModalFieldLabel";
import { useTabIntoDialog } from "@/modules/card-actions/hooks/use-tab-into-dialog";
import { TEAM_DEFAULT_STATE } from "@/modules/card-actions/domain/sync-target";

interface SyncToLinearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  loading: boolean;
  loadError: string | null;
  teams: WorkflowTeam[];
  teamId: string | undefined;
  onTeamChange: (teamId: string) => void;
  stateChoice: string;
  onStateChange: (choice: string) => void;
  pending: boolean;
  syncError: string | null;
  onSync: () => void;
}

export function SyncToLinearDialog({
  open,
  onOpenChange,
  onCancel,
  loading,
  loadError,
  teams,
  teamId,
  onTeamChange,
  stateChoice,
  onStateChange,
  pending,
  syncError,
  onSync,
}: SyncToLinearDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  useTabIntoDialog(contentRef);
  const states = teams.find((t) => t.id === teamId)?.states ?? [];
  const ready = !loading && loadError === null;
  return (
    <CardActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onCancel={onCancel}
      title="Sync to Linear"
      contentRef={contentRef}
      onOpenAutoFocus={(event) => event.preventDefault()}
    >
      <ModalBody>
        <div className="flex flex-col gap-4">
          {loading && <Spinner />}
          {loadError !== null && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription className="font-semibold">
                {loadError}
              </AlertDescription>
            </Alert>
          )}
          {ready && (
            <>
              <Field className="gap-1">
                <ModalFieldLabel htmlFor="sync-linear-team">
                  Team
                </ModalFieldLabel>
                <Select value={teamId ?? ""} onValueChange={onTeamChange}>
                  <SelectTrigger
                    id="sync-linear-team"
                    aria-label="Team"
                    size="sm"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {teams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field className="gap-1">
                <ModalFieldLabel htmlFor="sync-linear-state">
                  State
                </ModalFieldLabel>
                <Select value={stateChoice} onValueChange={onStateChange}>
                  <SelectTrigger
                    id="sync-linear-state"
                    aria-label="State"
                    size="sm"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TEAM_DEFAULT_STATE}>
                      Team default
                    </SelectItem>
                    {states.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </>
          )}
          {syncError !== null && (
            <Alert variant="destructive">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription className="font-semibold">
                {syncError}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </ModalBody>
      <ModalActions>
        <Button
          variant="secondary"
          size="sm"
          className="px-2"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="px-4"
          disabled={!ready || !teamId || pending}
          onClick={onSync}
        >
          {pending ? "Syncing…" : "Sync to Linear"}
        </Button>
      </ModalActions>
    </CardActionDialog>
  );
}
