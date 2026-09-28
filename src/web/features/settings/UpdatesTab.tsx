import { useEffect, useState, type CSSProperties } from "react";
import type { UpdateStatus } from "../../../shared/types.js";
import { getUpdateStatus, runUpdate } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Notice } from "../../primitives/Notice.js";
import {
  settingsRowStyle,
  settingsTabStyle,
  settingsTextStyle,
} from "./settings-styles.js";

const MANUAL_COMMAND = "npm i -g @theyashgupta/dispatch@latest";

type UpdateStatusRead =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; status: UpdateStatus };

type RunPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; version: string }
  | { kind: "error"; command: string };

export interface UpdatesTab {
  read: UpdateStatusRead;
  phase: RunPhase;
  handleRunUpdate: () => Promise<void>;
}

export function useUpdatesTab(): UpdatesTab {
  const [read, setRead] = useState<UpdateStatusRead>({ kind: "loading" });
  const [phase, setPhase] = useState<RunPhase>({ kind: "idle" });

  useEffect(() => {
    let active = true;
    void getUpdateStatus()
      .then((status) => {
        if (active) setRead({ kind: "ready", status });
      })
      .catch((err: unknown) => {
        console.error("getUpdateStatus failed", err);
        if (active) setRead({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleRunUpdate() {
    setPhase({ kind: "pending" });
    try {
      const result = await runUpdate();
      setPhase(
        result.ok
          ? { kind: "success", version: result.version }
          : { kind: "error", command: result.command || MANUAL_COMMAND },
      );
    } catch {
      setPhase({ kind: "error", command: MANUAL_COMMAND });
    }
  }

  return { read, phase, handleRunUpdate };
}

const mutedTextStyle: CSSProperties = {
  ...settingsTextStyle,
  color: "var(--text-muted)",
};

interface UpdatesTabSectionProps {
  updatesTab: UpdatesTab;
}

export function UpdatesTabSection({ updatesTab }: UpdatesTabSectionProps) {
  const { read, phase, handleRunUpdate } = updatesTab;

  if (read.kind === "loading") return null;
  if (read.kind === "error") {
    return (
      <span style={mutedTextStyle}>
        Couldn't check for updates. Reopen settings to retry.
      </span>
    );
  }

  const { status } = read;
  const canUpdate = status.installMode === "global" && status.updateAvailable;
  const pending = phase.kind === "pending";

  return (
    <div className="scroll-stable-y" style={settingsTabStyle}>
      <div style={settingsRowStyle}>
        <Field>Current version</Field>
        <span style={settingsTextStyle}>{`v${status.current}`}</span>
      </div>
      <div style={settingsRowStyle}>
        <Field>Latest version</Field>
        <span style={settingsTextStyle}>
          {status.latest ? `v${status.latest}` : "Unknown"}
        </span>
      </div>
      {canUpdate ? (
        <div>
          <Button
            variant="primary"
            disabled={pending || phase.kind === "success"}
            loading={pending}
            onClick={() => void handleRunUpdate()}
          >
            {pending ? "Updating…" : "Run update"}
          </Button>
        </div>
      ) : (
        status.installMode !== "global" && (
          <span style={mutedTextStyle}>
            {`Installed with ${status.installMode}. Update it with your package manager.`}
          </span>
        )
      )}
      {phase.kind === "success" && (
        <span role="status" style={settingsTextStyle}>
          {`Updated to v${phase.version}. Restart dispatch to use it`}
        </span>
      )}
      {phase.kind === "error" && (
        <div role="alert" style={settingsRowStyle}>
          <Notice
            tone="destructive"
            label="Couldn't update automatically. Run it yourself:"
          />
          <Notice tone="muted" mono clamp>
            {phase.command}
          </Notice>
        </div>
      )}
    </div>
  );
}
