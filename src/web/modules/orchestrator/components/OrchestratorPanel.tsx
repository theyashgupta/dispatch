import type { KeyboardEvent, ReactNode, Ref } from "react";

interface OrchestratorPanelProps {
  panelRef: Ref<HTMLElement>;
  escapeEnabled: boolean;
  onClose: () => void;
  header: ReactNode;
  controls: ReactNode;
  stoppedLoops: ReactNode;
  alert: ReactNode;
  tabs: ReactNode;
}

export function OrchestratorPanel({
  panelRef,
  escapeEnabled,
  onClose,
  header,
  controls,
  stoppedLoops,
  alert,
  tabs,
}: OrchestratorPanelProps) {
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented || !escapeEnabled) {
      return;
    }
    event.preventDefault();
    onClose();
  }
  return (
    <section
      ref={panelRef}
      aria-label="Orchestrator panel"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 min-w-0 flex-col bg-(--surface-column) outline-none"
    >
      <div className="flex flex-none flex-col gap-(--space-sm) border-b border-border px-(--space-lg) py-(--space-md)">
        {header}
        {controls}
        {stoppedLoops}
      </div>
      {alert !== null && (
        <div className="flex-none px-(--space-lg) pt-(--space-md)">{alert}</div>
      )}
      {tabs}
    </section>
  );
}
