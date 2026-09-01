import { accessSync, constants } from "node:fs";
import type { TerminalThemeResponse } from "../../../shared/types.js";
import { FONT_FAMILY } from "../../../shared/nerd-font-mono.js";
import { run } from "../../adapters/exec.js";
import { resolveBinaryPath } from "../../adapters/resolve-binary.js";

/** The macOS app-bundle CLI path, checked before falling back to a PATH lookup (Ghostty.app does not always symlink itself onto PATH). */
const MACOS_GHOSTTY_CLI = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

/** Bounded per the DoS mitigation (T-S2-03) — the subprocess runs at most once per boot regardless. */
const GHOSTTY_CONFIG_TIMEOUT_MS = 3000;

/**
 * Catppuccin Mocha, matched byte-for-byte to a real `ghostty +show-config` pull with no user
 * config overrides — the exact fallback every failure path below must reproduce, so the terminal
 * always renders in a themed, legible state rather than raw xterm defaults.
 */
const FALLBACK_THEME: TerminalThemeResponse = {
  theme: {
    background: "#1e1e2e",
    foreground: "#cdd6f4",
    cursor: "#f5e0dc",
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
  },
  fontFamily: FONT_FAMILY,
  fontSize: 14,
  fontWeight: 400,
  cursorStyle: "block",
  cursorBlink: false,
};

/** Palette index → named `ITheme` color key, in the order `ghostty +show-config` numbers them. */
const PALETTE_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

let cached: TerminalThemeResponse | null = null;
let warnedOnce = false;

/** Log the fallback path exactly once per boot — `cached` already guarantees at most one call site reaches this per process. */
function warnFallback(): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[terminal-theme] ghostty config unavailable, using Catppuccin Mocha fallback",
  );
}

/**
 * Absolute Ghostty CLI path if the macOS app bundle is installed, else the PATH-resolved binary,
 * else null. Absence is normal (Ghostty may not be installed) — never treated as an error.
 */
async function resolveGhosttyPath(): Promise<string | null> {
  try {
    accessSync(MACOS_GHOSTTY_CLI, constants.X_OK);
    return MACOS_GHOSTTY_CLI;
  } catch {}
  return resolveBinaryPath("ghostty");
}

/**
 * Parse `ghostty +show-config`'s flat `key = value` output into the fields this resolver reads.
 * Palette lines repeat 256 times (`palette = N=#hex`, one per 0..255) — only indices 0..15 map to
 * the named `ITheme` colors, so 16..255 are collected and discarded, not an oversight.
 */
function parseShowConfig(stdout: string): {
  background?: string;
  foreground?: string;
  selectionForeground?: string;
  selectionBackground?: string;
  cursorColor?: string;
  cursorStyle?: string;
  fontSize?: string;
  fontThicken?: string;
  palette: Map<number, string>;
} {
  const palette = new Map<number, string>();
  let background: string | undefined;
  let foreground: string | undefined;
  let selectionForeground: string | undefined;
  let selectionBackground: string | undefined;
  let cursorColor: string | undefined;
  let cursorStyle: string | undefined;
  let fontSize: string | undefined;
  let fontThicken: string | undefined;

  for (const line of stdout.split("\n")) {
    const eq = line.indexOf(" = ");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 3).trim();
    if (key === "palette") {
      const m = /^(\d+)=(#[0-9a-fA-F]{6})$/.exec(value);
      if (m) {
        const idx = Number(m[1]);
        if (idx >= 0 && idx <= 15) palette.set(idx, m[2]);
      }
      continue;
    }
    switch (key) {
      case "background":
        background = value;
        break;
      case "foreground":
        foreground = value;
        break;
      case "selection-foreground":
        selectionForeground = value;
        break;
      case "selection-background":
        selectionBackground = value;
        break;
      case "cursor-color":
        cursorColor = value;
        break;
      case "cursor-style":
        cursorStyle = value;
        break;
      case "font-size":
        fontSize = value;
        break;
      case "font-thicken":
        fontThicken = value;
        break;
    }
  }

  return {
    background,
    foreground,
    selectionForeground,
    selectionBackground,
    cursorColor,
    cursorStyle,
    fontSize,
    fontThicken,
    palette,
  };
}

/** Map ghostty's `cursor-style` vocabulary to xterm's; anything absent or unrecognized defaults to `"block"`. */
function mapCursorStyle(
  value: string | undefined,
): "block" | "underline" | "bar" {
  if (value === "bar" || value === "underline") return value;
  return "block";
}

/**
 * Resolve the native terminal's theme + font block from the user's real Ghostty config, falling
 * back to a fixed Catppuccin Mocha constant on any failure path — this function NEVER throws.
 * Cached for the life of the process (a restart re-reads); the subprocess is bounded to
 * {@link GHOSTTY_CONFIG_TIMEOUT_MS} so a hung `ghostty` process can never wedge the route.
 * @remarks Reads `ghostty +show-config` (256 flat palette lines; only indices 0..15 map to the
 * `ITheme` named colors) through the {@link run} exec chokepoint with a fixed, request-independent
 * argv — no user input ever reaches the spawned command.
 * @remarks TERM-03: this resolver's never-throws contract is part of the native client's
 * load-bearing theme guarantee — the terminal must always open themed (live Ghostty config or the
 * Catppuccin Mocha fallback), never in raw xterm defaults because a resolution path threw.
 * @see docs/ARCHITECTURE.md#exec-chokepoint
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export async function resolveTerminalTheme(): Promise<TerminalThemeResponse> {
  if (cached) return cached;

  const ghosttyPath = await resolveGhosttyPath();
  if (!ghosttyPath) {
    warnFallback();
    cached = FALLBACK_THEME;
    return cached;
  }

  let stdout: string;
  try {
    ({ stdout } = await run(ghosttyPath, ["+show-config"], {
      timeout: GHOSTTY_CONFIG_TIMEOUT_MS,
    }));
  } catch {
    warnFallback();
    cached = FALLBACK_THEME;
    return cached;
  }

  const parsed = parseShowConfig(stdout);
  if (parsed.palette.size < 16 || !parsed.background || !parsed.foreground) {
    warnFallback();
    cached = FALLBACK_THEME;
    return cached;
  }

  const theme: TerminalThemeResponse["theme"] = {
    background: parsed.background,
    foreground: parsed.foreground,
    cursor: parsed.cursorColor ?? FALLBACK_THEME.theme.cursor,
    selectionForeground: parsed.selectionForeground,
    selectionBackground: parsed.selectionBackground,
    ...(Object.fromEntries(
      PALETTE_KEYS.map((key, idx) => [key, parsed.palette.get(idx)]),
    ) as Record<(typeof PALETTE_KEYS)[number], string>),
  };

  cached = {
    theme,
    fontFamily: FONT_FAMILY,
    fontSize: parsed.fontSize ? parseInt(parsed.fontSize, 10) || 14 : 14,
    fontWeight: parsed.fontThicken === "true" ? 600 : 400,
    cursorStyle: mapCursorStyle(parsed.cursorStyle),
    cursorBlink: false,
  };
  return cached;
}
