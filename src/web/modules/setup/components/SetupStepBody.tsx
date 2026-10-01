import type { ComponentProps, ReactNode } from "react";
import { ALL_CONNECTIONS } from "../../../../shared/connection-meta.js";
import type { SetupChecks } from "../../../../shared/types.js";
import type { SetupStep } from "../../../../shared/setup-wizard.js";
import { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { cn } from "@/lib/utils";
import { PrerequisiteChecklist } from "@/modules/setup/components/PrerequisiteChecklist";
import { sourceConnected } from "@/modules/setup/domain/linear-lit";
import type { RowInstalls } from "@/modules/setup/domain/prerequisite-install";

interface SetupStepBodyProps extends SetupChecks {
  step: SetupStep;
  linearConnected: boolean;
  installState: RowInstalls;
  onInstall: (name: string, fallbackCommand: string) => Promise<boolean>;
  connections: ReactNode;
  onAddWorkspace: (path: string) => Promise<string | null>;
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
}

const BODY_TEXT = "text-base text-foreground";

export function SetupStepBody({
  step,
  linearConnected,
  prerequisites,
  node,
  storage,
  installState,
  onInstall,
  connections,
  onAddWorkspace,
  browser,
}: SetupStepBodyProps) {
  switch (step) {
    case "welcome":
      return (
        <>
          <p className={BODY_TEXT}>
            Dispatch pulls your work from the tools you use into one board on
            this machine. Connect a source now or skip and do it later from
            Settings.
          </p>
          <PrerequisiteChecklist
            prerequisites={prerequisites}
            node={node}
            storage={storage}
            installState={installState}
            onInstall={onInstall}
          />
        </>
      );
    case "linear":
      return connections;
    case "sources":
      return (
        <p className={BODY_TEXT}>
          Connect GitHub and Sentry any time in Settings, Connections. Slack,
          Meetings and Calendar arrive in later releases.
        </p>
      );
    case "workspace":
      return (
        <WorkspaceAdd
          onAdd={onAddWorkspace}
          hint="Add a folder that contains the git repos you start tickets in."
          fullWidthSubmit
          browser={browser}
        />
      );
    case "finish":
      return (
        <>
          {ALL_CONNECTIONS.map(({ source, name }) => {
            const on = sourceConnected(source, linearConnected);
            return (
              <div
                key={source}
                className={cn("flex justify-between gap-4", BODY_TEXT)}
              >
                <span>{name}</span>
                <span
                  className={
                    on ? "text-(--status-ok)" : "text-muted-foreground"
                  }
                >
                  {on ? "Connected" : "Not connected"}
                </span>
              </div>
            );
          })}
          <p className={BODY_TEXT}>
            Change connections any time in Settings, Connections.
          </p>
        </>
      );
  }
}
