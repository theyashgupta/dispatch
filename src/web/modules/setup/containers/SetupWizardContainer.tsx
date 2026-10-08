import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouteContext } from "@tanstack/react-router";
import { DEFAULT_BOARD_KEY } from "../../../../shared/board-key.js";
import { LINEAR_CONNECTION } from "../../../../shared/connection-meta.js";
import {
  nextStep,
  previousStep,
  shouldMarkOnboardingDone,
  shouldOpenSetupWizard,
  skipConnection,
  type SetupStep,
} from "../../../../shared/setup-wizard.js";
import type { SetupChecks } from "../../../../shared/types.js";
import { SetupDialog } from "@/modules/setup/components/SetupDialog";
import { SetupStepBody } from "@/modules/setup/components/SetupStepBody";
import {
  linearChanged,
  noteLinear,
  type LinearSeen,
} from "@/modules/setup/domain/linear-signature";
import {
  clearInstall,
  failInstall,
  replaceStatus,
  startInstall,
  type RowInstalls,
} from "@/modules/setup/domain/prerequisite-install";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { markOnboardingDone } from "@/modules/setup/queries/setup-api";
import { useRunPrerequisiteInstallMutation } from "@/modules/setup/queries/setup-queries";
import { useSourceConnectionQuery } from "@/queries/source-connection-queries";
import {
  useAddWorkspaceFolderMutation,
  useFolderBrowser,
} from "@/queries/workspace-folders-queries";

interface SetupWizardContainerProps extends SetupChecks {
  onClose: (linearChanged: boolean) => void;
  connections: ReactNode;
}

export function SetupWizardContainer({
  onClose,
  connections,
  prerequisites,
  node,
  storage,
}: SetupWizardContainerProps) {
  const [step, setStep] = useState<SetupStep>("welcome");
  const [rows, setRows] = useState(prerequisites);
  const [installState, setInstallState] = useState<RowInstalls>({});
  const linear = useSourceConnectionQuery(LINEAR_CONNECTION.source);
  const install = useRunPrerequisiteInstallMutation();
  const addFolder = useAddWorkspaceFolderMutation(DEFAULT_BOARD_KEY);
  const browser = useFolderBrowser();
  const linearSeenRef = useRef<LinearSeen>({ baseline: null, latest: null });
  const closedRef = useRef(false);
  const linearConnected = linear.data?.connected ?? false;

  useEffect(() => {
    if (linear.data) {
      linearSeenRef.current = noteLinear(linearSeenRef.current, linear.data);
    }
  }, [linear.data]);

  async function handleInstall(
    name: string,
    fallbackCommand: string,
  ): Promise<boolean> {
    setInstallState((s) => startInstall(s, name));
    try {
      const result = await install.mutateAsync(name);
      if (result.ok) {
        setRows((rs) => replaceStatus(rs, result.status));
        setInstallState((s) => clearInstall(s, name));
        return true;
      }
      setInstallState((s) =>
        failInstall(s, name, result.command || fallbackCommand),
      );
    } catch {
      setInstallState((s) => failInstall(s, name, fallbackCommand));
    }
    return false;
  }

  async function handleAddWorkspace(path: string): Promise<string | null> {
    try {
      const result = await addFolder.mutateAsync(path);
      return result.ok ? null : result.error;
    } catch {
      return "Couldn't reach the server. Try again.";
    }
  }

  function handleClose() {
    if (closedRef.current) return;
    closedRef.current = true;
    onClose(linearChanged(linearSeenRef.current));
  }

  return (
    <SetupDialog
      step={step}
      linearConnected={linearConnected}
      onClose={handleClose}
      onBack={() => setStep(previousStep(step))}
      onSkipConnection={() => setStep(skipConnection(step))}
      onNext={() =>
        step === "finish"
          ? handleClose()
          : setStep(nextStep(step, linearConnected))
      }
    >
      <SetupStepBody
        step={step}
        linearConnected={linearConnected}
        prerequisites={rows}
        node={node}
        storage={storage}
        installState={installState}
        onInstall={handleInstall}
        connections={connections}
        onAddWorkspace={handleAddWorkspace}
        browser={browser}
      />
    </SetupDialog>
  );
}

function finishOnboarding(): void {
  void markOnboardingDone().catch((err: unknown) => {
    console.error("markOnboardingDone failed", err);
  });
}

export function SetupWizardRequestContainer({
  connections,
}: {
  connections: ReactNode;
}) {
  const { appStore, setup } = useRouteContext({ from: "__root__" });
  const checks = useAppStore(appStore, (s) => s.setupWizard);
  const seeded = useRef(false);

  useLayoutEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (setup != null && shouldOpenSetupWizard(setup)) {
      appStore.openSetupWizard(setup);
    }
  }, [appStore, setup]);

  useEffect(() => {
    if (setup != null && shouldMarkOnboardingDone(setup)) finishOnboarding();
  }, [setup]);

  if (checks == null) return null;
  return (
    <SetupWizardContainer
      {...checks}
      onClose={(linearChanged) => {
        appStore.closeSetupWizard(linearChanged);
        finishOnboarding();
      }}
      connections={connections}
    />
  );
}
