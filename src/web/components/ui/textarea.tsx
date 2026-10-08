import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const textareaVariants = cva(
  "shadow-xs flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-input/30",
  {
    variants: {
      variant: {
        default: "",
        surface: "border-border bg-card dark:bg-card",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Textarea({
  className,
  variant,
  ...props
}: React.ComponentProps<"textarea"> & VariantProps<typeof textareaVariants>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(textareaVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Textarea };
