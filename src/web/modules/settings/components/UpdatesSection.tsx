import type { UpdateStatus } from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Caption } from "@/modules/settings/components/Caption";
import { LoadingButton } from "@/components/LoadingButton";
import type { RunPhase } from "@/modules/settings/domain/update-run";

interface UpdatesSectionProps {
  status: UpdateStatus | undefined;
  loadError: boolean;
  phase: RunPhase;
  onRunUpdate: () => void;
}

export function UpdatesSection({
  status,
  loadError,
  phase,
  onRunUpdate,
}: UpdatesSectionProps) {
  if (loadError) {
    return (
      <span className="text-base text-muted-foreground">
        Couldn't check for updates. Reopen settings to retry.
      </span>
    );
  }
  if (!status) return null;

  const canUpdate = status.installMode === "global" && status.updateAvailable;
  const pending = phase.kind === "pending";

  return (
    <>
      <Field className="gap-1">
        <Caption>Current version</Caption>
        <span className="text-base text-foreground">{`v${status.current}`}</span>
      </Field>
      <Field className="gap-1">
        <Caption>Latest version</Caption>
        <span className="text-base text-foreground">
          {status.latest ? `v${status.latest}` : "Unknown"}
        </span>
      </Field>
      {canUpdate ? (
        <div>
          <LoadingButton
            disabled={pending || phase.kind === "success"}
            loading={pending}
            onClick={onRunUpdate}
          >
            {pending ? "Updating…" : "Run update"}
          </LoadingButton>
        </div>
      ) : (
        status.installMode !== "global" && (
          <span className="text-base text-muted-foreground">
            {`Installed with ${status.installMode}. Update it with your package manager.`}
          </span>
        )
      )}
      {phase.kind === "success" && (
        <span role="status" className="text-base text-foreground">
          {`Updated to v${phase.version}. Restart dispatch to use it`}
        </span>
      )}
      {phase.kind === "error" && (
        <Alert variant="destructive" className="flex flex-col gap-1">
          <AlertDescription className="font-semibold">
            Couldn't update automatically. Run it yourself:
          </AlertDescription>
          <code className="line-clamp-3 font-mono text-xs [overflow-wrap:anywhere] whitespace-pre-wrap text-muted-foreground">
            {phase.command}
          </code>
        </Alert>
      )}
    </>
  );
}
