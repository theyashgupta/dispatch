export type PanelEscapeAction =
  | "cancel-drag"
  | "close-takeover"
  | "exit-fullscreen"
  | "close-overlay"
  | "ignore";

interface PanelEscapeInput {
  key: string;
  defaultPrevented: boolean;
  dragging: boolean;
  takeover: boolean;
  fullscreen: boolean;
  docked: boolean;
}

/**
 * What Escape does on an open panel.
 *
 * @remarks An active drag cancels first, then the takeover closes through history, then
 * fullscreen exits, then the overlay closes; a docked panel ignores Escape. A key another layer
 * already handled, such as an open menu, does nothing here.
 */
export function panelEscapeAction(input: PanelEscapeInput): PanelEscapeAction {
  if (input.key !== "Escape" || input.defaultPrevented) return "ignore";
  if (input.dragging) return "cancel-drag";
  if (input.takeover) return "close-takeover";
  if (input.fullscreen) return "exit-fullscreen";
  if (!input.docked) return "close-overlay";
  return "ignore";
}
