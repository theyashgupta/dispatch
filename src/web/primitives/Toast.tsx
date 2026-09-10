import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";

interface ToastProps {
  label: ReactNode;
  detail?: ReactNode;
  actionLabel?: string;
  actionPending?: boolean;
  onAction?: () => void;
  onClose: () => void;
}

export function Toast({
  label,
  detail,
  actionLabel,
  actionPending = false,
  onAction,
  onClose,
}: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "var(--space-xl)",
        transform: "translateX(-50%)",
        zIndex: 19,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        maxWidth: "min(560px, calc(100vw - 2 * var(--space-lg)))",
        padding:
          "var(--space-sm) var(--space-md) var(--space-sm) var(--space-lg)",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-float)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-body)",
        lineHeight: "var(--line-body)",
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span>{label}</span>
        {detail && (
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--destructive-text)",
            }}
          >
            {detail}
          </span>
        )}
      </div>
      {actionLabel && onAction && (
        <Button
          variant="primary"
          onClick={onAction}
          disabled={actionPending}
          style={{ flex: "0 0 auto" }}
        >
          {actionPending ? `${actionLabel}…` : actionLabel}
        </Button>
      )}
      <IconButton aria-label="Dismiss" onClick={onClose}>
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
