/**
 * True if the pane is claude's idle "recap" overlay rather than the live transcript (BUG-2). After
 * a few minutes idle, claude v2.x repaints the WHOLE screen with a `※ recap: … (disable recaps in
 * /config)` block at CONSTANT width. That overlay hides the marker and diverges from the flip-back
 * baseline, so — untreated — it both false-flips a still-blocked card and (next tick) wipes the
 * dedup key. Detect it tolerantly by the `※` reference-mark glyph at line start: it appears in the
 * recap header, not in normal transcript body or the footer/spinner set (`✻✽✶·`), so this never
 * matches a live working pane.
 *
 * Structural, not any-line: a recap header that lingers near the top of a full-screen repaint after
 * the agent has printed a FRESH `⏺` block below it must no longer make the tick a no-op — otherwise
 * the guard keeps suppressing marker scans until the stale `※` line scrolls out of the (unscrolled)
 * capture window. Mirrors this module's own `agentOutputView` `⏺`-anchoring rationale: only the LAST
 * `※` line and the LAST `⏺` line matter, and the overlay is "current" only when the last `※` is
 * BELOW the last `⏺` (nothing newer has printed since the recap). A pane with no `⏺` line at all
 * (lastBullet === -1) still treats any `※` line as current — the genuinely-idle recap case.
 *
 * @remarks The recap overlay both false-flips and (next tick) wipes the dedup key if untreated —
 * the guard makes the whole tick a no-op, but only while the recap is still the newest content.
 * Stays in this module this phase (no extraction).
 * @see docs/ARCHITECTURE.md#watcher-discriminator
 */
export function isRecapOverlay(pane: string): boolean {
  const lines = pane.split("\n");
  let lastRecap = -1;
  let lastBullet = -1;
  lines.forEach((line, i) => {
    if (/^\s*※/.test(line)) lastRecap = i;
    if (/^\s*⏺/.test(line)) lastBullet = i;
  });
  return lastRecap !== -1 && lastRecap > lastBullet;
}

/**
 * Strip the volatile regions from a pane so the flip-back baseline is stable (04-RESEARCH
 * Pattern 4 / Probes 3 & 6): cut the footer — everything from the REPL input box's top border
 * down (the `╭─…` box the TUI draws above the `Fable N │ … ░░ N%` context bar and `⏵⏵ …`
 * mode line) — and filter out any spinner/timer line (an animated glyph `✻ ✽ ✶ ·` at line
 * start — this also catches the completed `✻ Worked for Ns` timer). Anchoring on the border
 * (bottom-up scan, so a box drawn IN the transcript is never matched) tracks the footer's real
 * height: notification rows, tips, plan/permission-mode rows, and auto-compact warnings vary it
 * across versions and states, and a fixed line count would leak volatile rows into the "stable"
 * body (false flip-backs) or drop real transcript tail. The probed drop-5 count remains only as
 * the fallback when no border is visible. The idle pane is byte-stable once these are removed,
 * so only a REAL new agent response changes the result — never idle repaint noise.
 *
 * Border match (BUG-2): this claude version draws the input box's top border as a PLAIN
 * horizontal rule (`─────…`) with NO `╭`/`┌` corner glyph, so the original `/^\s*[╭┌]─/` anchor
 * NEVER matched and the drop-5 fallback was silently always in effect (leaking volatile footer
 * rows into the baseline → false flip-backs). Making the corner optional and requiring a run of
 * box-drawing dashes (`[╭┌]?─{3,}`) matches both the cornered and the plain form. The scan is
 * bottom-up, so the FIRST (lowest) match is the real input-box border; a markdown horizontal rule
 * higher up in the transcript is shadowed by that lower footer border and never wins.
 */
export function stripVolatile(pane: string): string {
  const lines = pane.split("\n");
  let cut = lines.length - 5;
  let bordersSeen = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*[╭┌]?─{3,}/.test(lines[i])) {
      cut = i;
      bordersSeen++;
      if (bordersSeen === 2) break;
    }
  }
  return lines
    .slice(0, Math.max(0, cut))
    .filter((line) => !/^\s*[✻✽✶·]\s/.test(line) && !/^\s*❯/.test(line))
    .join("\n");
}

/**
 * The AGENT-OUTPUT VIEW of a pane: the `⏺`-anchored lines of the stripped body, joined. This is
 * the STRUCTURAL discriminator the flip-back compare (§ 4) runs on instead of the whole stripped
 * body.
 *
 * Why structural, not another strip rule: MARK-03's real meaning is "the agent produced new output
 * after the user replied". Claude renders every assistant/tool block with a leading `⏺` bullet
 * (04-RESEARCH Probe 1: `⏺ Understood — …`, with the marker on the 2-space continuation line);
 * a real reply ALWAYS begins a new `⏺` block in the visible pane's bottom region. TUI chrome —
 * tips, notification rows (`View Observations Live @ …`), timed hints, recap/suggestion variants,
 * the ghost `❯` line, the context bar (`Fable N │ … ░░ N%`) and mode line (`⏵⏵ …`, glyph U+23F5,
 * NOT the `⏺` U+23FA bullet) — is NEVER `⏺`-prefixed. So no chrome repaint can change this view,
 * which structurally closes the open-ended false-flip class (three distinct chrome classes were
 * whack-a-moled before a fourth appeared; anchoring on `⏺` ends that game).
 *
 * Edge — a reply that only scrolls old content off (no NEW `⏺`): impossible in practice. A response
 * always starts a fresh `⏺` block at the pane bottom, so even if a giant reply scrolls earlier
 * blocks off the top, the visible `⏺`-line SET still changes (a new bottom block joins; the joined
 * string differs). The only non-flip case is a baseline with an EMPTY view (no `⏺` visible at marker
 * time) whose reply also emits no visible `⏺` — anatomically impossible, since the reply's own block
 * appears at the bottom.
 *
 * Rewrap dependency: hard-wraps change `⏺`-line TEXT at different pane widths. The § 4 geometry
 * guard re-snapshots the baseline on ANY width/height change, so within a constant-geometry window
 * the `⏺` text is stable and only real new output changes the view. Composing over stripVolatile
 * (rather than the raw pane) is defensive: the footer/input-box interior carries no `⏺` line, so the
 * two are equivalent here, but keeping the strip preserves the existing spinner/`❯`/footer guards.
 *
 * @remarks The `⏺`-anchored view is the STRUCTURAL discriminator — TUI chrome never emits a `⏺`
 * block, so no chrome repaint can flip a card. Stays in this module this phase (no extraction).
 * @see docs/ARCHITECTURE.md#watcher-discriminator
 */
export function agentOutputView(pane: string): string {
  return stripVolatile(pane)
    .split("\n")
    .filter((line) => /^\s*⏺/.test(line))
    .join("\n");
}

/**
 * Coarse first-character CLASS of a line, for the env-gated divergence diagnostic. Returns only a
 * fixed class NAME — never the line's text — so the fingerprint stays content-safe (this module's
 * no-content-logging security rule is load-bearing).
 */
export function firstCharClass(line: string): string {
  const ch = [...line.replace(/^\s+/, "")][0] ?? "";
  if (ch === "⏺") return "bullet";
  if (ch === "❯") return "prompt";
  if (ch === "※") return "recap";
  if ("✻✽✶·".includes(ch)) return "spinner";
  if ("─╭╮╰╯│┌┐└┘".includes(ch)) return "box";
  if (ch === "") return "blank";
  return "text";
}

/**
 * CONTENT-SAFE fingerprint of the diff between two views: counts of added/removed lines bucketed by
 * firstCharClass. Emits ONLY class names and integer counts (e.g. `added[bullet:1] removed[none]`),
 * never any pane text, so it can be logged under AK_WATCH_DEBUG for future field debugging without
 * violating the module's no-pane-content rule.
 */
export function diffFingerprint(before: string, after: string): string {
  const bLines = before.split("\n");
  const aLines = after.split("\n");
  const bSet = new Set(bLines);
  const aSet = new Set(aLines);
  const bucket = (lines: string[]): string => {
    const counts = new Map<string, number>();
    for (const l of lines)
      counts.set(firstCharClass(l), (counts.get(firstCharClass(l)) ?? 0) + 1);
    const parts = [...counts.entries()].map(([k, v]) => `${k}:${v}`);
    return parts.length ? parts.join(",") : "none";
  };
  const added = aLines.filter((l) => !bSet.has(l));
  const removed = bLines.filter((l) => !aSet.has(l));
  return `added[${bucket(added)}] removed[${bucket(removed)}]`;
}
