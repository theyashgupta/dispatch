import type { ReactNode, Ref } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PanelAlert } from "./PanelNotice";

interface PanelFrameProps {
  open: boolean;
  docked: boolean;
  fullscreen: boolean;
  asideRef: Ref<HTMLElement>;
  onScrimClick: () => void;
  children: ReactNode;
}

export function PanelFrame({
  open,
  docked,
  fullscreen,
  asideRef,
  onScrimClick,
  children,
}: PanelFrameProps) {
  return (
    <>
      {!docked && (
        <div
          onClick={onScrimClick}
          aria-hidden="true"
          className={cn(
            "fixed inset-0 z-10 bg-scrim transition-opacity",
            open
              ? "pointer-events-auto opacity-100 duration-(--motion-panel-open) ease-(--easing-enter)"
              : "pointer-events-none opacity-0 duration-(--motion-panel-close) ease-(--easing-exit)",
          )}
        />
      )}

      <aside
        aria-label="Ticket detail"
        ref={asideRef}
        inert={!docked && !open}
        data-docked={docked ? "true" : undefined}
        className={cn(
          "fixed right-0 z-11 flex max-w-screen flex-col bg-(--surface-column)",
          docked
            ? "top-[var(--chrome-top,var(--page-header-height))] left-[calc(var(--nav-current,0px)_+_var(--orca-nav-width))] h-[calc(100dvh_-_var(--chrome-top,var(--page-header-height)))] w-[calc(100%_-_var(--nav-current,0px)_-_var(--orca-nav-width))] translate-none transition-none"
            : "top-0 left-auto h-dvh transition-[translate]",
          !docked &&
            (fullscreen
              ? "w-screen"
              : "w-[var(--panel-live-width,var(--panel-width))] border-l border-border"),
          !docked &&
            (open
              ? "translate-x-0 duration-(--motion-panel-open) ease-(--easing-enter)"
              : "translate-x-full duration-(--motion-panel-close) ease-(--easing-exit)"),
        )}
      >
        {children}
      </aside>
    </>
  );
}

export function PanelEmptyState() {
  return (
    <div className="flex flex-auto flex-col items-center justify-center p-(--space-3xl)">
      <h2 className="m-0 text-(length:--font-heading) font-semibold text-foreground">
        Select a ticket
      </h2>
      <p className="mx-0 mt-(--space-sm) mb-0 text-center text-base text-muted-foreground">
        Choose a ticket from the side nav to see its details and live terminal.
      </p>
    </div>
  );
}

export function PanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-(--space-sm) border-b border-border py-(--space-sm) pr-(--space-lg) pl-(--space-xl)">
      {children}
    </div>
  );
}

export function PanelAccountRow({ email }: { email: string }) {
  return (
    <div
      data-testid="session-account"
      className="flex items-center gap-(--space-xs) border-b border-border py-(--space-xs) pr-(--space-lg) pl-(--space-xl) font-sans text-sm text-muted-foreground"
    >
      <span className="text-sm font-semibold text-muted-foreground">
        Account
      </span>
      <span className="text-foreground" title={email}>
        {email}
      </span>
    </div>
  );
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-auto flex-col">{children}</div>;
}

export function PanelLoading() {
  return (
    <div className="p-(--space-xl) text-base text-muted-foreground">
      Loading ticket…
    </div>
  );
}

interface PanelLoadErrorProps {
  kind: "not-found" | "network";
  onRetry?: () => void;
}

export function PanelLoadError({ kind, onRetry }: PanelLoadErrorProps) {
  return (
    <div className="reading-surface flex flex-col gap-(--space-lg)">
      <PanelAlert icon>
        {kind === "not-found"
          ? "This ticket could not be found"
          : "Couldn't load this ticket"}
      </PanelAlert>
      <div className="text-sm text-muted-foreground">
        {kind === "not-found"
          ? "It may have been deleted or moved out of range."
          : "Check your connection and try again."}
      </div>
      {kind === "network" && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onRetry}
        >
          <RotateCw className="size-3" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}

interface PanelReferenceProps {
  capped: boolean;
  grow: boolean;
  children: ReactNode;
}

export function PanelReference({
  capped,
  grow,
  children,
}: PanelReferenceProps) {
  return (
    <div
      className={cn(
        "scroll-stable-y reading-surface flex flex-col gap-(--panel-section-gap) overflow-y-auto",
        capped && "max-h-[40%]",
        grow ? "flex-auto" : "flex-[0_1_auto]",
      )}
    >
      {children}
    </div>
  );
}

export function PanelPreviews({ children }: { children: ReactNode }) {
  return (
    <div className="reading-surface flex flex-col gap-(--space-sm) border-b border-border">
      {children}
    </div>
  );
}
