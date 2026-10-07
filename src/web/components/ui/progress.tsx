"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Progress as ProgressPrimitive } from "radix-ui";

const progressIndicatorVariants = cva(
  "h-full w-full flex-1 transition-transform",
  {
    variants: {
      tone: {
        default: "bg-foreground",
        ok: "bg-(--status-ok)",
        stale: "bg-(--status-stale)",
        down: "bg-(--status-down)",
        marker: "border-r-2 border-muted-foreground bg-transparent",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

function Progress({
  className,
  value,
  tone,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> &
  VariantProps<typeof progressIndicatorVariants>) {
  const indicatorStyle = {
    transform: `translateX(-${100 - (value || 0)}%)`,
  };
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-foreground/20",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-tone={tone ?? undefined}
        className={progressIndicatorVariants({ tone })}
        style={indicatorStyle}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
