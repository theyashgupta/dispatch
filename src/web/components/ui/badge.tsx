import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const badgeVariants = cva(
  "inline-flex h-4.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1 text-xs font-semibold whitespace-nowrap transition-[color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [a&]:hover:bg-(--hover-button-primary)",
        secondary:
          "bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive-fill text-on-danger [a&]:hover:bg-(--hover-button-danger)",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground [a&]:active:bg-(--pressed-card-hover)",
        ghost:
          "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground [a&]:active:bg-(--pressed-card-hover)",
        link: "text-(--accent-text) underline-offset-4 [a&]:hover:underline [a&]:active:bg-(--pressed-card-hover)",
      },
      tone: {
        neutral: "border-border bg-transparent text-muted-foreground",
        accent:
          "bg-[color-mix(in_srgb,var(--accent)_16%,var(--surface-card))] text-(--accent-text)",
        success:
          "bg-[color-mix(in_srgb,var(--status-ok)_16%,var(--surface-card))] text-(--status-ok)",
        warning:
          "bg-[color-mix(in_srgb,var(--status-stale)_16%,var(--surface-card))] text-(--status-stale)",
        danger:
          "bg-[color-mix(in_srgb,var(--destructive)_16%,var(--surface-card))] text-destructive-text",
        state:
          "max-w-full min-w-0 shrink bg-[color-mix(in_srgb,var(--badge-state)_12%,transparent)] text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))] before:size-1.5 before:shrink-0 before:rounded-full before:bg-(--badge-state) before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  tone,
  stateColor,
  style,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean;
    stateColor?: string;
  }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={tone ? undefined : variant}
      data-tone={tone}
      className={cn(
        badgeVariants({ variant: tone ? null : variant, tone }),
        className,
      )}
      style={
        stateColor === undefined
          ? style
          : ({ ...style, "--badge-state": stateColor } as React.CSSProperties)
      }
      {...props}
    />
  );
}

export { Badge, badgeVariants };
