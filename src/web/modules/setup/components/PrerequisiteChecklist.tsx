import { useRef, useState } from "react";
import type { SetupChecks } from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  nodeDetail,
  prerequisiteRowLabel,
  storageDetail,
  type RowInstalls,
} from "@/modules/setup/domain/prerequisite-install";

interface PrerequisiteChecklistProps extends SetupChecks {
  installState: RowInstalls;
  onInstall: (name: string, fallbackCommand: string) => Promise<boolean>;
}

interface SystemRowProps {
  label: string;
  ok: boolean;
  detail: string;
}

const SECTION_LABEL = "text-sm font-semibold text-muted-foreground";
const ROW = "flex flex-wrap items-center gap-1";
const LABEL = "text-base text-foreground";
const COMMAND = "font-mono text-sm font-semibold text-muted-foreground";

function SystemRow({ label, ok, detail }: SystemRowProps) {
  return (
    <div className={ROW}>
      <span
        aria-hidden
        className={cn(
          "size-2 flex-none rounded-full",
          ok ? "bg-(--status-ok)" : "bg-(--status-stale)",
        )}
      />
      <span className={LABEL}>{label}</span>
      <span className={COMMAND}>{detail}</span>
    </div>
  );
}

export function PrerequisiteChecklist({
  prerequisites,
  node,
  storage,
  installState,
  onInstall,
}: PrerequisiteChecklistProps) {
  const [liveMessage, setLiveMessage] = useState("");
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  async function handleInstall(name: string, fallbackCommand: string) {
    setLiveMessage(`Installing ${name}…`);
    if (await onInstall(name, fallbackCommand)) {
      setLiveMessage(`${name} installed`);
      return;
    }
    setLiveMessage(`Couldn't install ${name}`);
    requestAnimationFrame(() => buttonRefs.current[name]?.focus());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={SECTION_LABEL}>System prerequisites</div>
      {prerequisites.map((p) => {
        const st = installState[p.name];
        const installing = st?.phase === "installing";
        const commandText = p.command ?? p.hint;
        return (
          <div
            key={p.name}
            role="group"
            className={ROW}
            aria-label={prerequisiteRowLabel(p)}
          >
            <Checkbox checked={p.present} disabled aria-label={p.name} />
            <span className={LABEL}>{p.name}</span>
            {!p.present && commandText && (
              <span className={COMMAND}>{commandText}</span>
            )}
            {!p.present && p.installable && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                ref={(el) => {
                  buttonRefs.current[p.name] = el;
                }}
                disabled={installing}
                aria-busy={installing}
                aria-label={`Run install for ${p.name}`}
                onClick={() => void handleInstall(p.name, commandText ?? "")}
              >
                {installing ? "Installing…" : "Run install"}
              </Button>
            )}
            {!p.present && st?.phase === "failed" && (
              <div className="flex w-full flex-col gap-2">
                <Alert variant="destructive">
                  <AlertDescription className="font-semibold">
                    {st.command
                      ? `Couldn't install ${p.name}. Run it yourself:`
                      : `Couldn't install ${p.name}.`}
                  </AlertDescription>
                </Alert>
                {st.command && (
                  <Alert variant="muted">
                    <AlertDescription className="font-mono break-all">
                      {st.command}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="h-1" />
      <div className={SECTION_LABEL}>System</div>
      <SystemRow label="Node" ok={node.ok} detail={nodeDetail(node)} />
      <SystemRow
        label="Storage"
        ok={storage.ok}
        detail={storageDetail(storage)}
      />

      <span role="status" aria-live="polite" aria-atomic className="sr-only">
        {liveMessage}
      </span>
    </div>
  );
}
