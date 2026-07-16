import { useEffect, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import type { UpdateStatus } from "../../../shared/types.js";
import { getUpdateStatus, runUpdate } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";

const DISMISS_KEY = "dispatch:update-dismissed-version";
const MANUAL_COMMAND = "npm i -g @theyashgupta/dispatch@latest";
const NPX_COMMAND = "npx @theyashgupta/dispatch@latest";

type Phase = "idle" | "pending" | "success" | "error";

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function writeDismissedVersion(version: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, version);
  } catch {}
}

const rowStyle = {
  height: "var(--strip-height)",
  flex: "0 0 var(--strip-height)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 var(--space-lg)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  userSelect: "none",
} as const;

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: color,
        flex: "0 0 auto",
      }}
    />
  );
}

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [successVersion, setSuccessVersion] = useState<string | null>(null);
  const [failedCommand, setFailedCommand] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    readDismissedVersion(),
  );
  const [copied, setCopied] = useState(false);
  const runButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    void getUpdateStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  async function handleRunUpdate() {
    setPhase("pending");
    try {
      const result = await runUpdate();
      if (result.ok) {
        setSuccessVersion(result.version);
        setPhase("success");
        return;
      }
      setFailedCommand(result.command || MANUAL_COMMAND);
      setPhase("error");
    } catch {
      setFailedCommand(MANUAL_COMMAND);
      setPhase("error");
    }
    requestAnimationFrame(() => runButtonRef.current?.focus());
  }

  function handleCopy(command: string) {
    void navigator.clipboard.writeText(command).then(() => setCopied(true));
  }

  function handleDismiss() {
    if (status?.latest) {
      writeDismissedVersion(status.latest);
      setDismissedVersion(status.latest);
    }
  }

  if (phase === "success" && successVersion) {
    return (
      <div style={rowStyle}>
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-xs)",
            color: "var(--status-ok)",
          }}
        >
          <Dot color="var(--status-ok)" />
          {`Updated to v${successVersion} — restart dispatch to use it`}
        </div>
      </div>
    );
  }

  if (!status || !status.updateAvailable || status.latest == null) {
    return null;
  }
  if (phase === "idle" && status.latest === dismissedVersion) {
    return null;
  }

  const pending = phase === "pending";
  const message = pending
    ? "Running update…"
    : status.installMode === "global"
      ? `Update available — v${status.latest}`
      : status.installMode === "npx"
        ? `Update available — v${status.latest}. Run:`
        : `Update available — v${status.latest}. This is a dev checkout — pull the latest changes to update.`;

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={rowStyle}>
        <div
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-xs)",
            color: "var(--text)",
          }}
        >
          <Dot color="var(--status-stale)" />
          <span>{message}</span>
          {status.installMode === "npx" && (
            <>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: "var(--weight-semibold)",
                  color: "var(--text-muted)",
                }}
              >
                {NPX_COMMAND}
              </span>
              <IconButton
                aria-label={copied ? "Copied" : "Copy update command"}
                onClick={() => handleCopy(NPX_COMMAND)}
              >
                <Copy size={14} />
              </IconButton>
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
          }}
        >
          {status.installMode === "global" && (
            <Button
              ref={runButtonRef}
              variant="primary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => void handleRunUpdate()}
            >
              {pending ? "Updating…" : "Run update"}
            </Button>
          )}
          {!pending && (
            <IconButton
              aria-label="Dismiss update notice"
              onClick={handleDismiss}
            >
              <X size={16} />
            </IconButton>
          )}
        </div>
      </div>
      {phase === "error" && failedCommand && (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-lg)",
            background: "var(--surface-column)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <Notice
            tone="destructive"
            label="Couldn't update automatically. Run it yourself:"
          />
          <Notice tone="muted" mono clamp>
            {failedCommand}
          </Notice>
        </div>
      )}
    </div>
  );
}
