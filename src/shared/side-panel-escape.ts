type SidePanelEscapeAction = "cancel-drag" | "close" | "ignore";

interface SidePanelEscapeInput {
  key: string;
  defaultPrevented: boolean;
  dragging: boolean;
  docked: boolean;
  coveredByOverlay: boolean;
}

/**
 * What Escape does on an open side panel.
 *
 * @remarks A docked panel, and an inline panel under an open overlay panel, ignore Escape, so one press closes only the top panel. A key another layer already handled, such as an open menu, does nothing here.
 */
export function sidePanelEscapeAction(
  input: SidePanelEscapeInput,
): SidePanelEscapeAction {
  if (input.key !== "Escape" || input.defaultPrevented) return "ignore";
  if (input.dragging) return "cancel-drag";
  if (input.docked || input.coveredByOverlay) return "ignore";
  return "close";
}
