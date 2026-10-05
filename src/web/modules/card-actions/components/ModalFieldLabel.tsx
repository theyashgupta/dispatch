import type { ComponentProps } from "react";
import { FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function ModalFieldLabel({
  className,
  ...props
}: ComponentProps<typeof FieldLabel>) {
  return (
    <FieldLabel
      className={cn(
        "cursor-auto leading-(--line-label) font-semibold text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
