import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import type {
  UpdateRunResult,
  UpdateStatus,
} from "../../../../shared/types.js";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const MANUAL_COMMAND = "npm i -g @theyashgupta/dispatch@latest";
const NPX_COMMAND = "npx @theyashgupta/dispatch@latest";

interface UpdateBannerProps {
  status: UpdateStatus | null;
  dismissedVersion: string | null;
  onDismiss: (version: string) => void;
  onRunUpdate: () => void;
  pending: boolean;
  result: UpdateRunResult | undefined;
  failed: boolean;
}

const rowClass =
  "h-(--page-header-height) flex-none items-center justify-between rounded-none border-0 border-b border-border bg-(--surface-column) px-4 py-0 text-sm font-semibold select-none flex";

function Dot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`size-2 flex-none rounded-full ${className}`}
    />
  );
}

export function UpdateBanner({
  status,
  dismissedVersion,
  onDismiss,
  onRunUpdate,
  pending,
  result,
  failed,
}: UpdateBannerProps) {
  const [copied, setCopied] = useState(false);
  const runButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const settled = !pending && result !== undefined;
  const version = settled && result.ok ? result.version : null;
  const errored = !pending && (failed || (settled && !result.ok));
  const failedCommand =
    result?.ok === false ? result.command || MANUAL_COMMAND : MANUAL_COMMAND;

  useEffect(() => {
    if (!errored) return;
    const id = requestAnimationFrame(() => runButtonRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [errored]);

  function handleCopy(command: string) {
    void navigator.clipboard.writeText(command).then(() => setCopied(true));
  }

  if (version) {
    return (
      <Alert role="status" aria-live="polite" className={rowClass}>
        <div className="flex items-center gap-1 text-(--status-ok)">
          <Dot className="bg-(--status-ok)" />
          {`Updated to v${version}. Restart dispatch to use it`}
        </div>
      </Alert>
    );
  }

  if (!status || !status.updateAvailable || status.latest == null) {
    return null;
  }
  const idle = !pending && !settled && !errored;
  if (idle && status.latest === dismissedVersion) {
    return null;
  }

  const message = pending
    ? "Running update…"
    : status.installMode === "global"
      ? `Update available: v${status.latest}`
      : status.installMode === "npx"
        ? `Update available: v${status.latest}. Run:`
        : `Update available: v${status.latest}. This is a dev checkout. Pull the latest changes to update.`;

  return (
    <div className="flex flex-col">
      <Alert role="status" aria-live="polite" className={rowClass}>
        <div className="flex items-center gap-1 text-foreground">
          <Dot className="bg-(--status-stale)" />
          <span>{message}</span>
          {status.installMode === "npx" && (
            <>
              <span className="font-mono font-semibold text-muted-foreground">
                {NPX_COMMAND}
              </span>
              <Button
                variant="ghost"
                size="icon-md"
                className="text-muted-foreground"
                aria-label={copied ? "Copied" : "Copy update command"}
                onClick={() => handleCopy(NPX_COMMAND)}
              >
                <Copy />
              </Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status.installMode === "global" && (
            <Button
              ref={runButtonRef}
              size="sm"
              className="font-semibold"
              disabled={pending}
              aria-busy={pending}
              onClick={onRunUpdate}
            >
              {pending ? "Updating…" : "Run update"}
            </Button>
          )}
          {!pending && (
            <Button
              variant="ghost"
              size="icon-md"
              className="text-muted-foreground"
              aria-label="Dismiss update notice"
              onClick={() => {
                if (status.latest) onDismiss(status.latest);
              }}
            >
              <X />
            </Button>
          )}
        </div>
      </Alert>
      {errored && (
        <Alert
          variant="destructive"
          className="grid-cols-1 gap-2 rounded-none border-0 border-b border-border bg-(--surface-column) px-4 py-2"
        >
          <AlertTitle className="col-start-1 line-clamp-none text-sm font-semibold">
            Couldn&apos;t update automatically. Run it yourself:
          </AlertTitle>
          <p className="col-start-1 line-clamp-3 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
            {failedCommand}
          </p>
        </Alert>
      )}
    </div>
  );
}
