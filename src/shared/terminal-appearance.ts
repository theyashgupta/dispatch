import { FONT_FAMILY } from "./nerd-font-mono.js";
import type { TerminalAppearance, TerminalThemeResponse } from "./types.js";

export const TERMINAL_FONT_FAMILIES = [
  FONT_FAMILY,
  "Menlo",
  "Monaco",
  "SF Mono",
  "Fira Code",
  "JetBrains Mono",
  "monospace",
] as const;

export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
  background: "#111111",
  opacity: 0.93,
  foreground: "#e8e9ea",
  cursor: "#e8e9ea",
  fontFamily: FONT_FAMILY,
  fontSize: 14,
};

export const TERMINAL_APPEARANCE_CHANNEL = "dsp.terminal-appearance";

export const TERMINAL_OPACITY_MIN = 0.3;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

const ANSI_PALETTE = {
  black: "#45475a",
  red: "#f38ba8",
  green: "#a6e3a1",
  yellow: "#f9e2af",
  blue: "#89b4fa",
  magenta: "#f5c2e7",
  cyan: "#94e2d5",
  white: "#a6adc8",
  brightBlack: "#585b70",
  brightRed: "#f37799",
  brightGreen: "#89d88b",
  brightYellow: "#ebd391",
  brightBlue: "#74a8fc",
  brightMagenta: "#f2aede",
  brightCyan: "#6bd7ca",
  brightWhite: "#bac2de",
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hexField(o: Record<string, unknown>, key: string): string | undefined {
  const value = o[key];
  return typeof value === "string" && HEX_RE.test(value)
    ? value.toLowerCase()
    : undefined;
}

function hexError(key: string): string {
  return `${key} must be a #rrggbb color`;
}

type Validation =
  { ok: true; value: TerminalAppearance } | { ok: false; error: string };

/**
 * Validate an untrusted terminal appearance object field by field.
 * @remarks Returns the first offending field by name so the Settings UI and the PUT route can
 * point at it; the same ranges the UI controls enforce, so a hand-crafted request cannot exceed them.
 */
export function validateTerminalAppearance(input: unknown): Validation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "terminal appearance must be an object" };
  }
  const o = input as Record<string, unknown>;
  const background = hexField(o, "background");
  if (!background) return { ok: false, error: hexError("background") };
  const foreground = hexField(o, "foreground");
  if (!foreground) return { ok: false, error: hexError("foreground") };
  const cursor = hexField(o, "cursor");
  if (!cursor) return { ok: false, error: hexError("cursor") };
  if (
    typeof o.opacity !== "number" ||
    !Number.isFinite(o.opacity) ||
    o.opacity < TERMINAL_OPACITY_MIN ||
    o.opacity > 1
  ) {
    return {
      ok: false,
      error: `opacity must be a number between ${TERMINAL_OPACITY_MIN} and 1`,
    };
  }
  if (
    typeof o.fontSize !== "number" ||
    !Number.isInteger(o.fontSize) ||
    o.fontSize < TERMINAL_FONT_SIZE_MIN ||
    o.fontSize > TERMINAL_FONT_SIZE_MAX
  ) {
    return {
      ok: false,
      error: `fontSize must be a whole number between ${TERMINAL_FONT_SIZE_MIN} and ${TERMINAL_FONT_SIZE_MAX}`,
    };
  }
  if (
    typeof o.fontFamily !== "string" ||
    !(TERMINAL_FONT_FAMILIES as readonly string[]).includes(o.fontFamily)
  ) {
    return { ok: false, error: "fontFamily must be one of the offered fonts" };
  }
  return {
    ok: true,
    value: {
      background,
      opacity: o.opacity,
      foreground,
      cursor,
      fontFamily: o.fontFamily,
      fontSize: o.fontSize,
    },
  };
}

/**
 * CSS background for the terminal: `rgba(...)` below full opacity, the plain hex at 1.
 * @remarks Emitting hex at opacity 1 keeps a fully opaque terminal on the exact solid-color path,
 * so "no translucency" never depends on alpha compositing.
 */
export function terminalBackgroundCss(
  background: string,
  opacity: number,
): string {
  if (opacity >= 1) return background;
  const r = parseInt(background.slice(1, 3), 16);
  const g = parseInt(background.slice(3, 5), 16);
  const b = parseInt(background.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/**
 * CSS font-family stack: the chosen family first, the bundled Nerd Font next, generic monospace last.
 * @remarks The bundled font always sits in the stack so Claude Code's Nerd glyphs render even
 * when the chosen family is missing on the device or lacks those code points; choosing the
 * generic family keeps it first so the system font, not the bundled one, draws the text.
 */
export function terminalFontStack(fontFamily: string): string {
  return [...new Set([fontFamily, FONT_FAMILY, "monospace"])]
    .map((f) => (f === "monospace" ? f : `"${f}"`))
    .join(", ");
}

/**
 * Build the wire theme the terminal client applies from a validated appearance.
 * @remarks The 16 ANSI colors, cursor style, blink and weight are fixed here on purpose; only the
 * six appearance fields are user-editable.
 */
export function toTerminalTheme(
  appearance: TerminalAppearance,
): TerminalThemeResponse {
  return {
    theme: {
      background: terminalBackgroundCss(
        appearance.background,
        appearance.opacity,
      ),
      foreground: appearance.foreground,
      cursor: appearance.cursor,
      ...ANSI_PALETTE,
    },
    fontWeight: 600,
    cursorStyle: "block",
    cursorBlink: false,
  };
}
