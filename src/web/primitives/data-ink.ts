/**
 * Returns the text colour for a label that takes its colour from data or from a graphic token.
 *
 * @remarks A raw data colour or a column colour fails the 4.5:1 text floor on its own tint in at
 * least one theme. Mixing 35 percent of it with the text colour keeps the hue and the floor.
 * @see docs/standards/design-contract.md#linear-state-colors
 */
export function dataInk(color: string): string {
  return `color-mix(in srgb, ${color} 35%, var(--text))`;
}
