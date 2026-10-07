import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-(--hover-button-primary) active:bg-(--pressed-button-primary)",
        destructive:
          "bg-destructive-fill text-on-danger hover:bg-(--hover-button-danger) active:bg-(--pressed-button-danger)",
        outline:
          "shadow-xs border bg-background hover:bg-accent hover:text-accent-foreground active:bg-(--pressed-card-hover) dark:border-input dark:bg-input/30 dark:hover:bg-input/50 dark:active:bg-(--pressed-card-hover)",
        surface:
          "shadow-xs border border-border bg-card hover:bg-accent hover:text-accent-foreground active:bg-(--pressed-card-hover) dark:border-border dark:bg-card dark:hover:bg-input/50 dark:active:bg-(--pressed-card-hover)",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        "secondary-bordered":
          "border border-border bg-secondary font-semibold text-secondary-foreground hover:bg-accent",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-(--pressed-card-hover)",
        link: "text-(--accent-text) underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-md": "size-7",
        "icon-compact": "h-8 w-7.5",
        "icon-lg": "size-10",
      },
    },
    compoundVariants: [
      {
        variant: "secondary-bordered",
        size: "sm",
        className: "px-2",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
