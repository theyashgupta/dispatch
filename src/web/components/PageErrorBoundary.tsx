import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export class PageErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div
        role="alert"
        className="flex flex-auto flex-col items-center justify-center gap-(--space-sm) text-base text-muted-foreground"
      >
        <span>This page failed to load.</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </Button>
      </div>
    );
  }
}
