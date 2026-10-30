import type { TerminalMode } from "./centre-model.js";

export const CENTRE_EXPANDED_KEY = "dsp.centre.expanded";

export const CENTRE_WIDTH_KEY = "dsp.centre.width";

type CentrePaneMode = "closed" | "side" | "expanded" | "sheet";

/**
 * Read the stored expanded flag of the terminal pane.
 *
 * @remarks Nothing stored, or a value that is not a boolean, means expanded, so the first visit opens the terminal across the main area.
 */
export function parseCentreExpanded(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : true;
}

/**
 * Name how the terminal pane shows for the open, expanded, narrow and terminal-ready state.
 *
 * @remarks
 * An unset `open` follows the terminal: the pane covers the canvas only while the terminal is ready, so a narrow screen with no terminal keeps the canvas and its Start or Resume control.
 * A narrow screen always gets the sheet, so the stored expanded flag does not apply there.
 */
export function centrePaneMode(input: {
  open: boolean | null;
  expanded: boolean;
  narrow: boolean;
  terminalReady: boolean;
}): CentrePaneMode {
  if (input.open === false) return "closed";
  if (input.open === null && input.narrow && !input.terminalReady)
    return "closed";
  if (input.narrow) return "sheet";
  return input.expanded && input.terminalReady ? "expanded" : "side";
}

/** Tell whether the orchestrator terminal is live or connecting. */
export function isTerminalReady(mode: TerminalMode): boolean {
  return mode === "live" || mode === "connecting";
}
