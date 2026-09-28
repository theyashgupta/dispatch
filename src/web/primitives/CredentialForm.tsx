import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import { Notice } from "./Notice.js";
import { focusRing } from "./focus-ring.js";

export type CredentialBusy = "load" | "connect" | "test" | "disconnect" | null;

interface CredentialFormProps {
  label: string;
  configured: boolean;
  busy: CredentialBusy;
  error: string | null;
  onConnect: (value: string) => Promise<boolean>;
  onTest: () => void;
  onDisconnect: () => void;
  useExistingLabel?: string;
  onUseExisting?: () => void;
}

const CONFIRM_MS = 5000;

const formStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const rowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
  minWidth: 0,
};

const inputStyle: CSSProperties = {
  flex: "1 1 220px",
  minWidth: 0,
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-column)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  userSelect: "text",
};

export function CredentialForm({
  label,
  configured,
  busy,
  error,
  onConnect,
  onTest,
  onDisconnect,
  useExistingLabel,
  onUseExisting,
}: CredentialFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [hasText, setHasText] = useState(false);
  const [focused, setFocused] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const idle = busy === null;
  const canSubmit = hasText && idle;

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function handleSubmit() {
    const input = inputRef.current;
    if (!canSubmit || !input || submitting.current) return;
    submitting.current = true;
    try {
      if (await onConnect(input.value.trim())) {
        input.value = "";
        setHasText(false);
      }
    } finally {
      submitting.current = false;
    }
  }

  function handleDisconnect() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onDisconnect();
  }

  return (
    <div style={formStyle}>
      <label htmlFor={inputId}>
        <Field>{label}</Field>
      </label>
      <div style={rowStyle}>
        <input
          id={inputId}
          ref={inputRef}
          type="password"
          placeholder={configured ? "Paste a new key to replace it" : ""}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error != null}
          aria-describedby={error ? errorId : undefined}
          readOnly={!idle}
          onChange={(event) => setHasText(event.target.value.trim() !== "")}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSubmit();
          }}
          onFocus={(event) =>
            setFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setFocused(false)}
          style={{ ...inputStyle, ...focusRing(focused) }}
        />
        <Button
          variant="primary"
          disabled={!canSubmit}
          loading={busy === "connect"}
          onClick={() => void handleSubmit()}
        >
          {configured ? "Replace" : "Connect"}
        </Button>
        {!configured && useExistingLabel && onUseExisting && (
          <Button variant="secondary" disabled={!idle} onClick={onUseExisting}>
            {useExistingLabel}
          </Button>
        )}
      </div>
      {configured && (
        <div style={rowStyle}>
          <Button
            variant="secondary"
            disabled={!idle}
            loading={busy === "test"}
            onClick={onTest}
          >
            Test
          </Button>
          <Button
            variant={confirming ? "danger" : "secondary"}
            disabled={!idle}
            loading={busy === "disconnect"}
            onClick={handleDisconnect}
          >
            {confirming ? "Confirm disconnect" : "Disconnect"}
          </Button>
        </div>
      )}
      {error && (
        <div id={errorId}>
          <Notice tone="destructive" label={error} />
        </div>
      )}
    </div>
  );
}
