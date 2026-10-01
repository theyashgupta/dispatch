"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "cn";

const Toaster = (props: ToasterProps & { theme: "light" | "dark" }) => {
  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius-lg)",
        } as React.CSSProperties
      }
      {...props}
      toastOptions={{
        ...props.toastOptions,
        classNames: {
          ...props.toastOptions?.classNames,
          toast: cn(
            "shadow-(--shadow-float)! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
            props.toastOptions?.classNames?.toast,
          ),
          actionButton: cn(
            "focus-visible:shadow-none! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
            props.toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            "focus-visible:shadow-none! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
            props.toastOptions?.classNames?.cancelButton,
          ),
          closeButton: cn(
            "focus-visible:shadow-none! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
            props.toastOptions?.classNames?.closeButton,
          ),
          description: cn(
            "text-muted-foreground!",
            props.toastOptions?.classNames?.description,
          ),
        },
      }}
    />
  );
};

export { Toaster };
