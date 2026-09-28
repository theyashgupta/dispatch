import { AlertTriangle } from "lucide-react";

export function WarningIcon() {
  return (
    <AlertTriangle
      size={12}
      strokeWidth={2}
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    />
  );
}
