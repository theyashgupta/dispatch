const MARKER_RE =
  /^\s*(?:⏺\s*)?DISPATCH_STATUS:\s*(NEEDS_INPUT|DONE)\b(?:\s*[—–-]\s*(.*))?\s*$/;

/**
 * Wrapped-reason continuation boundary: a fresh `⏺` block, or the footer/input-box border
 * (mirrors pane-view.ts's own `[╭┌]?─{3,}` chrome anchor — kept as a local literal rather than an
 * import to avoid coupling parse.ts to pane-view.ts for one shared shape). A blank line also
 * terminates the scan (checked by direct equality below, no regex needed).
 */
const BULLET_LINE_RE = /^\s*⏺/;
const CHROME_BORDER_RE = /^\s*[╭┌]?─{3,}/;

/**
 * Kickoff-template placeholder guard, applied as a PREFIX test (not exact equality): the wrapped
 * kickoff echo can pull further template lines into the joined reason (they are neither blank,
 * `⏺`, nor border), so a reason that merely STARTS with the unfilled placeholder is template echo,
 * never agent output. A legitimate reason that contains angle brackets elsewhere (e.g. "need the
 * <API_KEY> value") still fires normally.
 */
const PLACEHOLDER_PREFIX_RE = /^<one-line (reason|summary)>/;

export interface Marker {
  kind: "NEEDS_INPUT" | "DONE";
  reason: string;
}

/**
 * Layout-independent dedup key for a parsed marker: `kind + " " + reason` (reason already
 * trimmed by the parser). The watcher stores this in `card.lastMarker` and dedups on it —
 * NOT on the raw physical line — so a tmux rewrap/re-indent of the SAME marker (terminal
 * attach resizes the pane, the TUI repaints at the new width) can never re-fire an
 * already-consumed marker (MARK-04).
 *
 * @remarks The dedup prefix rule (`sameMarkerKey`) and the byte-identical kickoff ↔ MARKER_RE
 * em-dash contract are the cross-module home; this key is the layout-independent unit both rely on.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function markerKey(m: Marker): string {
  return `${m.kind} ${m.reason}`;
}

/**
 * Whitespace-collapsed form of a dedup key, for width-invariant comparison. Runs of any
 * whitespace collapse to a single space and the ends are trimmed, so two captures of the SAME
 * logical marker that differ only in incidental spacing normalize to the same string.
 */
export function normalizeMarkerKey(key: string): string {
  return key.replace(/\s+/g, " ").trim();
}

/**
 * Fully whitespace-STRIPPED form of a dedup key, for the `sameMarkerKey` comparison only. The TUI
 * hard-wraps at column boundaries and may split a WORD across physical lines; the continuation
 * join then inserts a space INSIDE that word (e.g. `configure d`), which whitespace-collapsing
 * cannot undo — two captures of the SAME logical marker at different pane widths would produce
 * keys that are not prefix-related. Removing ALL whitespace makes the comparison immune to where
 * the wrap landed. The spaced form stays the stored/display key; only the comparison strips.
 */
function stripMarkerKey(key: string): string {
  return key.replace(/\s+/g, "");
}

/**
 * Width-invariant "is marker B the same already-consumed marker as key K?" test (BUG-1).
 *
 * `capture-pane -J` rejoins only tmux SOFT-wraps; the claude TUI HARD-wraps its own long marker
 * lines with real newlines at the current pane width (04-RESEARCH Probe 2). So `parseLastMarker`
 * only ever sees the FIRST physical line of an overflowing reason, and the parsed reason — hence
 * `markerKey` — shrinks/grows with the pane width. A plain `!==` therefore re-fired an
 * already-consumed marker on every resize (panel open/close), yanking a manually-dragged card
 * back and clobbering statusReason between full/truncated forms.
 *
 * Any two wrap-widths of one logical marker produce PREFIX-related keys (the kind is always fully
 * present at line start; only the reason's tail is cut), so we treat B and K as the same marker
 * when either key is a prefix of the other. The comparison runs on fully whitespace-STRIPPED
 * forms (`stripMarkerKey`): the continuation join can insert a space INSIDE a word the TUI
 * wrapped mid-word (`configure` + `d`), and collapse-only normalization left such captures
 * non-prefix-related across widths — re-firing the marker on resize. Cross-kind keys never
 * collide (`NEEDS_INPUT` is never a prefix of `DONE` or vice versa).
 *
 * Accepted rare tradeoff: a genuinely NEW reason that happens to EXTEND the suppressed one (e.g.
 * `need the key` then `need the key from vault`) is treated as already-seen and won't re-fire.
 * Manual drag / re-emission after scroll-off still correct it; localhost single-user, low stakes.
 *
 * @remarks The prefix rule is the width-invariant dedup at the heart of the marker protocol.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function sameMarkerKey(
  b: string,
  consumed: string | undefined,
): boolean {
  if (consumed == null) return false;
  const nb = stripMarkerKey(b);
  const nk = stripMarkerKey(consumed);
  return nb === nk || nb.startsWith(nk) || nk.startsWith(nb);
}

/**
 * Return the LAST (lowest / most recent) DISPATCH_STATUS marker in the pane, or null if none.
 *
 * Last-match-wins: a pane may hold several markers over the transcript; the most recent state is
 * the one at the bottom. Dedup happens in the watcher via markerKey() equality against
 * `card.lastMarker` across TUI repaints (MARK-04).
 *
 * Wrapped-reason capture: the claude TUI hard-wraps a long reason onto further real newlines at
 * the current pane width, and MARKER_RE is line-anchored (`$`), so once a marker line matches,
 * subsequent physical lines are greedily consumed as continuation of the SAME reason until a
 * boundary — a blank line, a fresh `⏺` block, the footer/input-box border, or ANOTHER marker
 * line (a line matching MARKER_RE is a NEW marker, never continuation — consuming it would
 * violate last-marker-wins for adjacent markers) — and joined with a
 * single space (statusReason renders inline in ReferenceBlocks.tsx/CardView.tsx, never as
 * preformatted text, so the hard-wrap newline is collapsed, not preserved). Continuation only
 * runs when the marker line itself carried a reason separator (`m[2] !== undefined`) — a
 * separator-less marker line has no reason to continue. Capturing the FULL reason (rather than
 * only the first physical line) makes `sameMarkerKey`'s prefix-tolerance dedup less load-bearing
 * for THIS case, but it still protects other reflow scenarios and is unchanged here.
 *
 * Defense-in-depth against the kickoff template echo: a reason whose FIRST captured segment
 * starts with the kickoff template's unfilled placeholder (`<one-line reason>` /
 * `<one-line summary>`) is skipped BEFORE continuation runs — otherwise the wrapped echo's
 * adjacent template lines (neither blank, `⏺`, nor border) would be joined in and defeat an
 * exact-equality guard. The same prefix guard re-runs on the JOINED reason to catch a wrap that
 * splits the placeholder itself mid-word. An earlier real marker still wins, and a legitimate
 * reason that merely CONTAINS angle brackets (e.g. "need the <API_KEY> value") fires normally.
 *
 * @remarks MARKER_RE tolerance envelope (line-start anchor, optional `⏺`, em-dash U+2014
 * separator) is the parse contract; the dedup and byte-identical kickoff contract are homed centrally.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function parseLastMarker(pane: string): Marker | null {
  const lines = pane.split("\n");
  let found: Marker | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = MARKER_RE.exec(lines[i]);
    if (!m) continue;
    const first = (m[2] ?? "").trim();
    if (PLACEHOLDER_PREFIX_RE.test(first)) continue;
    const parts: string[] = [];
    if (first !== "") parts.push(first);
    let j = i + 1;
    if (m[2] !== undefined) {
      while (
        j < lines.length &&
        lines[j].trim() !== "" &&
        !BULLET_LINE_RE.test(lines[j]) &&
        !CHROME_BORDER_RE.test(lines[j]) &&
        !MARKER_RE.test(lines[j])
      ) {
        parts.push(lines[j].trim());
        j++;
      }
    }
    const reason = parts.join(" ");
    if (!PLACEHOLDER_PREFIX_RE.test(reason)) {
      found = { kind: m[1] as Marker["kind"], reason };
    }
    i = j - 1;
  }
  return found;
}
