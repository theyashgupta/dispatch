import { FONT_FAMILY } from "../../shared/nerd-font-mono.js";

/**
 * Names always treated as available: the bundled Nerd Font (self-hosted in the terminal iframe, so
 * it renders there even though the Settings page never loads its `@font-face`) and the CSS generic.
 */
const ALWAYS_AVAILABLE = new Set<string>([FONT_FAMILY, "monospace"]);

/**
 * The subset of `candidates` the browser can actually render, detected by advance width.
 *
 * @remarks An absent family falls back to the browser's default (a proportional serif), whose width
 * differs from any real monospace, so a candidate whose width matches the no-such-font baseline is
 * not installed. Width alone cannot tell two present monospace fonts apart, but it reliably
 * separates "present" from "fell back", which is all this needs. The bundled font and `monospace`
 * are forced in because they always render in the terminal even when the probe page lacks them.
 */
export function detectInstalledFonts(
  candidates: readonly string[],
): Set<string> {
  const installed = new Set<string>(
    candidates.filter((f) => ALWAYS_AVAILABLE.has(f)),
  );
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return new Set(candidates);
  const sample = "mmmmmmmmmwwwwwiiiiil0Oo1lI@#";
  ctx.font = '72px "a font that does not exist 12345"';
  const baseline = ctx.measureText(sample).width;
  for (const f of candidates) {
    if (installed.has(f)) continue;
    ctx.font = `72px "${f}"`;
    if (Math.abs(ctx.measureText(sample).width - baseline) > 0.5) {
      installed.add(f);
    }
  }
  return installed;
}

/**
 * Dropdown label for a font: the friendly name, with a "(not installed)" suffix when the family is
 * absent from this machine, so picking it never looks like a broken no-op that silently falls back.
 */
export function fontOptionLabel(
  name: string,
  installed: Set<string>,
  labels: Record<string, string>,
): string {
  const base = labels[name] ?? name;
  return installed.has(name) ? base : `${base} (not installed)`;
}
