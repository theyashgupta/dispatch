const MARKER_RE =
  /^\s*(?:⏺\s*)?AK_STATUS:\s*(NEEDS_INPUT|DONE)\b(?:\s*[—–-]\s*(.*))?\s*$/;

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
 * when either normalized key is a prefix of the other. Cross-kind keys never collide (`NEEDS_INPUT`
 * is never a prefix of `DONE` or vice versa).
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
  const nb = normalizeMarkerKey(b);
  const nk = normalizeMarkerKey(consumed);
  return nb === nk || nb.startsWith(nk) || nk.startsWith(nb);
}

/**
 * Return the LAST (lowest / most recent) AK_STATUS marker in the pane, or null if none.
 *
 * Last-match-wins: a pane may hold several markers over the transcript; the most recent state is
 * the one at the bottom. Dedup happens in the watcher via markerKey() equality against
 * `card.lastMarker` across TUI repaints (MARK-04).
 *
 * Defense-in-depth against the kickoff template echo: a reason that IS the kickoff template's
 * unfilled placeholder (`<one-line reason>` / `<one-line summary>`, exactly) is skipped IN the
 * loop — an earlier real marker still wins, and a legitimate reason that merely CONTAINS angle
 * brackets (e.g. "need the <API_KEY> value") fires normally.
 *
 * @remarks MARKER_RE tolerance envelope (line-start anchor, optional `⏺`, em-dash U+2014
 * separator) is the parse contract; the dedup and byte-identical kickoff contract are homed centrally.
 * @see docs/ARCHITECTURE.md#marker-protocol
 */
export function parseLastMarker(pane: string): Marker | null {
  let found: Marker | null = null;
  for (const line of pane.split("\n")) {
    const m = MARKER_RE.exec(line);
    if (!m) continue;
    const reason = (m[2] ?? "").trim();
    if (/^<one-line (reason|summary)>$/.test(reason)) continue;
    found = { kind: m[1] as Marker["kind"], reason };
  }
  return found;
}
