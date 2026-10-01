import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingButton } from "@/components/LoadingButton";
import type { CredentialBusy } from "@/modules/connections/domain/source-connection-state";

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
    <Field className="min-w-0 gap-2">
      <Label
        htmlFor={inputId}
        className="text-sm font-semibold text-muted-foreground"
      >
        {label}
      </Label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Input
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
          className="h-8 w-auto min-w-0 flex-[1_1_220px] text-base md:text-base"
        />
        <LoadingButton
          disabled={!canSubmit}
          loading={busy === "connect"}
          onClick={() => void handleSubmit()}
        >
          {configured ? "Replace" : "Connect"}
        </LoadingButton>
        {!configured && useExistingLabel && onUseExisting && (
          <LoadingButton
            variant="secondary"
            disabled={!idle}
            onClick={onUseExisting}
          >
            {useExistingLabel}
          </LoadingButton>
        )}
      </div>
      {configured && (
        <div className="flex min-w-0 flex-wrap gap-2">
          <LoadingButton
            variant="secondary"
            disabled={!idle}
            loading={busy === "test"}
            onClick={onTest}
          >
            Test
          </LoadingButton>
          <LoadingButton
            variant={confirming ? "destructive" : "secondary"}
            disabled={!idle}
            loading={busy === "disconnect"}
            onClick={handleDisconnect}
          >
            {confirming ? "Confirm disconnect" : "Disconnect"}
          </LoadingButton>
        </div>
      )}
      {error && (
        <Alert variant="destructive" id={errorId}>
          <AlertDescription className="font-semibold">{error}</AlertDescription>
        </Alert>
      )}
    </Field>
  );
}
