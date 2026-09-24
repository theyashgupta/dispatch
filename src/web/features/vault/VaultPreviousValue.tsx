import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { VaultKeySummary } from "../../../shared/types.js";
import { getVaultPrevious } from "../../lib/api.js";
import { IconButton } from "../../primitives/IconButton.js";

const MASKED_VALUE = "\u2022".repeat(12);

interface VaultPreviousValueProps {
  keySummary: VaultKeySummary;
}

export function VaultPreviousValue({ keySummary }: VaultPreviousValueProps) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    if (revealed !== null) {
      setRevealed(null);
      return;
    }
    setPending(true);
    setError(false);
    try {
      const result = await getVaultPrevious(keySummary.name);
      if (result.ok) {
        setRevealed(result.value);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-testid={`vault-previous-${keySummary.name}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        minWidth: 0,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-micro)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text-muted)",
        }}
      >
        Previous
      </span>
      <span
        data-revealed={revealed !== null ? "true" : "false"}
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          lineHeight: "var(--line-label)",
          color: revealed !== null ? "var(--text)" : "var(--text-muted)",
          whiteSpace: "normal",
          wordBreak: "break-all",
          userSelect: revealed !== null ? "text" : "none",
        }}
      >
        {error
          ? "Couldn't load previous value, try again."
          : (revealed ?? MASKED_VALUE)}
      </span>
      <IconButton
        aria-label={
          revealed !== null
            ? `Hide previous value for ${keySummary.name}`
            : `Show previous value for ${keySummary.name}`
        }
        aria-pressed={revealed !== null}
        disabled={pending}
        onClick={() => void toggle()}
      >
        {revealed !== null ? (
          <EyeOff size={14} strokeWidth={2} aria-hidden="true" />
        ) : (
          <Eye size={14} strokeWidth={2} aria-hidden="true" />
        )}
      </IconButton>
    </div>
  );
}
