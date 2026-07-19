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
const HYPERLINKS_FEATURE_ENTRY = "xterm-256color:hyperlinks";

/**
 * tmux stderr signatures for "no server to talk to": `no server running on <sock>` and
 * `error connecting to <sock> (No such file or directory)`. tmux never auto-starts a server for
 * `show`/`set`, so a grant failing this way is the normal no-server-yet state (cold boot after a
 * machine restart) and self-heals on the next `newSession` — not worth a warning.
 */
const NO_SERVER_STDERR = /no server running|error connecting/;

/**
 * Idempotently grant the tmux SERVER (a global, not per-session, option) the
 * {@link HYPERLINKS_FEATURE_ENTRY} terminal-feature. Checked-then-appended rather than
 * unconditionally appended, because `set -ag` on an array option duplicates the entry on every
 * call and the tmux server outlives many backend boots (tmux is the app's own source of truth
 * for session survival across restarts) — an unconditional per-boot append would grow the option
 * unboundedly over the server's lifetime. Never throws: a missing tmux server makes the read
 * fail, which is treated as "not yet configured"; an append failure carrying a
 * {@link NO_SERVER_STDERR} signature is silently skipped (expected, self-healing state); and any
 * other append failure only warns — this is a best-effort capability grant, not a boot-blocking
 * requirement (mirrors ttyd-index-setup.ts's degrade-never-crash contract for its own optional
 * Cmd+Click feature).
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
  let current = "";
  try {
    current = (await run("tmux", ["show", "-g", "terminal-features"])).stdout;
  } catch {}
  if (current.includes(HYPERLINKS_FEATURE_ENTRY)) return;
  try {
    await run("tmux", [
      "set",
      "-ag",
      "terminal-features",
      HYPERLINKS_FEATURE_ENTRY,
    ]);
  } catch (err) {
    const failure = err as Error & { stderr?: string };
    if (NO_SERVER_STDERR.test(failure.stderr ?? "")) return;
    console.warn(
      `[tmux] could not grant xterm-256color the hyperlinks terminal-feature — Cmd+Click on real Claude Code OSC-8 links may not work: ${failure.message}`,
    );
  }
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
 * Create a detached session running `commandArgv` in `cwd`:
 *   `tmux new-session -d -s <name> -c <cwd> -x 200 -y 50 [-e KEY=VALUE ...] <...commandArgv>`
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
  const envArgs = Object.entries(env ?? {}).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`,
  ]);
  await run("tmux", [
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
    ...commandArgv,
  ]);
  await ensureHyperlinksTerminalFeature();
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
 * Kill session `name` (`kill-session -t <name>`). Swallows failure — the rollback/undo
 * path must be idempotent (killing an already-gone session is a no-op success for us).
 * @remarks Tolerant swallow-to-default (NEW-10): idempotent no-op if the session is already gone.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
export async function killSession(name: string): Promise<void> {
  try {
    await run("tmux", ["kill-session", "-t", name]);
  } catch {}
}
