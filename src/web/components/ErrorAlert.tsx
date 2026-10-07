import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ErrorAlertProps {
  children: ReactNode;
}

export function ErrorAlert({ children }: ErrorAlertProps) {
  return (
    <Alert variant="destructive">
      <AlertDescription className="font-semibold">{children}</AlertDescription>
    </Alert>
  );
}
