import { useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { PrerequisiteStatus } from "../../../shared/types.js";
import {
  addWorkspaceFolder,
  runPrerequisiteInstall,
  saveLinearKey,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Glyph } from "../../primitives/Glyph.js";
import { Notice } from "../../primitives/Notice.js";
import { WorkspaceAdd } from "../workspaces/index.js";

interface FirstRunSetupProps {
  prerequisites: PrerequisiteStatus[];
  node: { version: string; floor: string; ok: boolean };
  storage: { ok: boolean; path: string };
  onConnected: () => void;
}

type RowInstall =
  { phase: "installing" } | { phase: "failed"; command: string };

const ERROR_COPY = {
  rejected: "Linear rejected that key. Double-check it and try again.",
  unreachable: "Couldn't reach Linear. Check your connection and try again.",
} as const;

const visuallyHidden = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

export function FirstRunSetup({
  prerequisites,
  node,
  storage,
  onConnected,
}: FirstRunSetupProps) {
  const [step, setStep] = useState<"connect" | "workspace">("connect");
  const [addedThisSession, setAddedThisSession] = useState(false);
  const [value, setValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<"rejected" | "unreachable" | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [rows, setRows] = useState<PrerequisiteStatus[]>(prerequisites);
  const [installState, setInstallState] = useState<Record<string, RowInstall>>(
    {},
  );
  const [liveMessage, setLiveMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  async function handleInstall(name: string, fallbackCommand: string) {
    setInstallState((s) => ({ ...s, [name]: { phase: "installing" } }));
    setLiveMessage(`Installing ${name}…`);
    try {
      const result = await runPrerequisiteInstall(name);
      if (result.ok) {
        setRows((rs) => rs.map((r) => (r.name === name ? result.status : r)));
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
    requestAnimationFrame(() => buttonRefs.current[name]?.focus());
  }

  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && !connecting;

  async function handleConnect() {
    if (!canSubmit) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await saveLinearKey(trimmed);
      if (result.ok || result.reason === "already-configured") {
        setStep("workspace");
        return;
      }
      setError(result.reason);
    } catch (err) {
      console.error("saveLinearKey failed", err);
      setError("unreachable");
    } finally {
      setConnecting(false);
      inputRef.current?.focus();
    }
  }

  async function onAddWorkspace(path: string): Promise<string | null> {
    try {
      const result = await addWorkspaceFolder(path);
      if (!result.ok) return result.error;
      setAddedThisSession(true);
      return null;
    } catch (err) {
      console.error("addWorkspaceFolder failed", err);
      return "Couldn't reach the server. Try again.";
    }
  }

  return (
    <div
      className="scroll-stable-y"
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-2xl)",
        color: "var(--text)",
        overflowY: "auto",
        userSelect: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xl)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-sm)",
          }}
        >
          <Glyph size={44} />
          <span
            style={{
              fontWeight: 800,
              fontSize: "var(--font-display)",
              letterSpacing: "0.18em",
            }}
          >
            DISPATCH
          </span>
        </div>

        {step === "connect" ? (
          <>
            <span
              style={{
                textAlign: "center",
                fontSize: "var(--font-heading)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-heading)",
                color: "var(--text)",
              }}
            >
              Connect your Linear workspace
            </span>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-lg)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <label htmlFor={inputId}>
                  <Field>Linear API key</Field>
                </label>
                <input
                  id={inputId}
                  ref={inputRef}
                  type="text"
                  value={value}
                  placeholder="lin_api_..."
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  readOnly={connecting}
                  aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                  aria-invalid={error != null}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleConnect();
                  }}
                  onFocus={(e) =>
                    setInputFocused(e.currentTarget.matches(":focus-visible"))
                  }
                  onBlur={() => setInputFocused(false)}
                  style={{
                    height: "32px",
                    padding: "0 var(--space-lg)",
                    background: "var(--surface-card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    color: "var(--text)",
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    outline: "none",
                    boxShadow: inputFocused
                      ? "0 0 0 2px var(--accent)"
                      : "none",
                    userSelect: "text",
                  }}
                />
                <span
                  id={hintId}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  Create a personal key at linear.app/settings/api. It's stored
                  locally at 0600 and only ever sent to Linear.
                </span>
                {error && (
                  <div id={errorId} role="alert">
                    <Notice tone="destructive" label={ERROR_COPY[error]} />
                  </div>
                )}
              </div>
              <Button
                variant="primary"
                style={{ width: "100%" }}
                disabled={!canSubmit}
                aria-busy={connecting}
                onClick={() => void handleConnect()}
              >
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <span
              style={{
                textAlign: "center",
                fontSize: "var(--font-heading)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-heading)",
                color: "var(--text)",
              }}
            >
              Add a workspace
            </span>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-lg)",
              }}
            >
              <WorkspaceAdd
                onAdd={onAddWorkspace}
                hint="Add a folder that contains the git repos for this ticket."
                fullWidthSubmit
              />
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-sm)",
                }}
              >
                <Button
                  variant="secondary"
                  style={{ width: "100%" }}
                  onClick={onConnected}
                >
                  Skip for now
                </Button>
                <Button
                  variant="primary"
                  style={{ width: "100%" }}
                  disabled={!addedThisSession}
                  onClick={onConnected}
                >
                  Continue
                </Button>
              </div>
            </div>
          </>
        )}

        <div
          style={{ height: "1px", background: "var(--border)", width: "100%" }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}
        >
          <Field>System prerequisites</Field>
          {rows.map((p) => {
            const st = installState[p.name];
            const installing = st?.phase === "installing";
            const failedCommand = st?.phase === "failed" ? st.command : null;
            const commandText = p.command ?? p.hint;
            const rowLabel = p.present
              ? `${p.name} installed`
              : p.installable
                ? `${p.name} missing — install with ${commandText ?? "your package manager"}`
                : `${p.name} missing — see ${commandText ?? "the docs"}`;
            return (
              <div
                key={p.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-xs)",
                  flexWrap: "wrap",
                }}
                aria-label={rowLabel}
              >
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
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text)",
                  }}
                >
                  {p.name}
                </span>
                {!p.present && commandText && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-label)",
                      fontWeight: "var(--weight-semibold)",
                      lineHeight: "var(--line-label)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {commandText}
                  </span>
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
                    onClick={() =>
                      void handleInstall(p.name, commandText ?? "")
                    }
                  >
                    {installing ? "Installing…" : "Run install"}
                  </Button>
                )}
                {failedCommand && (
                  <div
                    role="alert"
                    style={{
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: "var(--space-sm)",
                    }}
                  >
                    <Notice
                      tone="destructive"
                      label={`Couldn't install ${p.name}. Run it yourself:`}
                    />
                    <Notice tone="muted" mono clamp>
                      {failedCommand}
                    </Notice>
                  </div>
                )}
              </div>
            );
          })}

          <div style={{ height: "var(--space-xs)" }} />
          <Field>System</Field>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
            }}
            aria-label={
              node.ok
                ? `Node v${node.version}`
                : `Node v${node.version} — below supported floor (${node.floor})`
            }
          >
            <span
              aria-hidden
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: node.ok
                  ? "var(--status-ok)"
                  : "var(--status-stale)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--font-body)",
                lineHeight: "var(--line-body)",
                color: "var(--text)",
              }}
            >
              Node
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              {node.ok
                ? `v${node.version}`
                : `v${node.version} — below supported floor (${node.floor})`}
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-xs)",
            }}
            aria-label={
              storage.ok
                ? `Storage OK — ${storage.path}`
                : `Storage check failed — ${storage.path}`
            }
          >
            <span
              aria-hidden
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: storage.ok
                  ? "var(--status-ok)"
                  : "var(--status-stale)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: "var(--font-body)",
                lineHeight: "var(--line-body)",
                color: "var(--text)",
              }}
            >
              Storage
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-semibold)",
                lineHeight: "var(--line-label)",
                color: "var(--text-muted)",
              }}
            >
              {storage.ok
                ? `OK — ${storage.path}`
                : `check failed — ${storage.path}`}
            </span>
          </div>

          <span
            role="status"
            aria-live="polite"
            aria-atomic
            style={visuallyHidden}
          >
            {liveMessage}
          </span>
        </div>
      </div>
    </div>
  );
}
