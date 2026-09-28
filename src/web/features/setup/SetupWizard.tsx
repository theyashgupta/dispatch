import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { SetupChecks, SourceConnection } from "../../../shared/types.js";
import { addWorkspaceFolder, getSourceConnection } from "../../lib/api.js";
import {
  ALL_CONNECTIONS,
  LINEAR_CONNECTION,
} from "../../lib/connection-meta.js";
import {
  SETUP_STEPS,
  canGoNext,
  nextStep,
  previousStep,
  skipConnection,
  type SetupStep,
} from "../../lib/setup-wizard.js";
import { Button } from "../../primitives/Button.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import {
  LinearConnectionCard,
  SoonConnectionCards,
} from "../connections/index.js";
import { WorkspaceAdd } from "../workspaces/index.js";
import {
  PrerequisiteChecklist,
  type RowInstalls,
} from "./PrerequisiteChecklist.js";
import { SetupMap } from "./SetupMap.js";

const STEP_TITLE: Record<SetupStep, string> = {
  welcome: "Welcome to Dispatch",
  linear: "Connect Linear",
  sources: "More sources are on the way",
  workspace: "Add a workspace",
  finish: "You're set up",
};

const subtitleStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

const fixedTopStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "0 0 auto",
};

const progressStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: `repeat(${SETUP_STEPS.length}, 1fr)`,
  gap: "var(--space-xs)",
};

const progressSegmentStyle: CSSProperties = {
  height: "4px",
  borderRadius: "var(--radius-sm)",
};

const stepBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
};

const bodyTextStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  paddingTop: "var(--space-lg)",
  borderTop: "1px solid var(--border)",
};

const footerRightStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  marginLeft: "auto",
};

const finishRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-lg)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

interface SetupWizardProps extends SetupChecks {
  onClose: (linearChanged: boolean) => void;
}

interface LinearSeen {
  baseline: string | null;
  latest: string | null;
}

function noteLinear(seen: LinearSeen, c: SourceConnection) {
  const signature = `${c.configured}|${c.connected}|${c.account ?? ""}`;
  seen.baseline ??= signature;
  seen.latest = signature;
}

export function SetupWizard({
  onClose,
  prerequisites,
  node,
  storage,
}: SetupWizardProps) {
  const [step, setStep] = useState<SetupStep>("welcome");
  const [linearConnected, setLinearConnected] = useState(false);
  const [rows, setRows] = useState(prerequisites);
  const [installState, setInstallState] = useState<RowInstalls>({});
  const cardReportedRef = useRef(false);
  const linearSeenRef = useRef<LinearSeen>({ baseline: null, latest: null });
  const modalRef = useRef<ModalControl>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const skipConnectionRef = useRef<HTMLButtonElement>(null);
  const stepNumber = SETUP_STEPS.indexOf(step) + 1;

  useEffect(() => {
    let active = true;
    void getSourceConnection(LINEAR_CONNECTION.source)
      .then((c) => {
        if (!active || cardReportedRef.current) return;
        noteLinear(linearSeenRef.current, c);
        setLinearConnected(c.connected);
      })
      .catch((err: unknown) => {
        console.error("getSourceConnection failed", err);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const primary = primaryRef.current;
    (primary && !primary.disabled
      ? primary
      : skipConnectionRef.current
    )?.focus();
  }, [step]);

  const handleLinearConnection = useCallback((c: SourceConnection) => {
    cardReportedRef.current = true;
    noteLinear(linearSeenRef.current, c);
    setLinearConnected(c.connected);
  }, []);

  async function handleAddWorkspace(path: string): Promise<string | null> {
    try {
      const result = await addWorkspaceFolder(path);
      return result.ok ? null : result.error;
    } catch (err) {
      console.error("addWorkspaceFolder failed", err);
      return "Couldn't reach the server. Try again.";
    }
  }

  const handleClose = () => modalRef.current?.requestClose();

  return (
    <Modal
      ariaLabel="Setup"
      onClose={() =>
        onClose(linearSeenRef.current.latest !== linearSeenRef.current.baseline)
      }
      controlRef={modalRef}
      initialFocusRef={primaryRef}
      dialogStyle={{
        width: "min(720px, calc(100vw - 32px))",
        maxHeight: "calc(100vh - 32px)",
      }}
    >
      <Modal.Header>{STEP_TITLE[step]}</Modal.Header>
      <Modal.Body>
        <div style={fixedTopStyle}>
          <p style={subtitleStyle} aria-live="polite">
            Setup, step {stepNumber} of {SETUP_STEPS.length}
          </p>
          <div style={progressStyle} aria-hidden="true">
            {SETUP_STEPS.map((s, i) => (
              <span
                key={s}
                style={{
                  ...progressSegmentStyle,
                  background:
                    i < stepNumber ? "var(--text-muted)" : "var(--border)",
                }}
              />
            ))}
          </div>
          <SetupMap linearConnected={linearConnected} />
        </div>
        <div className="scroll-stable-y" style={stepBodyStyle}>
          {step === "welcome" && (
            <>
              <p style={bodyTextStyle}>
                Dispatch pulls your work from the tools you use into one board
                on this machine. Connect a source now or skip and do it later
                from Settings.
              </p>
              <PrerequisiteChecklist
                prerequisites={rows}
                node={node}
                storage={storage}
                installState={installState}
                onInstallStateChange={setInstallState}
                onInstalled={(status) =>
                  setRows((rs) =>
                    rs.map((r) => (r.name === status.name ? status : r)),
                  )
                }
              />
            </>
          )}
          {step === "linear" && (
            <LinearConnectionCard onConnection={handleLinearConnection} />
          )}
          {step === "sources" && (
            <>
              <p style={bodyTextStyle}>
                GitHub, Slack, Sentry, Meetings and Calendar arrive in later
                releases.
              </p>
              <SoonConnectionCards />
            </>
          )}
          {step === "workspace" && (
            <WorkspaceAdd
              onAdd={handleAddWorkspace}
              hint="Add a folder that contains the git repos you start tickets in."
              fullWidthSubmit
            />
          )}
          {step === "finish" && (
            <>
              {ALL_CONNECTIONS.map(({ source, name }) => {
                const on =
                  linearConnected && source === LINEAR_CONNECTION.source;
                return (
                  <div key={source} style={finishRowStyle}>
                    <span>{name}</span>
                    <span
                      style={{
                        color: on ? "var(--status-ok)" : "var(--text-muted)",
                      }}
                    >
                      {on ? "Connected" : "Not connected"}
                    </span>
                  </div>
                );
              })}
              <p style={bodyTextStyle}>
                Change connections any time in Settings, Connections.
              </p>
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Actions>
        <div style={footerStyle}>
          {step !== "finish" && (
            <Button onClick={handleClose}>Skip for now</Button>
          )}
          <div style={footerRightStyle}>
            {step !== "welcome" && (
              <Button onClick={() => setStep(previousStep(step))}>Back</Button>
            )}
            {step === "linear" && (
              <Button
                ref={skipConnectionRef}
                onClick={() => setStep(skipConnection(step))}
              >
                Skip this connection
              </Button>
            )}
            <Button
              ref={primaryRef}
              variant="primary"
              disabled={!canGoNext(step, linearConnected)}
              onClick={() =>
                step === "finish"
                  ? handleClose()
                  : setStep(nextStep(step, linearConnected))
              }
            >
              {step === "finish" ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </Modal.Actions>
    </Modal>
  );
}
