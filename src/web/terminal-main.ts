import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { TerminalThemeResponse } from "../shared/types.js";
import {
  FONT_FAMILY,
  FONT_SPEC,
  NERD_FONT_WOFF2_BASE64,
} from "../shared/nerd-font-mono.js";

const OUTPUT = 0x30;
const TITLE = 0x31;

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_STABILITY_MS = 3000;

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Reverse-tabnabbing-safe, modifier-gated link activator shared by both the plain-text
 * (`WebLinksAddon`) and OSC-8 (`linkHandler`) code paths: open a blank tab, null its opener, THEN
 * navigate — `window.open(url, "_blank")` does not reliably null the opener across browsers, which
 * would let the opened page reach back into this terminal via `window.opener`.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function activateLink(event: MouseEvent, uri: string): void {
  if (!(event.metaKey || event.ctrlKey)) return;
  const win = window.open();
  if (win) {
    try {
      win.opener = null;
    } catch {}
    win.location.href = uri;
  } else {
    console.warn("dispatch: cmd+click open blocked");
  }
}

/**
 * Derives the ttyd WebSocket URL from the page's own path, since the same bundle is served
 * unmodified under every card's dynamic `/sessions/:id/terminal/` prefix — the client never learns
 * `:id` from anywhere but `window.location`. Chooses `wss:` when the page is `https:` so the
 * tunnel case keeps working.
 */
function deriveWebSocketUrl(): string {
  const base = window.location.pathname.replace(/\/$/, "");
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${base}/ws`;
}

/**
 * Sends the raw ttyd wire-protocol handshake: a single binary frame of bare UTF-8 JSON with NO
 * opcode byte, sent before any other message. ttyd treats this first frame specially — prefixing
 * it with an opcode or delaying it past other setup desyncs ttyd's init parser (RESEARCH.md
 * Pitfall 2).
 */
function sendHandshake(ws: WebSocket, term: Terminal): void {
  ws.send(
    enc.encode(
      JSON.stringify({ AuthToken: "", columns: term.cols, rows: term.rows }),
    ),
  );
}

/**
 * Fetch the resolved Ghostty-parity theme/font block. Returns `null` on any network/non-ok
 * failure — the backend resolver itself never throws, but the client must still open with plain
 * xterm defaults if the fetch itself cannot complete.
 */
async function fetchTheme(): Promise<TerminalThemeResponse | null> {
  try {
    const res = await fetch("/api/terminal-theme");
    if (!res.ok) return null;
    return (await res.json()) as TerminalThemeResponse;
  } catch {
    return null;
  }
}

/**
 * Self-hosts the bundled Nerd Font via a data-URI `@font-face` and enables ligature/stylistic-set
 * shaping on `.xterm` — the DOM renderer shapes `font-feature-settings` natively, so no WebGL
 * addon is needed, and the font is self-hosted from a data URI rather than a network request so it
 * loads with the rest of the bundle instead of racing a separate fetch.
 */
function injectFontFace(): void {
  const style = document.createElement("style");
  style.textContent = `
    @font-face {
      font-family: "${FONT_FAMILY}";
      src: url(data:font/woff2;charset=utf-8;base64,${NERD_FONT_WOFF2_BASE64}) format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    .xterm {
      font-feature-settings: "ss01" 1, "calt" 1, "liga" 1;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Un-zoomed font size in px, captured once by `createTerminal` from the resolved theme (or
 * xterm's own default) so the zoom controller always multiplies from a stable base rather than
 * compounding zoom-on-zoom across repeated commits.
 */
let baseFontSize = 15;

/**
 * Live zoom level, seeded from `readZoom()` at the top of `main()` before any pinch/chip handler
 * attaches. Without this seed both the pinch gesture and the chip steppers would implicitly start
 * from `1`, so the first interaction after a reload at a non-100% level would jump through 100%
 * instead of moving from the restored level.
 */
let currentZoom = 1;

/**
 * Builds the terminal instance and the reverse-tabnabbing-safe link handlers, wired to BOTH
 * `WebLinksAddon` (plain-text URLs) and `linkHandler` (OSC-8, the code path real Claude Code `⏺`
 * output uses and `WebLinksAddon` never fires for) so cmd-click parity holds for either link
 * source. `theme` is `null` when the theme fetch failed — the terminal then opens with plain
 * xterm defaults instead of a half-applied theme.
 * @remarks `smoothScrollDuration: 120` is set unconditionally rather than gated to desktop: a
 * media-query gate would leave hybrid devices (touchscreen laptops, iPad + trackpad) with an
 * instant jump, and the value is harmless on its own during a touch gesture. It is also inert for
 * the entirety of normal dispatch use — under `tmux attach` (the alternate buffer) mouse
 * reporting intercepts the wheel before `.xterm-viewport` ever scrolls, so the ~120ms animation
 * is only observable in the normal buffer. The mobile kinetic scroller zeroes this option for the
 * lifetime of a touch gesture and restores it on settle, so its animation cannot fight the
 * momentum loop's discrete ticks. `zoom` is folded into `fontSize` here, before `term.open()`, so
 * the first WS handshake already carries the zoomed column count — no wrong-size first paint, no
 * redundant RESIZE, no reliance on microtask ordering against `ws.onopen`.
 * @remarks TERM-03: `html, body { -webkit-text-size-adjust: 100% }` (declared in `terminal.html`)
 * pins iOS text inflation. Without it, `charWidth` stops tracking `fontSize` after the OS-level page
 * inflates text, and the entire zoom / effective-column-width feature's math (`baseFontSize * zoom`,
 * `fit.fit()`'s cell measurement) goes invalid.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function createTerminal(
  theme: TerminalThemeResponse | null,
  zoom: number,
): {
  term: Terminal;
  fit: FitAddon;
} {
  baseFontSize = theme?.fontSize ?? 15;
  const term = new Terminal({
    allowProposedApi: true,
    scrollback: 10000,
    cursorBlink: theme?.cursorBlink ?? false,
    smoothScrollDuration: 120,
    fontSize: Math.max(ZOOM.minFontPx, baseFontSize * zoom),
    ...(theme
      ? {
          theme: theme.theme,
          fontFamily: `"${theme.fontFamily}", monospace`,
          fontWeight: theme.fontWeight,
          cursorStyle: theme.cursorStyle,
          ...(theme.letterSpacing !== undefined
            ? { letterSpacing: theme.letterSpacing }
            : {}),
        }
      : {}),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon(activateLink));
  term.options.linkHandler = { activate: activateLink };
  return { term, fit };
}

/**
 * Bounds font-readiness against a fixed timeout so the terminal always opens even if the woff2
 * never loads (a slow/offline data-URI decode, or a browser without the Font Loading API) — a
 * `Promise.race` against a timeout is strictly better than an unbounded await, which would leave
 * the terminal never opening on a browser whose font-loading promise never settles.
 */
async function fontsReady(): Promise<void> {
  if (!document.fonts?.load) return;
  await Promise.race([
    document.fonts.load(FONT_SPEC).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

/**
 * A raw LF is sent once, on `keydown`, and BOTH `keydown` and the following `keypress` for the
 * same keystroke are swallowed (`return false`) — xterm's own keypress path independently emits
 * the Enter key's CR immediately after,
 * which would submit the message instead of inserting a newline if keypress were left unswallowed
 * (RESEARCH.md Pitfall 6). `isComposing`/`keyup` always pass through untouched for IME safety.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function attachShiftEnterHandler(
  term: Terminal,
  ws: () => WebSocket | null,
): void {
  term.attachCustomKeyEventHandler((event) => {
    if (event.isComposing || event.type === "keyup") return true;
    if (
      event.key === "Enter" &&
      event.shiftKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      const socket = ws();
      if (event.type === "keydown" && socket?.readyState === WebSocket.OPEN) {
        socket.send(enc.encode("0" + "\n"));
      }
      return false;
    }
    return true;
  });
}

/**
 * Ceiling on the pre-attach scrollback fetch, because `connect()` opens the WebSocket only after
 * that promise settles: an unbounded fetch against a wedged tmux would leave the terminal
 * permanently dead with the reconnect budget never armed.
 */
const SEED_FETCH_TIMEOUT_MS = 5000;

/**
 * Write the pane's tmux history into the terminal before the live stream starts.
 *
 * @remarks TERM-05: without this, a fresh client's local scrollback begins at the attach point
 * and touch scrolling hits a wall at the first row that was visible on connect. Every failure
 * (missing endpoint, 502, or a {@link SEED_FETCH_TIMEOUT_MS} stall) resolves silently so none of
 * them can block the terminal from connecting. The trailing `\r\n` padding is load-bearing, not
 * cosmetic: tmux's first redraw on a freshly attached no-alt-screen client begins with
 * `ESC[H ESC[J`, and xterm.js implements ED0 as an IN-PLACE viewport reset that never pushes those
 * rows into scrollback, so whatever the seed left sitting in the viewport would be erased outright.
 * Padding one full screen of blank rows scrolls the seed above the viewport first, so the redraw
 * blanks blank rows instead of the newest screenful of real history.
 */
async function seedScrollback(term: Terminal): Promise<void> {
  try {
    const base = window.location.pathname.replace(/\/$/, "");
    const res = await fetch(`${base}/scrollback`, {
      signal: AbortSignal.timeout(SEED_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const text = await res.text();
    if (text.trim().length === 0) return;
    await new Promise<void>((done) => {
      term.write(
        text.replace(/\n/g, "\r\n") + "\r\n".repeat(term.rows) + "\x1b[0m",
        done,
      );
    });
  } catch {
    return;
  }
}

/**
 * Owns one WebSocket's full lifecycle (handshake, INPUT/RESIZE wiring, OUTPUT/TITLE dispatch, and
 * a bounded reconnect on close) so `main()` stays a single call. `term.onData`/
 * `term.onResize` are registered exactly ONCE against the `socket` closure variable rather than
 * inside `ws.onopen` — re-registering them per reconnect would stack a new listener on every
 * attempt, each still holding its own now-closed WebSocket, so a later reconnect would throw on
 * every keystroke from the stale listeners. The bounded reconnect covers only transient drops
 * (e.g. a backend restart re-adopting ttyd) — the board's own `terminalError`/`ttydPort` contract
 * stays server-driven via `recordTtydExit` on a real ttyd exit, so this client never sets a
 * terminal-error state itself.
 * @remarks The attempt budget resets only after a connection stays open for
 * `RECONNECT_STABILITY_MS`, never on bare `onopen`: a ttyd that accepts the socket then closes
 * immediately (its tmux target vanished while the process lingers, so `recordTtydExit` never
 * fires) would otherwise reset the budget every cycle and reconnect forever, never letting the
 * bounded budget exhaust and the server-driven error contract surface.
 * @remarks TERM-05: `term.onData` increments the module-level `outstandingReports` on every send,
 * and `ws.onmessage` resets it to `0` on any `OUTPUT` frame, so `attachKineticScroll`'s `drain` can
 * throttle emission once a backlog of unacknowledged reports has built up, without `connect`
 * threading the `socket` handle itself into that closure.
 */
function connect(term: Terminal): void {
  let attempts = 0;
  let socket: WebSocket | null = null;

  term.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) {
      outstandingReports += 1;
      socket.send(enc.encode("0" + data));
    }
  });
  term.onResize(({ cols, rows }) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(enc.encode("1" + JSON.stringify({ columns: cols, rows })));
    }
  });

  const open = () => {
    const ws = new WebSocket(deriveWebSocketUrl(), ["tty"]);
    ws.binaryType = "arraybuffer";
    socket = ws;
    let stableTimer: ReturnType<typeof setTimeout> | undefined;

    ws.onopen = () => {
      sendHandshake(ws, term);
      stableTimer = setTimeout(() => {
        attempts = 0;
      }, RECONNECT_STABILITY_MS);
    };

    ws.onmessage = (event) => {
      const buf = event.data as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      const op = bytes[0];
      const payload = buf.slice(1);
      if (op === OUTPUT) {
        outstandingReports = 0;
        term.write(new Uint8Array(payload));
      } else if (op === TITLE) document.title = dec.decode(payload);
    };

    ws.onclose = () => {
      if (stableTimer !== undefined) clearTimeout(stableTimer);
      if (attempts >= MAX_RECONNECT_ATTEMPTS) return;
      attempts += 1;
      setTimeout(open, RECONNECT_DELAY_MS * attempts);
    };
  };

  void seedScrollback(term).then(open);
  attachShiftEnterHandler(term, () => socket);
}

/**
 * Mounts the terminal into the DOM and keeps it fit to its container, kept separate from
 * `connect()` so a mounted-but-not-yet-connected terminal exists for the mobile zoom controller
 * to wire against before the socket opens — safe because `ws.onopen` cannot fire until `connect()`
 * runs later, so `fit()` here still wins the race and `sendHandshake` still carries measured
 * dimensions.
 * @remarks The `ResizeObserver` callback is rAF-coalesced (a single pending-frame id, cleared on
 * fire) rather than calling `fit.fit()` synchronously per notification. This immunizes against
 * "ResizeObserver loop completed with undelivered notifications" and smooths Android's
 * soft-keyboard resize storm, where the visual viewport shrinks per keystroke burst and each
 * RO -> `fit()` -> `resize()` costs a RESIZE frame plus a full tmux pane repaint.
 */
function mountTerminal(
  term: Terminal,
  mount: HTMLElement,
  fit: FitAddon,
): void {
  term.open(mount);
  fit.fit();
  let pendingFrame: number | undefined;
  new ResizeObserver(() => {
    if (pendingFrame !== undefined) return;
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = undefined;
      fit.fit();
    });
  }).observe(mount);
}

/**
 * Count of mouse reports `connect`'s `term.onData` has sent since the last `OUTPUT` frame arrived,
 * module-level because `attachKineticScroll` holds no reference to the WebSocket `connect` owns.
 * @remarks TERM-05: reset to `0` on any `OUTPUT` frame rather than decremented per report. ttyd
 * emits many output frames per report, so a decrementing counter has no correct pairing and could
 * wedge the scroller permanently throttled; a reset on any output is self-healing by construction.
 */
let outstandingReports = 0;

/**
 * Tuning for the mobile kinetic scroller. A tick is worth `reportLinesPerTick` (wheel destined for
 * a mouse-reporting app) or `viewportLinesPerTick` (wheel destined for xterm's own viewport) rows
 * of content, and a row's height changes with the zoom level — see `rowHeightPx`, referenced from
 * `drain`'s `perTick` local. `reportLinesPerTick` is 1 because the real workload's mouse report is
 * consumed by Claude Code, not by tmux copy-mode, and Claude Code scrolls exactly one line per
 * report (measured); `viewportLinesPerTick` is 1 because xterm's own viewport consumes a
 * `deltaMode: 1` tick as exactly one row. `maxTicksPerDrain` caps the SGR-report / tmux-repaint
 * throughput a single `drain()` call can generate; both the drag phase and the momentum loop now
 * drain from a pending animation frame (never per `touchmove`), so this bounds throughput per frame.
 * At `reportLinesPerTick: 1` a frame's worth of a fast flick is only a few rows, so `8` is headroom
 * above the common case, and a call that hits the cap now carries its remainder into the next call
 * rather than discarding it. `friction` and `minVelocity` shape the momentum decay; `slopPx` is what
 * preserves tap-to-focus. `releaseWindowMs` is how stale the last `touchmove` may be for the release
 * to still count as a flick — beyond it the finger was resting, and the last motion's velocity must
 * not fling. `fallbackRowPx` is only reachable from `rowHeightPx` before `term.open()` has mounted
 * the element.
 */
const KINETIC = {
  slopPx: 8,
  friction: 0.95,
  minVelocity: 0.02,
  maxTicksPerDrain: 8,
  velocityEma: 0.7,
  reportLinesPerTick: 1,
  viewportLinesPerTick: 1,
  maxMomentumMs: 1200,
  releaseWindowMs: 100,
  fallbackRowPx: 17,
} as const;

/**
 * Scroll mode for the current gesture, keyed on the wheel's DESTINATION rather than the active
 * buffer: an app can enable `DECSET 1000/1002` mouse reporting without ever switching to the
 * alternate screen, and once reporting is on a dispatched wheel is consumed as a mouse report
 * regardless of which buffer is showing. `"none"` means a dispatched wheel would be re-encoded by
 * xterm as cursor keys and typed straight into Claude's prompt — engaging there is strictly worse
 * than not scrolling at all.
 * @remarks `"x10"` is treated exactly like `"none"`: the X10 protocol's event mask is `DOWN` only
 * (`CoreMouseService`'s X10 entry additionally rejects the wheel button outright), so xterm never
 * installs its wheel listener and the always-on handler's `if (requestedEvents.wheel)` short-circuit
 * does not fire — a dispatched tick reaches the cursor-key fallback and is typed into the prompt,
 * which is exactly the failure this gate exists to prevent.
 * @remarks TERM-03: one synthetic tick equals one mouse report. A live `claude` REPL pane carries
 * `alternate_on=1` and `mouse_any_flag=1`, so tmux's default root `WheelUpPane` `if-shell` takes its
 * `send-keys -M` branch and forwards the report to the pane app; Claude Code then scrolls exactly
 * one line per report (measured), which is why the kinetic accumulator scales by
 * `rowHeightPx * KINETIC.reportLinesPerTick`, now `1` — one report per one row of finger travel.
 * tmux's `send-keys -X -N 5` copy-mode path is never reached in this workload
 * (`history_size=0` proves copy-mode has nothing to show); calibrating to it is what produced the
 * v2.7 5x under-scroll.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function scrollMode(term: Terminal): "report" | "viewport" | "none" {
  const tracking = term.modes.mouseTrackingMode;
  if (tracking !== "none" && tracking !== "x10") return "report";
  return term.buffer.active.type === "alternate" ? "none" : "viewport";
}

/**
 * Row height in device px for the current font size, used to scale a mouse-report or viewport tick
 * into pixels. Falls back to `KINETIC.fallbackRowPx` only when `term.element` has not mounted yet
 * or `term.rows` is not yet known — unreachable once `mountTerminal` has run `term.open()`.
 */
function rowHeightPx(term: Terminal): number {
  const el = term.element;
  return el && term.rows > 0
    ? el.clientHeight / term.rows
    : KINETIC.fallbackRowPx;
}

/**
 * Dispatches one discrete wheel tick. `deltaMode: 1` (`DOM_DELTA_LINE`) deliberately bypasses
 * xterm's internal `_wheelPartialScroll` pixel accumulator so each dispatch produces exactly one
 * mouse report (or exactly one viewport row) — the kinetic loop owns the sub-tick accumulation
 * itself, never xterm.
 */
function emitTick(term: Terminal, dir: 1 | -1, x: number, y: number): void {
  term.element?.dispatchEvent(
    new WheelEvent("wheel", {
      deltaY: dir,
      deltaMode: 1,
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
    }),
  );
}

/**
 * Attaches the coarse-pointer-only kinetic scroller. It never calls `term.scrollLines()` — a
 * verified no-op in the alternate buffer, which is 100% of the real Claude/tmux workload — and
 * instead dispatches synthetic wheel ticks via `emitTick`, gated off entirely by `scrollMode`
 * whenever mouse reporting is disabled.
 * @remarks Listens in the capture phase on `document`, not on `#terminal`/`.xterm-screen`, so
 * `stopPropagation()` can pre-empt xterm's own touch listeners on `term.element` before they
 * double-scroll in the normal-buffer case (the alternate-buffer case is already safe: xterm bails
 * on `areMouseEventsActive`). `{ passive: false }` on `touchmove` is mandatory — iOS silently
 * ignores `preventDefault()` on passive listeners. `touchstart` is never `preventDefault()`ed,
 * which would suppress the synthesized `click`/`mousedown` and kill tap-to-focus; the `slopPx`
 * threshold before engaging is what keeps a plain tap indistinguishable from a drag's first pixel.
 * `smoothScrollDuration` is zeroed for the lifetime of a gesture and its momentum, then restored:
 * on the normal-buffer path a live 120ms animation's `startTime`/target would otherwise be reset by
 * the next tick 16ms later, so the viewport would permanently chase a moving target.
 * @remarks The touch-end path only acts when the gesture was actually tracked. It fires for EVERY
 * touchend on the document, including a zoom-chip tap that `touchstart` declined to track, and
 * without that guard a tap landing mid-decay would re-enter the momentum loop and overwrite the
 * stored frame handle, orphaning the first loop beyond any `cancelAnimationFrame` — two loops would
 * then drain concurrently and emit double the capped ticks. For the same reason `touchstart`
 * cancels in-flight momentum BEFORE it bails on a chip target, so gesture state can never diverge
 * from the running loop.
 * @remarks Velocity is only recomputed on `touchmove`, so a drag that ends with the finger held
 * still would otherwise release the last motion's stale velocity as a phantom flick; a release more
 * than `releaseWindowMs` after the last move is treated as a deliberate stop.
 * @remarks The drag phase is paced on `requestAnimationFrame`, mirroring the momentum loop:
 * `touchmove` only accumulates `pendingDy` and schedules a single pending `dragFrame`, so a
 * multi-`touchmove` burst inside one frame coalesces into one `drain` call instead of one per event.
 * `touchend`/`touchcancel` cancel that frame and call `flushDrag` synchronously, before the
 * momentum-vs-settle decision — otherwise a short drag's tail travel, still sitting in `pendingDy`,
 * would be lost the moment the pending frame is cancelled. `touchstart` cancels the frame and zeros
 * `pendingDy` ahead of every bail path, including the ones that decline to track, so a declined touch
 * can never drain a previous gesture's queued travel.
 * @remarks TERM-03: `#terminal, #terminal .xterm { touch-action: none }` (declared in
 * `terminal.html`) is deliberate and must NOT be relaxed to `pan-y` — this module dispatches the
 * wheel events itself via `emitTick`, so granting the browser vertical panning double-scrolls, and
 * `none` additionally removes Chrome's "scroll already started, preventDefault ignored" race. This
 * is the client half of the alternate-buffer contract: `term.scrollLines()` is a verified no-op
 * there, so the only way to move content is a synthetic `WheelEvent` with `deltaMode: 1` dispatched
 * at `term.element`, which is exactly what `emitTick` does and what `drain` paces. The drag phase
 * recomputes `scrollMode(term)` on every `touchmove` rather than caching it at `touchstart` — a drag
 * lasts far longer than a flick, so a mid-drag buffer flip (`q`-ing out of a TUI) must not leave the
 * rest of the gesture calibrated against a stale mode.
 * @remarks TERM-05: `drain`'s per-call cap drops from `KINETIC.maxTicksPerDrain` to `1` once
 * `outstandingReports` reaches that same constant, so a backlog of unacknowledged reports paces
 * itself down to one report per animation frame instead of continuing to burst at the calibrated
 * rate. `KINETIC.maxTicksPerDrain` itself is never edited by this throttle, and on any connection
 * fast enough that an `OUTPUT` frame returns before a backlog can build, the cap never drops, so the
 * emitted tick count and geometry for a given gesture are unchanged. `outstandingReports` is reset
 * on `touchstart`, on momentum cancellation and on gesture settle, so a dropped or errored round
 * trip can never carry a stale backlog into the next gesture.
 */
function attachKineticScroll(term: Terminal): void {
  let tracking = false;
  let engaged = false;
  let accum = 0;
  let velocity = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastT = 0;
  let momentumFrame: number | undefined;
  let pendingDy = 0;
  let dragFrame: number | undefined;
  let restoreScrollDuration = term.options.smoothScrollDuration;

  const drain = (
    tickMode: "report" | "viewport",
    px: number,
    x: number,
    y: number,
  ): void => {
    accum += px;
    const perTick =
      rowHeightPx(term) *
      (tickMode === "report"
        ? KINETIC.reportLinesPerTick
        : KINETIC.viewportLinesPerTick);
    const effectiveCap =
      outstandingReports >= KINETIC.maxTicksPerDrain
        ? 1
        : KINETIC.maxTicksPerDrain;
    let emitted = 0;
    while (Math.abs(accum) >= perTick && emitted < effectiveCap) {
      const dir = accum > 0 ? 1 : -1;
      emitTick(term, dir, x, y);
      accum -= dir * perTick;
      emitted += 1;
    }
  };

  const engageGesture = (): void => {
    if (engaged) return;
    engaged = true;
    restoreScrollDuration = term.options.smoothScrollDuration;
    term.options.smoothScrollDuration = 0;
  };

  const settleGesture = (): void => {
    if (!engaged) return;
    engaged = false;
    term.options.smoothScrollDuration = restoreScrollDuration;
  };

  const cancelMomentum = (): void => {
    if (momentumFrame !== undefined) {
      cancelAnimationFrame(momentumFrame);
      momentumFrame = undefined;
    }
    outstandingReports = 0;
    settleGesture();
  };

  const runMomentum = (): void => {
    let startTime: number | undefined;
    let lastFrameT = 0;
    const step = (now: number): void => {
      if (startTime === undefined) {
        startTime = now;
        lastFrameT = now;
      }
      const frameMode = scrollMode(term);
      if (frameMode === "none" || now - startTime > KINETIC.maxMomentumMs) {
        momentumFrame = undefined;
        settleGesture();
        return;
      }
      const frameMs = now - lastFrameT;
      lastFrameT = now;
      drain(frameMode, velocity * frameMs, lastX, lastY);
      velocity *= KINETIC.friction;
      if (Math.abs(velocity) < KINETIC.minVelocity) {
        momentumFrame = undefined;
        settleGesture();
        return;
      }
      momentumFrame = requestAnimationFrame(step);
    };
    momentumFrame = requestAnimationFrame(step);
  };

  const cancelDragFrame = (): void => {
    if (dragFrame !== undefined) {
      cancelAnimationFrame(dragFrame);
      dragFrame = undefined;
    }
  };

  const flushDrag = (): void => {
    dragFrame = undefined;
    if (pendingDy === 0) return;
    const dy = pendingDy;
    pendingDy = 0;
    const mode = scrollMode(term);
    if (mode === "none") return;
    drain(mode, dy, lastX, lastY);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      cancelMomentum();
      cancelDragFrame();
      pendingDy = 0;
      outstandingReports = 0;
      if ((e.target as Element)?.closest?.(".dsp-zoom-chip")) {
        tracking = false;
        return;
      }
      if (e.touches.length !== 1) {
        tracking = false;
        engaged = false;
        accum = 0;
        velocity = 0;
        return;
      }
      if (!(e.target as Element)?.closest?.("#terminal, .xterm")) {
        tracking = false;
        return;
      }
      if (scrollMode(term) === "none") {
        tracking = false;
        return;
      }
      tracking = true;
      engaged = false;
      accum = 0;
      velocity = 0;
      startY = e.touches[0].clientY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      e.stopPropagation();
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const mode = scrollMode(term);
      if (mode === "none") {
        tracking = false;
        settleGesture();
        cancelDragFrame();
        pendingDy = 0;
        return;
      }
      const t = e.touches[0];
      if (!engaged) {
        if (Math.abs(t.clientY - startY) < KINETIC.slopPx) return;
        engageGesture();
      }
      e.preventDefault();
      e.stopPropagation();
      const dy = lastY - t.clientY;
      const dt = Math.max(1, e.timeStamp - lastT);
      velocity =
        KINETIC.velocityEma * (dy / dt) + (1 - KINETIC.velocityEma) * velocity;
      lastX = t.clientX;
      lastY = t.clientY;
      lastT = e.timeStamp;
      pendingDy += dy;
      if (dragFrame === undefined) {
        dragFrame = requestAnimationFrame(flushDrag);
      }
    },
    { capture: true, passive: false },
  );

  const onTouchEnd = (e: TouchEvent): void => {
    if (!tracking) return;
    tracking = false;
    cancelDragFrame();
    flushDrag();
    if (e.timeStamp - lastT > KINETIC.releaseWindowMs) velocity = 0;
    if (engaged && Math.abs(velocity) > KINETIC.minVelocity) {
      runMomentum();
    } else {
      outstandingReports = 0;
      settleGesture();
    }
  };

  document.addEventListener("touchend", onTouchEnd, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchcancel", onTouchEnd, {
    capture: true,
    passive: true,
  });
}

/**
 * Tuning for the mobile zoom controller. The 9-step snap is what turns a continuous pinch into at
 * most 8 distinct commits instead of ~60/s. `minFontPx` is a floor xterm does not impose itself —
 * below ~6px, `Math.round(letterSpacing)` becomes a large fraction of the cell and the DOM
 * renderer's width-cache rounding drifts visibly. `commitFloorMs` paces commits (each one clears
 * the renderer's width cache and triggers a `term.resize()` -> RESIZE frame -> tmux SIGWINCH ->
 * full-pane repaint, which saturates a tunnel at high commit rates); `chipHideMs` is the auto-hide
 * delay after the last interaction.
 */
const ZOOM = {
  steps: [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4],
  minFontPx: 6,
  commitFloorMs: 120,
  chipHideMs: 2000,
} as const;

/**
 * Zoom is per-device, not per-session: one origin-scoped key serves every
 * `/sessions/:id/terminal/` page, matching the established `dsp.*` convention (`dsp.view`,
 * `dsp.panel.width`, `dsp.board.columnWidths`).
 */
const ZOOM_KEY = "dsp.terminal.zoom";

/**
 * Reads the persisted zoom level. A missing, non-numeric, non-finite, or non-positive value falls
 * back to `1`; any other value is CLAMPED by snapping to the nearest `ZOOM.steps` entry, so a
 * corrupted or hostile stored value can never escape the 60%-140% band. Clamping is preferred over
 * resetting because it keeps the terminal at the closest sane size rather than silently discarding
 * the user's persisted preference.
 * @remarks Wrapped in `try/catch`: without `allow-same-origin` on the iframe, `localStorage`
 * access throws `SecurityError` rather than returning `null`, which would take the whole terminal
 * page down.
 */
function readZoom(): number {
  try {
    const raw = Number(localStorage.getItem(ZOOM_KEY));
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return ZOOM.steps.reduce((closest, step) =>
      Math.abs(step - raw) < Math.abs(closest - raw) ? step : closest,
    );
  } catch {
    return 1;
  }
}

/**
 * Persists the current zoom level. See `readZoom` for why the storage call is guarded.
 */
function writeZoom(z: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {}
}

const chip = document.querySelector<HTMLElement>(".dsp-zoom-chip");

/**
 * Writes the current zoom percentage into the chip's own label. Kept as a standalone function
 * because it has two callers — `commitZoom` (which early-returns when the level is unchanged) and
 * the coarse-pointer init path in `attachZoomControl` — and inlining it into `commitZoom` alone
 * is the bug: the markup hardcodes "100%", so a reload at 80% would open the terminal correctly
 * sized while the chip lied "100%" until the user next changed zoom.
 */
function renderChipLevel(z: number): void {
  const label = chip?.querySelector(".dsp-zoom-chip__level");
  if (label) label.textContent = `${Math.round(z * 100)}%`;
}

/**
 * Attaches the coarse-pointer-only zoom controller: pinch-to-zoom (measured from raw touch-point
 * distance so one code path covers iOS Safari and Chrome Android) plus the auto-hiding stepped
 * chip, snapped to `ZOOM.steps`, rate-limited through `requestZoom`, and persisted under
 * `ZOOM_KEY`.
 * @remarks `preventDefault()` on the chip's `pointerdown` is what keeps the xterm textarea
 * focused — it suppresses the compatibility `mousedown` and the focus change that follows it, so a
 * chip tap can never blur the terminal or dismiss the mobile keyboard. The chip ALSO
 * `preventDefault()`s its own `touchstart` as a belt-and-braces fallback for RESEARCH assumption
 * A5 (MEDIUM confidence: whether `pointerdown` prevention reliably holds focus across iOS Safari
 * and Chrome Android) — safe here specifically because the chip's action already fires on
 * `pointerdown`, so unlike the terminal surface it needs no synthesized `click`. `term.focus()`
 * must never be called after a step: on iOS it summons the keyboard even when it was already
 * down. The `gesturestart`/`gesturechange`/`gestureend` listeners exist purely to suppress
 * WebKit's native page zoom — their non-standard `scale` is never read, and Chrome Android never
 * fires them at all. `requestZoom` commits at most once per animation frame and no sooner than
 * `ZOOM.commitFloorMs` after the previous commit, but every call also (re)schedules a trailing
 * commit of the latest requested value so the final step of a gesture always lands even when it
 * was rate-limited away mid-gesture.
 */
function attachZoomControl(term: Terminal, fit: FitAddon): void {
  let startDist = 0;
  let startZoom = currentZoom;
  let requestedZoom = currentZoom;
  let pendingRaw: number | null = null;
  let frameQueued = false;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;
  let lastCommitAt = -Infinity;
  let chipHideTimer: ReturnType<typeof setTimeout> | undefined;

  const showChip = (): void => {
    if (!chip) return;
    chip.setAttribute("data-visible", "true");
    if (chipHideTimer !== undefined) clearTimeout(chipHideTimer);
    chipHideTimer = setTimeout(() => {
      chip.removeAttribute("data-visible");
    }, ZOOM.chipHideMs);
  };

  const commitZoom = (raw: number): boolean => {
    const step = ZOOM.steps.reduce((closest, s) =>
      Math.abs(s - raw) < Math.abs(closest - raw) ? s : closest,
    );
    if (step === currentZoom) return false;
    term.options.fontSize = Math.max(ZOOM.minFontPx, baseFontSize * step);
    fit.fit();
    currentZoom = step;
    writeZoom(step);
    renderChipLevel(step);
    showChip();
    return true;
  };

  const flushPending = (): void => {
    frameQueued = false;
    if (trailingTimer !== undefined) {
      clearTimeout(trailingTimer);
      trailingTimer = undefined;
    }
    if (pendingRaw === null) return;
    const raw = pendingRaw;
    pendingRaw = null;
    if (commitZoom(raw)) lastCommitAt = performance.now();
  };

  const requestZoom = (raw: number): void => {
    requestedZoom = raw;
    pendingRaw = raw;
    if (trailingTimer !== undefined) clearTimeout(trailingTimer);
    trailingTimer = setTimeout(flushPending, ZOOM.commitFloorMs);
    if (performance.now() - lastCommitAt < ZOOM.commitFloorMs) return;
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(flushPending);
  };

  document.addEventListener(
    "touchstart",
    (e) => {
      if (!(e.target as Element)?.closest?.("#terminal, .xterm")) return;
      showChip();
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        startZoom = currentZoom;
      } else {
        startDist = 0;
      }
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 2 || startDist === 0) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      e.preventDefault();
      e.stopPropagation();
      requestZoom(startZoom * (dist / startDist));
    },
    { capture: true, passive: false },
  );

  const onPinchEnd = (): void => {
    if (startDist === 0) return;
    startDist = 0;
    flushPending();
  };
  document.addEventListener("touchend", onPinchEnd, {
    capture: true,
    passive: true,
  });
  document.addEventListener("touchcancel", onPinchEnd, {
    capture: true,
    passive: true,
  });

  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (e) => e.preventDefault(), {
      passive: false,
    });
  }

  if (!chip) return;
  chip.removeAttribute("hidden");
  renderChipLevel(currentZoom);

  chip.addEventListener("pointerdown", (e) => {
    const dir = (e.target as HTMLElement)
      .closest("[data-zoom]")
      ?.getAttribute("data-zoom");
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    const index = (ZOOM.steps as readonly number[]).indexOf(requestedZoom);
    const nextIndex = Math.min(
      ZOOM.steps.length - 1,
      Math.max(0, (index === -1 ? 4 : index) + (dir === "in" ? 1 : -1)),
    );
    requestZoom(ZOOM.steps[nextIndex]);
    showChip();
  });

  const onChipTouchStart = (e: TouchEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  chip.addEventListener("touchstart", onChipTouchStart, { passive: false });
}

async function main(): Promise<void> {
  const mount = document.getElementById("terminal");
  if (!mount) return;
  const theme = await fetchTheme();
  injectFontFace();
  const zoom = readZoom();
  currentZoom = zoom;
  const { term, fit } = createTerminal(theme, zoom);
  await fontsReady();
  mountTerminal(term, mount, fit);
  if (window.matchMedia("(pointer: coarse)").matches) {
    attachKineticScroll(term);
    attachZoomControl(term, fit);
  }
  connect(term);
}

void main();
