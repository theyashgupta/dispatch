import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "shadow-sm flex flex-col gap-6 rounded-md border bg-card py-6 text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

const cardVariants = cva("", {
  variants: {
    identity: {
      rest: "border-border",
      hover: "border-(--text-muted)",
      multi: "border-(--text)",
      attention: "border-(--accent)",
    },
    surface: {
      rest: "bg-card",
      hover: "bg-(--surface-card-hover)",
      pressed: "bg-(--pressed-card)",
      "pressed-hover": "bg-(--pressed-card-hover)",
      elevated: "bg-card",
    },
    density: {
      default: "p-(--card-padding)",
      compact: "p-(--card-padding-compact)",
    },
    dimmed: { true: "opacity-40", false: "" },
  },
  compoundVariants: [
    {
      identity: ["rest", "hover"],
      surface: "elevated",
      className: "shadow-(--shadow-float)",
    },
    {
      identity: "attention",
      surface: ["rest", "hover", "pressed", "pressed-hover"],
      className: "shadow-card-attention",
    },
    {
      identity: "attention",
      surface: "elevated",
      className: "shadow-card-attention-float",
    },
    {
      identity: "multi",
      surface: ["rest", "hover", "pressed", "pressed-hover"],
      className: "shadow-card-multi",
    },
    {
      identity: "multi",
      surface: "elevated",
      className: "shadow-card-multi-float",
    },
  ],
});

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
};
