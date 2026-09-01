import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./exec.js";

/**
 * The tmux terminal-features entry that grants the `xterm-256color` terminal type (ttyd's
 * declared TERM, RESEARCH-confirmed) the `hyperlinks` capability. tmux's own default
 * `terminal-features[0]` entry for `xterm*` (`clipboard:ccolour:cstyle:focus:title`) omits
 * `hyperlinks`, so without this grant tmux's client-facing byte stream never carries a real
 * Claude Code `⏺` OSC 8 hyperlink escape at all — proven live (59-02-SUMMARY.md): `capture-pane
 * -e` shows tmux's own grid DOES track the hyperlink server-side, but an attached ttyd client
 * never receives the OSC 8 bytes without this terminal-feature, so xterm.js's `OscLinkProvider`
 * has nothing to resolve regardless of any browser-side patch.
 */
const HYPERLINKS_FEATURE_ENTRIES = [
  "xterm-256color:hyperlinks",
  "tmux-256color:hyperlinks",
] as const;

/**
 * tmux stderr signatures for "no server to talk to": `no server running on <sock>` and
 * `error connecting to <sock> (No such file or directory)`. tmux never auto-starts a server for
 * `show`/`set`, so a grant failing this way is the normal no-server-yet state (cold boot after a
 * machine restart) and self-heals on the next `newSession` — not worth a warning.
 */
const NO_SERVER_STDERR = /no server running|error connecting/;

/**
 * The entries of a tmux ARRAY server option as an exact-match Set (`show -g -v <name>` prints one
 * unquoted entry per line).
 *
 * @remarks Exact entries, never a substring scan of the raw `show` output: a user's own superset
 * entry (`tmux-256color:smcup@:rmcup@:hyperlinks`) contains Dispatch's entry as a substring and
 * would make a substring guard skip a grant that was never actually made. An empty Set on any
 * failure is the no-server-yet state every caller already treats as "not configured".
 */
async function serverOptionEntries(name: string): Promise<Set<string>> {
  try {
    const { stdout } = await run("tmux", ["show", "-g", "-v", name]);
    return new Set(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * Idempotently grant the tmux SERVER (a global, not per-session, option) the
 * {@link HYPERLINKS_FEATURE_ENTRIES} terminal-feature. Checked-then-appended rather than
 * unconditionally appended, because `set -ag` on an array option duplicates the entry on every
 * call and the tmux server outlives many backend boots (tmux is the app's own source of truth
 * for session survival across restarts) — an unconditional per-boot append would grow the option
 * unboundedly over the server's lifetime. Never throws: a missing tmux server makes the read
 * fail, which is treated as "not yet configured"; an append failure carrying a
 * {@link NO_SERVER_STDERR} signature is silently skipped (expected, self-healing state); and any
 * other append failure only warns — this is a best-effort capability grant, not a boot-blocking
 * requirement — the same degrade-never-crash contract every other optional capability grant in
 * this codebase follows.
 * @remarks Called at boot (`bootstrap/index.ts`) AND after every successful `newSession`.
 * `terminal-features` is server-global, not session-scoped, but scope does not decide the call
 * site: tmux never auto-starts a server for `show`/`set`, so the boot-time call fails whenever
 * no server exists yet (the normal post-reboot state), and tmux's default `exit-empty on` kills
 * a sessionless server — server options do not persist — so a mid-run server restart loses the
 * grant too. Immediately after `new-session` succeeds is the only moment a live server is
 * guaranteed, and the idempotency check keeps the repeated calls duplicate-free (a
 * parallel-kickoff race can at worst append one benign duplicate entry). RESEARCH's live OSC-8
 * probe found the escape sequences server-side (via a direct `capture-pane -e`) but a
 * live-streamed fresh-attach client received ZERO of them until this feature was granted;
 * smoke-verified only, per 59-02-SUMMARY.md.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export async function ensureHyperlinksTerminalFeature(): Promise<void> {
  const current = await serverOptionEntries("terminal-features");
  const missing = HYPERLINKS_FEATURE_ENTRIES.filter(
    (entry) => !current.has(entry),
  );
  if (missing.length === 0) return;
  try {
    for (const entry of missing) {
      await run("tmux", ["set", "-ag", "terminal-features", entry]);
    }
  } catch (err) {
    const failure = err as Error & { stderr?: string };
    if (NO_SERVER_STDERR.test(failure.stderr ?? "")) return;
    console.warn(
      `[tmux] could not grant xterm-256color the hyperlinks terminal-feature, Cmd+Click on real Claude Code OSC-8 links may not work: ${failure.message}`,
    );
  }
}

/**
 * The terminal-overrides entry that stops tmux from switching Dispatch's web clients to the
 * alternate screen.
 *
 * @remarks TERM-05: `tmux attach` itself owns the outer terminal's alt screen, and xterm.js
 * keeps no scrollback there, so an attached web client could never scroll locally regardless of
 * what the pane runs. Cancelling smcup/rmcup keeps tmux drawing on the primary screen, where
 * linefeed scrolling feeds the client's local scrollback. Keyed to `tmux-256color` because that is
 * the TERM ttyd.ts spawns with (`-T tmux-256color`), which narrows the blast radius but does NOT
 * eliminate it: `tmux-256color` is also the TERM tmux exports inside its own panes, so a nested
 * `tmux attach` run from inside any pane on this shared server, and any user whose own terminal is
 * configured to that TERM, matches the override too and loses smcup/rmcup (vim/less/man stop
 * restoring the screen on exit). That is a known, accepted cost of mutating a shared server, not an
 * exclusivity guarantee. Nothing removes the entry either; like every server option it dies only
 * with the tmux server.
 */
const NO_ALT_SCREEN_OVERRIDE_ENTRY = "tmux-256color:smcup@:rmcup@";

/**
 * Idempotently append {@link NO_ALT_SCREEN_OVERRIDE_ENTRY} to the server's terminal-overrides.
 *
 * @remarks Same shape and call sites as {@link ensureHyperlinksTerminalFeature}: server options
 * die with the tmux server, and immediately after `new-session` (plus boot) is the only moment a
 * live server is guaranteed.
 */
export async function ensureNoAltScreenOverride(): Promise<void> {
  const current = await serverOptionEntries("terminal-overrides");
  if (current.has(NO_ALT_SCREEN_OVERRIDE_ENTRY)) return;
  try {
    await run("tmux", [
      "set",
      "-ag",
      "terminal-overrides",
      NO_ALT_SCREEN_OVERRIDE_ENTRY,
    ]);
  } catch (err) {
    const failure = err as Error & { stderr?: string };
    if (NO_SERVER_STDERR.test(failure.stderr ?? "")) return;
    console.warn(
      `[tmux] could not cancel smcup/rmcup for tmux-256color clients: mobile terminal scrollback stays pinned to the visible screen: ${failure.message}`,
    );
  }
}

/**
 * `~/.dispatch/pty-shim.py`, derived locally following terminal-telemetry.ts's precedent: the
 * adapters layer may not import `services/infra/paths.ts`, so this and paths.ts's
 * `PTY_SHIM_PATH` (the writer side, used by bootstrap) derive the same location independently.
 */
const PTY_SHIM_PATH = path.join(os.homedir(), ".dispatch", "pty-shim.py");

/**
 * Wraps the pane command in the ?2026-stripping pty shim boot installed under `~/.dispatch`.
 *
 * @remarks TERM-05: Claude Code wraps every classic-renderer frame in synchronized-output
 * markers (DECSET 2026) because tmux answers its DECRQM probe with "supported". tmux then
 * repaints the pane per frame instead of scrolling, so an attached web client never accumulates
 * local scrollback. Stripping the markers restores linefeed scrolling, which is what makes
 * zero-round-trip touch scrolling possible on the phone. File absence means boot's python3
 * probe failed (see pty-shim-setup.ts) and the spawn degrades to unwrapped.
 */
function wrapWithPtyShim(commandArgv: string[]): string[] {
  if (!existsSync(PTY_SHIM_PATH)) return commandArgv;
  return [PTY_SHIM_PATH, ...commandArgv];
}

/**
 * True if tmux session `name` exists (`has-session -t <name>` exits 0).
 * Swallows failure into `false` (never rethrows) — a dead tmux server means "no session",
 * and this is the idempotency probe (an existing `dsp-<id>` session → reattach, never recreate).
 * @remarks Tolerant swallow-to-default (NEW-10): any error → `false`, never rethrown.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
export async function hasSession(name: string): Promise<boolean> {
  try {
    await run("tmux", ["has-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The live tmux session names as a Set (`list-sessions -F '#{session_name}'`). Mirrors
 * hasSession's tolerant try/catch-to-default: BOTH no-server conditions — `no server running
 * on <sock>` (server dead, the reboot analog) and `error connecting to <sock> (No such file
 * or directory)` (socket absent) — exit non-zero, so run() throws and we return an EMPTY Set.
 * That empty-on-any-error behaviour IS the entire boot-reconcile tolerance requirement
 * (RESEARCH Probe 1). list-sessions takes NO target, so no `=` prefix.
 * @remarks Tolerant swallow-to-default (NEW-10): empty Set on any no-server/no-socket error.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
export async function listSessions(): Promise<Set<string>> {
  try {
    const { stdout } = await run("tmux", [
      "list-sessions",
      "-F",
      "#{session_name}",
    ]);
    return new Set(
      stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/**
 * Every live pane's PID, grouped by owning session (`list-panes -a -F "#{session_name}
 * #{pane_pid}"`, one call for every session, live-verified: a session can hold more than one
 * pane so each session name maps to an array). Returns `null` — NOT an empty Map — on any
 * throw, deliberately diverging from listSessions' empty-Set-on-error tolerance: here `null`
 * means "unknown this tick, leave every card's derived state untouched", whereas an empty Map
 * would mean "no session owns any pane", which would incorrectly clear every live card's preview
 * state on a transient tmux hiccup.
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 */
export async function panePidsBySession(): Promise<Map<
  string,
  number[]
> | null> {
  try {
    const { stdout } = await run(
      "tmux",
      ["list-panes", "-a", "-F", "#{session_name} #{pane_pid}"],
      { timeout: 5000 },
    );
    const bySession = new Map<string, number[]>();
    for (const line of stdout.split("\n")) {
      const m = line.match(/^(\S+)\s+(\d+)$/);
      if (!m) continue;
      const list = bySession.get(m[1]) ?? [];
      list.push(Number(m[2]));
      bySession.set(m[1], list);
    }
    return bySession;
  } catch {
    return null;
  }
}

/**
 * Forces Claude Code's classic main-screen renderer inside every Dispatch pane.
 *
 * @remarks TERM-05: the fullscreen renderer (`tui: "fullscreen"`, the default for installs first
 * launched on 2.1.239+) owns the alt screen with mouse tracking on, so a phone flick becomes one
 * round-trip mouse report per row and tmux history stays at 0. The classic renderer writes the
 * transcript to the normal buffer, where xterm.js scrolls it locally with zero round trips.
 */
const CLASSIC_RENDERER_ENV = {
  CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1",
} as const;

/**
 * Lines of pane history every Dispatch pane is given, matching the scrollback seed budget the
 * endpoint and the web client's xterm buffer are both sized to.
 *
 * @remarks TERM-05: tmux's default is 2,000, and it allocates a pane's history buffer AT PANE
 * CREATION, so this has to be set before `new-session` builds the window, not after it like the
 * two `ensure*` grants. It rides in the SAME tmux invocation as `new-session` (`set ... ; ...`, a
 * tmux command sequence) because that is the only form that works from cold: `set -g` needs a live
 * server, and tmux's `exit-empty on` kills a sessionless one, so a separate pre-call would fail on
 * exactly the boot where it matters. Honest shared-server consequence: `history-limit` is a
 * server-global option, so every pane created on this tmux server afterwards, including the
 * user's own, gets the same 10,000-line buffer (more memory per pane) until the server exits.
 */
const HISTORY_LIMIT = "10000";

/**
 * Create a detached session running `commandArgv` in `cwd`:
 *   `tmux set -g history-limit <n> ';' new-session -d -s <name> -c <cwd> -x 200 -y 50
 *   [-e KEY=VALUE ...] <...commandArgv>`
 * The leading `set` is a tmux command sequence, not a second process, and it MUST precede
 * `new-session` in the same invocation (see {@link HISTORY_LIMIT}).
 * The explicit -x/-y geometry is required for sane capture-pane output BEFORE any client
 * attaches (probe-verified — without it the pane has a tiny default size and readiness
 * detection is unreliable). Trailing args become the window command. Optional `env` entries
 * become `-e KEY=VALUE` pairs (tmux ≥3.2, probe-verified on 3.6a) placed after the geometry
 * and before the command, so per-session values reach the spawned process without ever
 * appearing in its argv. Ends by re-running the idempotent hyperlinks grant: session creation is
 * the one moment a live tmux server is guaranteed, which closes the cold-boot and
 * server-restart gaps the boot-time call alone cannot cover (see
 * {@link ensureHyperlinksTerminalFeature}).
 * @remarks NEW-01: the `-x 200 -y 50` geometry is load-bearing for readiness/marker parsing.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function newSession(
  name: string,
  cwd: string,
  commandArgv: string[],
  env?: Record<string, string>,
): Promise<void> {
  const envArgs = Object.entries({ ...CLASSIC_RENDERER_ENV, ...env }).flatMap(
    ([key, value]) => ["-e", `${key}=${value}`],
  );
  await run("tmux", [
    "set",
    "-g",
    "history-limit",
    HISTORY_LIMIT,
    ";",
    "new-session",
    "-d",
    "-s",
    name,
    "-c",
    cwd,
    "-x",
    "200",
    "-y",
    "50",
    ...envArgs,
    ...wrapWithPtyShim(commandArgv),
  ]);
  await ensureHyperlinksTerminalFeature();
  await ensureNoAltScreenOverride();
}

/**
 * Capture the visible pane contents (`capture-pane -p -t <name>`) and return stdout.
 * The readiness poll (Plan 03) scans this for `? for shortcuts` / the trust dialog.
 * `join: true` adds `-J` (available on tmux 3.6a): lines tmux itself soft-wrapped are
 * rejoined, so the marker watcher parses/diffs layout-independent text after a client
 * attach resizes the pane. (The TUI's own hard-wrapped lines are unaffected — Probe 2.)
 * @remarks NEW-02: `-J` (join, tmux 3.6a) rejoins tmux's own soft-wrapped lines so the watcher
 * parses/diffs layout-independent text.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function capturePane(
  name: string,
  opts: { join?: boolean } = {},
): Promise<string> {
  const args = ["capture-pane", "-p"];
  if (opts.join) args.push("-J");
  args.push("-t", name);
  const { stdout } = await run("tmux", args);
  return stdout;
}

/**
 * stdout ceiling for one scrollback capture, following `ttyd.ts`'s `PS_MAX_BUFFER` precedent.
 *
 * @remarks `run()` is `promisify(execFile)`, whose default 1 MiB ceiling REJECTS the whole call
 * rather than truncating, so an over-budget capture answers the seed endpoint 502 and the client
 * silently gets nothing. A colour-preserving (`-e`) capture of a 10,000-line, 200-column pane
 * exceeds 1 MiB routinely (about 105 bytes/line is all 1 MiB buys), so the ceiling is sized to the
 * documented budget instead of the Node default.
 */
const SCROLLBACK_MAX_BUFFER = 32 * 1024 * 1024;

/**
 * Capture the pane's HISTORY, the rows above the visible screen, as colour-preserving ANSI text
 * (`capture-pane -p -e -S -<limit> -E -1`).
 *
 * @remarks TERM-05: the attach-time scrollback seed. `-E -1` deliberately excludes the visible
 * rows because tmux's attach redraw paints those; including them would duplicate one screenful at
 * the seam between seeded history and the live stream. The `timeout` is not optional hardening:
 * the web client awaits this response BEFORE it opens its WebSocket, so a tmux server that accepts
 * the connection and never answers would leave the terminal permanently unconnected with no
 * reconnect path (`panePidsBySession`'s own 5s bound exists for the same tmux state).
 */
export async function captureHistory(
  name: string,
  limit: number,
): Promise<string> {
  const { stdout } = await run(
    "tmux",
    ["capture-pane", "-p", "-e", "-t", name, "-S", `-${limit}`, "-E", "-1"],
    { timeout: 5000, maxBuffer: SCROLLBACK_MAX_BUFFER },
  );
  return stdout;
}

/**
 * Return the pane's current size in cells (`display -t <target> -p '#{pane_width} #{pane_height}'`).
 * The marker watcher stores BOTH beside the flip-back baseline: a ttyd client attach OR detach
 * resizes the window and rewraps the whole transcript, so a baseline taken at another geometry is
 * invalid. Width alone missed the detach case — a ttyd sweep-kill drops the client and shrinks the
 * pane HEIGHT (14→12) at constant width, which rewrapped/reflowed the body and false-flipped a
 * still-blocked card. Fetching both in ONE display call keeps it to a single subprocess per check.
 * @remarks NEW-03: fetch BOTH width and height — a width-only guard missed the ttyd-detach case
 * (height 14→12 at constant width → rewrap → false-flip a still-blocked card). NEW-04: an
 * unparseable (NaN) size THROWS, because a silent NaN compares unequal forever and disables
 * flip-back.
 * @see docs/ARCHITECTURE.md#watcher-discriminator
 */
export async function paneSize(
  target: string,
): Promise<{ width: number; height: number }> {
  const { stdout } = await run("tmux", [
    "display",
    "-t",
    target,
    "-p",
    "#{pane_width} #{pane_height}",
  ]);
  const [width, height] = stdout
    .trim()
    .split(/\s+/)
    .map((n) => Number.parseInt(n, 10));
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`unparseable pane size: ${stdout.trim()}`);
  }
  return { width, height };
}

/**
 * Load a file into a NAMED tmux buffer (`load-buffer -b <bufferName> <filePath>`).
 * Per-session buffer names (`dsp-<identifier>`) so parallel starts can't clobber each other.
 * @remarks NEW-09: per-session NAMED buffers keep parallel kickoffs from clobbering each other.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function loadBuffer(
  bufferName: string,
  filePath: string,
): Promise<void> {
  await run("tmux", ["load-buffer", "-b", bufferName, filePath]);
}

/**
 * Bracketed-paste a named buffer into a session target and auto-delete the buffer:
 *   `paste-buffer -b <bufferName> -t <target> -p -d`
 * `-p` = bracketed paste (arrives as ONE message, not per-newline); `-d` = delete buffer after.
 * @remarks NEW-05: `-p` bracketed paste delivers the buffer as ONE message (not per-newline);
 * `-d` deletes the buffer after.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function pasteBuffer(
  bufferName: string,
  target: string,
): Promise<void> {
  await run("tmux", [
    "paste-buffer",
    "-b",
    bufferName,
    "-t",
    target,
    "-p",
    "-d",
  ]);
}

/**
 * Send literal key(s) to a target (`send-keys -t <target> <...keys>`).
 * Used to submit the kickoff (a separate `Enter` after the paste settles) and to accept
 * the trust dialog fallback.
 * @remarks NEW-06: the submit `Enter` is a SEPARATE send-keys AFTER the paste settles — never
 * fold the newline into the paste or the prompt fires before the full text lands.
 * @see docs/ARCHITECTURE.md#tmux-invocations
 */
export async function sendKeys(target: string, keys: string[]): Promise<void> {
  await run("tmux", ["send-keys", "-t", target, ...keys]);
}

/**
 * Kill session `name` (`kill-session -t <name>`), reporting whether tmux accepted it. Never
 * throws: the rollback/undo path must be idempotent (killing an already-gone session is a no-op).
 * @remarks Tolerant swallow-to-default (NEW-10): idempotent no-op if the session is already gone.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
export async function killSession(name: string): Promise<boolean> {
  try {
    await run("tmux", ["kill-session", "-t", name]);
    return true;
  } catch {
    return false;
  }
}
