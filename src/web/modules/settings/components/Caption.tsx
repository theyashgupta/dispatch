import type { ReactNode } from "react";
import { FieldTitle } from "@/components/ui/field";

export function Caption({ children }: { children: ReactNode }) {
  return (
    <FieldTitle className="font-semibold text-muted-foreground">
      {children}
    </FieldTitle>
  );
}
