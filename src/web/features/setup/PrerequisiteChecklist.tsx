import {
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Check, X } from "lucide-react";
import type { PrerequisiteStatus, SetupChecks } from "../../../shared/types.js";
import { runPrerequisiteInstall } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Notice } from "../../primitives/Notice.js";

export type RowInstall =
  { phase: "installing" } | { phase: "failed"; command: string };

export type RowInstalls = Record<string, RowInstall>;

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  flexWrap: "wrap",
};

const labelTextStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

const commandTextStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const dotStyle: CSSProperties = {
  flex: "0 0 auto",
  width: "8px",
  height: "8px",
  borderRadius: "50%",
};

const failedStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
};

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

interface SystemRowProps {
  label: string;
  ok: boolean;
  detail: string;
}

function SystemRow({ label, ok, detail }: SystemRowProps) {
  return (
    <div style={rowStyle}>
      <span
        aria-hidden
        style={{
          ...dotStyle,
          background: ok ? "var(--status-ok)" : "var(--status-stale)",
        }}
      />
      <span style={labelTextStyle}>{label}</span>
      <span style={commandTextStyle}>{detail}</span>
    </div>
  );
}

interface PrerequisiteChecklistProps extends SetupChecks {
  installState: RowInstalls;
  onInstallStateChange: Dispatch<SetStateAction<RowInstalls>>;
  onInstalled: (status: PrerequisiteStatus) => void;
}

export function PrerequisiteChecklist({
  prerequisites,
  node,
  storage,
  installState,
  onInstallStateChange: setInstallState,
  onInstalled,
}: PrerequisiteChecklistProps) {
  const [liveMessage, setLiveMessage] = useState("");
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  async function handleInstall(name: string, fallbackCommand: string) {
    setInstallState((s) => ({ ...s, [name]: { phase: "installing" } }));
    setLiveMessage(`Installing ${name}…`);
    try {
      const result = await runPrerequisiteInstall(name);
      if (result.ok) {
        onInstalled(result.status);
        setInstallState((s) => {
          const next = { ...s };
          delete next[name];
          return next;
        });
        setLiveMessage(`${name} installed`);
        return;
      }
      setInstallState((s) => ({
        ...s,
        [name]: { phase: "failed", command: result.command || fallbackCommand },
      }));
    } catch {
      setInstallState((s) => ({
        ...s,
        [name]: { phase: "failed", command: fallbackCommand },
      }));
    }
    setLiveMessage(`Couldn't install ${name}`);
    requestAnimationFrame(() => buttonRefs.current[name]?.focus());
  }

  return (
    <div style={listStyle}>
      <Field>System prerequisites</Field>
      {prerequisites.map((p) => {
        const st = installState[p.name];
        const installing = st?.phase === "installing";
        const commandText = p.command ?? p.hint;
        const rowLabel = p.present
          ? `${p.name} installed`
          : p.installable
            ? `${p.name} missing. Install with ${commandText ?? "your package manager"}`
            : `${p.name} missing. See ${commandText ?? "the docs"}`;
        return (
          <div key={p.name} role="group" style={rowStyle} aria-label={rowLabel}>
            {p.present ? (
              <Check
                size={16}
                strokeWidth={2}
                color="var(--status-ok)"
                aria-hidden
              />
            ) : (
              <X
                size={16}
                strokeWidth={2}
                color="var(--destructive)"
                aria-hidden
              />
            )}
            <span style={labelTextStyle}>{p.name}</span>
            {!p.present && commandText && (
              <span style={commandTextStyle}>{commandText}</span>
            )}
            {!p.present && p.installable && (
              <Button
                variant="secondary"
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
              <div role="alert" style={failedStyle}>
                <Notice
                  tone="destructive"
                  label={
                    st.command
                      ? `Couldn't install ${p.name}. Run it yourself:`
                      : `Couldn't install ${p.name}.`
                  }
                />
                {st.command && (
                  <Notice tone="muted" mono clamp>
                    {st.command}
                  </Notice>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div style={{ height: "var(--space-xs)" }} />
      <Field>System</Field>
      <SystemRow
        label="Node"
        ok={node.ok}
        detail={
          node.ok
            ? `v${node.version}`
            : `v${node.version}, below supported floor (${node.floor})`
        }
      />
      <SystemRow
        label="Storage"
        ok={storage.ok}
        detail={
          storage.ok ? `OK: ${storage.path}` : `check failed: ${storage.path}`
        }
      />

      <span role="status" aria-live="polite" aria-atomic style={visuallyHidden}>
        {liveMessage}
      </span>
    </div>
  );
}
