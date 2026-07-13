import { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { PrerequisiteStatus } from "../../../shared/types.js";
import { getSetup, saveLinearKey } from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Glyph } from "../../primitives/Glyph.js";
import { Notice } from "../../primitives/Notice.js";

interface FirstRunSetupProps {
  onConnected: () => void;
}

const ERROR_COPY = {
  rejected: "Linear rejected that key. Double-check it and try again.",
  unreachable: "Couldn't reach Linear. Check your connection and try again.",
} as const;

export function FirstRunSetup({ onConnected }: FirstRunSetupProps) {
  const [value, setValue] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<"rejected" | "unreachable" | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [prerequisites, setPrerequisites] = useState<PrerequisiteStatus[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  useEffect(() => {
    let active = true;
    void getSetup()
      .then((s) => {
        if (active) setPrerequisites(s.prerequisites);
      })
      .catch((err: unknown) => {
        console.error("getSetup failed", err);
      });
    return () => {
      active = false;
    };
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && !connecting;

  async function handleConnect() {
    if (!canSubmit) return;
    setConnecting(true);
    setError(null);
    try {
      const result = await saveLinearKey(trimmed);
      if (result.ok || result.reason === "already-configured") {
        onConnected();
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

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-2xl)",
        color: "var(--text)",
        overflowY: "auto",
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
            userSelect: "none",
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
                boxShadow: inputFocused ? "0 0 0 2px var(--accent)" : "none",
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
          {prerequisites.map((p) => (
            <div
              key={p.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-xs)",
                flexWrap: "wrap",
              }}
              aria-label={
                p.present
                  ? `${p.name} installed`
                  : `${p.name} missing — install with ${p.hint ?? "your package manager"}`
              }
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
              {!p.present && p.hint && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--font-label)",
                    fontWeight: "var(--weight-semibold)",
                    lineHeight: "var(--line-label)",
                    color: "var(--text-muted)",
                  }}
                >
                  {p.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
