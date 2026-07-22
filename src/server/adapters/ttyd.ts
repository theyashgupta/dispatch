import { spawn, execFile, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { store } from "../store/board.store.js";
import { FONT_FAMILY } from "../../shared/nerd-font-mono.js";

const execFileP = promisify(execFile);
const TTYD_RUNTIME_REVISION = 2;
const TTYD_RUNTIME_REVISION_KEY = "DISPATCH_TTYD_REVISION";
const TTYD_RUNTIME_REVISION_MARKER = `"${TTYD_RUNTIME_REVISION_KEY}":${TTYD_RUNTIME_REVISION}`;

/**
 * Dark xterm `ITheme` delivered to ttyd via `-t theme=` (SET_PREFERENCES over the websocket).
 * Hardcoded hex/rgba, not a CSS-variable reference, because the ttyd client is a separate
 * origin/process that cannot read dispatch's `tokens.css` custom properties — these values are
 * the resolved hexes for `--bg`/`--text`/`--accent` etc. `selectionForeground` is deliberately
 * left unset so the underlying text color still shows through the translucent selection overlay.
 * @remarks TERM-02.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const DARK_THEME = {
  background: "#0b0c0e",
  foreground: "#e8e9ea",
  cursor: "#5e6ad2",
  cursorAccent: "#0b0c0e",
  selectionBackground: "rgba(94,106,210,0.35)",
  selectionInactiveBackground: "rgba(94,106,210,0.18)",
  black: "#26272b",
  red: "#e5484d",
  green: "#3fb950",
  yellow: "#d9b23c",
  blue: "#5e6ad2",
  magenta: "#a371f7",
  cyan: "#56d4dd",
  white: "#e8e9ea",
  brightBlack: "#8a8f98",
  brightRed: "#ff6b6b",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#76e3ea",
  brightWhite: "#ffffff",
  [TTYD_RUNTIME_REVISION_KEY]: TTYD_RUNTIME_REVISION,
};

interface TtydProc {
  child: ChildProcess | null;
  port: number;
  /** Resolved OS pid for a `child === null` (adopted) entry only — the sole handle `killTtyd` has left to actually terminate a re-adopted process it never spawned. Absent for a normally-spawned entry (`entry.child.kill()` is used instead). */
  pid?: number;
}

/**
 * Live ttyd processes, keyed by tmux session name ("dsp-<identifier>"). In-memory only. A
 * `child: null` entry means this backend never spawned the process — it was re-adopted at boot
 * from a prior backend's still-running ttyd (ROBU-01) — so there is no `child.on("exit")` wiring
 * for it; its liveness can only be learned by re-probing (see `ensureTtyd`'s adopted-entry branch).
 */
const procs = new Map<string, TtydProc>();

/**
 * Sessions with a spawn currently in flight, keyed by the same session name. Set SYNCHRONOUSLY
 * before the first await so concurrent callers share one spawn (single-flight; T-03-07).
 */
const inFlight = new Map<string, Promise<number>>();

/** ttyd writes the kernel-assigned port to STDERR (probe-verified this machine). */
const PORT_RE = /Listening on port:\s*(\d+)/;

/** Cold first-spawn-per-boot measured ~5s (Pitfall 5) → tolerant 10s cap on both waits. */
const PORT_PARSE_TIMEOUT_MS = 10_000;
const READY_TIMEOUT_MS = 10_000;
const READY_POLL_CADENCE_MS = 100;

/**
 * Ensure a writable, loopback-only ttyd is listening for `session`, returning its port.
 * Idempotent + single-flight:
 *   1. Live tracked process → return its port (reuse, mirrors tmux reattach).
 *   1a. Adopted (childless) entry → re-probe via `probeAdoption` instead of trusting it forever:
 *       an adopted entry has no `child.on("exit")` wiring, so a `net.connect` round-trip is the
 *       only way to learn it died after boot (Pitfall 3); a dead probe drops ONLY the entry it
 *       observed (identity guard) and rejoins any in-flight spawn before starting a fresh one, so
 *       concurrent callers on a dead adopted entry share one spawn instead of double-spawning (WR-01).
 *   2. Spawn already in flight → return THAT promise (concurrent callers share one spawn).
 *   3. Otherwise start the spawn, record it in-flight BEFORE any await, and clear the
 *      in-flight entry on settle (success or failure).
 * Steps 1-3 run with NO await between the check and the in-flight `set`, so a second concurrent
 * call always sees the entry — the whole point of the single-flight guard.
 * `indexPath` (TTYD_INDEX_PATH when the boot-provisioned artifact exists, else null) is resolved
 * by the caller rather than imported here: `services/infra/paths.js` lives one layer above `adapters` in
 * the backend DAG (boundaries/element-types), so the existence check happens in
 * `services/orchestration/terminal.ts` and the result is threaded through as plain data.
 * @remarks TERM-01: writable + loopback-only ttyd, single-flight spawn (T-03-07), port parsed
 * from stderr `Listening on port: N`.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function ensureTtyd(
  session: string,
  indexPath: string | null,
): Promise<number> {
  const existing = procs.get(session);
  if (existing) {
    if (existing.child === null) {
      return probeAdoption(existing.port).then((alive) => {
        if (alive) return existing.port;
        if (procs.get(session) === existing) procs.delete(session);
        const pending = inFlight.get(session);
        if (pending) return pending;
        return ensureTtyd(session, indexPath);
      });
    }
    if (existing.child.exitCode === null) return Promise.resolve(existing.port);
  }

  const pending = inFlight.get(session);
  if (pending) return pending;

  const promise = spawnTtyd(session, indexPath).finally(() =>
    inFlight.delete(session),
  );
  inFlight.set(session, promise);
  return promise;
}

/**
 * The tmux session names ttyd currently tracks — either a live tracked process or a spawn still in
 * flight. The watcher folds these into its end-of-tick cleanup `tracked` set so a ttyd whose session
 * has gone session-lost is torn down even when it appears in NONE of the watcher's four per-session
 * maps (WR-02). Because a live entry stays in `procs` across ticks, a spawn that completes AFTER the
 * first cleanup tick is still reported here and killed on the NEXT tick — the sweep is not one-shot.
 * Kept as an export (not a store coupling) so the import direction stays acyclic (watcher → ttyd).
 */
export function trackedTtydSessions(): string[] {
  return [...procs.keys(), ...inFlight.keys()];
}

/**
 * Spawn a fresh ttyd, parse its port, confirm readiness, and track it. Rejects on failure. The
 * `-I` flag is added only when the caller resolved a non-null `indexPath` (TTYD_INDEX_PATH exists
 * at spawn time) — provisionTtydIndex deletes that file on any failed boot-time patch, so its
 * existence is a trustworthy, per-spawn signal for the cmd+click-gated index versus stock ttyd
 * behavior.
 */
async function spawnTtyd(
  session: string,
  indexPath: string | null,
): Promise<number> {
  const child = spawn(
    "ttyd",
    [
      "-W",
      "-i",
      "127.0.0.1",
      "-p",
      "0",
      ...(indexPath != null ? ["-I", indexPath] : []),
      "-t",
      "disableLeaveAlert=true",
      "-t",
      `fontFamily=${FONT_FAMILY}`,
      "-t",
      "fontSize=15",
      "-t",
      `theme=${JSON.stringify(DARK_THEME)}`,
      "tmux",
      "attach",
      "-t",
      `=${session}`,
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );

  try {
    const port = await parsePort(child);
    await waitForListening(port);
    procs.set(session, { child, port });
    child.unref();
    child.on("error", (err) => {
      console.error(`[ttyd] error event for ${session}:`, err.message);
    });
    child.on("exit", () => onExit(session, child));
    return port;
  } catch (err) {
    try {
      child.kill();
    } catch {}
    throw err;
  }
}

/** Resolve with the port ttyd reports on stderr (see PORT_RE), or reject on timeout/early exit. */
export function parsePort(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(
      () => reject(new Error("ttyd port not reported within 10s")),
      PORT_PARSE_TIMEOUT_MS,
    );
    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(PORT_RE);
      if (m) {
        clearTimeout(timer);
        child.stderr?.off("data", onData);
        resolve(Number(m[1]));
      }
    };
    child.stderr?.on("data", onData);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`ttyd failed to spawn: ${err.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`ttyd exited early (code ${code}): ${buf}`));
    });
  });
}

/**
 * Poll the port with net.connect until it accepts a connection (the port line appears slightly
 * before the socket accepts). Server-side because the browser can't probe the cross-origin ttyd
 * port (no CORS). ~100ms cadence, 10s cap.
 */
function waitForListening(
  port: number,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: "127.0.0.1", port }, () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() > deadline)
          reject(new Error("ttyd not listening in time"));
        else setTimeout(attempt, READY_POLL_CADENCE_MS);
      });
    };
    attempt();
  });
}

/** Boot-time adoption probe timeout: an already-running process answers in ms or is dead. */
const ADOPTION_PROBE_TIMEOUT_MS = 1500;

/**
 * One-shot readiness probe for boot-time ttyd adoption (ROBU-01) — deliberately NOT
 * `waitForListening`'s retry-until-10s loop: a process left running by a PRIOR backend boot
 * either accepts a connect attempt within milliseconds or is already dead, so looping would slow
 * boot proportionally to the number of open cards. Also reused by `ensureTtyd` to re-check an
 * already-adopted (childless) entry's liveness on every call (Pitfall 3).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
function probeAdoption(
  port: number,
  timeoutMs = ADOPTION_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/**
 * Batched port→PID resolution via `lsof -Fpn` (verified live on this machine across both a
 * single process holding multiple ports and distinct processes each holding one port — the
 * `p<pid>` record line always precedes the `n<host>:<port>` line(s) it owns, so a `p`/`n` scan is
 * an unambiguous port→PID map even for several DISTINCT owning PIDs in one invocation). Tolerant:
 * ANY failure (lsof absent, no match, unexpected output) resolves an EMPTY map — callers MUST
 * treat that as "ownership unconfirmed, decline adoption for those ports", never "adopt
 * everything" (Pitfall 4). Read-only diagnostic with a fixed argv array and server-derived
 * `number` ports only (never a shell string, never client input) — same carve-out precedent as
 * `findDspTtydOrphans`'s `ps` call, so this deliberately bypasses the `adapters/exec.ts` chokepoint.
 * SECURITY: callers report the resulting COUNT only — never these PIDs or ports (T-04-04
 * precedent).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
async function pidsListeningOnPorts(
  ports: number[],
): Promise<Map<number, number>> {
  if (ports.length === 0) return new Map();
  try {
    const { stdout } = await execFileP("lsof", [
      "-nP",
      `-iTCP:${ports.join(",")}`,
      "-sTCP:LISTEN",
      "-Fpn",
    ]);
    const byPort = new Map<number, number>();
    let currentPid: number | null = null;
    for (const line of stdout.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = Number(line.slice(1));
      } else if (line.startsWith("n") && currentPid !== null) {
        const m = line.match(/:(\d+)$/);
        if (m) byPort.set(Number(m[1]), currentPid);
      }
    }
    return byPort;
  } catch {
    return new Map();
  }
}

/**
 * Boot-time adopt-then-narrow-sweep (ROBU-01), replacing an unconditional
 * `killDspTtydOrphans()` call: probe every candidate's persisted port, resolve each surviving
 * port's owning PID via `pidsListeningOnPorts`, and adopt ONLY when that owner is a confirmed
 * dsp-ttyd — its PID must be in the `findDspTtydOrphans` fingerprint set — so a kernel-reused
 * ephemeral port grabbed by a foreign loopback listener is never bound to the card's writable
 * iframe — the boot-adoption threat model's foreign-service case. Each confirmed candidate gets a
 * childless `procs` entry and its PID is excluded
 * from the orphan sweep so a re-adopted ttyd is never killed out from under the still-open iframe.
 * A candidate whose probe fails, or whose owner is not a confirmed dsp-ttyd, is silently left
 * un-adopted — it degrades to exactly today's behavior
 * (swept as an orphan, panel fresh-spawns on next open); never a crash, never a `terminalError`
 * banner for a panel that may not even be open (Anti-Pattern). `findDspTtydOrphans`'s fingerprint
 * is untouched — only the resulting kill LIST is narrowed by the spared-PID set.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function adoptAndSweep(
  candidates: { session: string; port: number }[],
): Promise<Set<string>> {
  const probed = await Promise.all(
    candidates.map(async (c) => ({ ...c, alive: await probeAdoption(c.port) })),
  );
  const alive = probed.filter((c) => c.alive);
  const pidByPort = await pidsListeningOnPorts(alive.map((c) => c.port));
  const { candidates: ttydPids, compatible } = await scanDspTtydProcesses();
  const adopted = new Set<string>();
  const sparedPids = new Set<number>();
  for (const c of alive) {
    const pid = pidByPort.get(c.port);
    if (pid == null || !compatible.has(pid)) continue;
    procs.set(c.session, { child: null, port: c.port, pid });
    adopted.add(c.session);
    sparedPids.add(pid);
  }
  const orphans = [...ttydPids].filter((pid) => !sparedPids.has(pid));
  killTtydPids(orphans);
  return adopted;
}

/**
 * Reconcile a tracked ttyd's exit. The tracked-child guard is essential: a stale/replaced child
 * exiting (a re-spawn already took over the slot) must NOT clear a live port or set a died error.
 * Only when the exited child IS the currently tracked one do we clear the port + flag the card.
 */
function onExit(session: string, exitedChild: ChildProcess): void {
  const entry = procs.get(session);
  if (!entry || entry.child !== exitedChild) return;

  procs.delete(session);
  const card = store.snapshot().cards.find((c) => c.tmuxSession === session);
  if (card) void store.recordTtydExit(card.id, { variant: "died" });
}

/**
 * Tear down the tracked ttyd for `session` (later-phase teardown). Idempotent — no-op if
 * untracked. Deletes the entry BEFORE killing so the child's exit handler sees no tracked
 * entry and does not flag a spurious `died` error (a deliberate kill is teardown, not death).
 * An adopted (`child === null`) entry has no child handle to call — it is torn down via its
 * resolved `pid` instead (ROBU-01), so a re-adopted-then-torn-down session doesn't leak the
 * underlying process past this backend's own lifetime.
 */
export function killTtyd(session: string): void {
  const entry = procs.get(session);
  if (!entry) return;
  procs.delete(session);
  try {
    if (entry.child) entry.child.kill();
    else if (entry.pid != null) process.kill(entry.pid, "SIGTERM");
  } catch {}
}

/**
 * The PIDs of every untracked `ttyd … tmux attach` process — the read-only half of the orphan
 * sweep, split out so a non-destructive caller (`uninstall --dry-run`) can COUNT orphans without
 * killing them.
 *
 * Fingerprint (RESEARCH Probe 2/3): match iff basename(argv[0]) === "ttyd" AND either argv includes
 * "tmux" + "attach" or the command has Dispatch's exact current revision marker. The original
 * tmux fingerprint remains unchanged for legacy processes; the marker is the stronger ownership
 * proof for current processes because macOS ttyd truncates the rewritten proctitle before the
 * trailing command once the full theme JSON reaches its fixed buffer. The basename check excludes
 * the backend's own node/ps/shell commands that merely mention "ttyd" (Pitfall 1); a generic
 * full-command-line substring match would self-match the backend (Pitfall 2), so only the exact
 * fixed marker is accepted. Own pid/ppid are skipped explicitly. Tolerant: `ps` failure returns an
 * empty list, never crashes boot.
 * @remarks TERM-01 / RESIL-01 orphan sweep: keep the fingerprint EXACT — broadening it
 * over-matches a non-dsp ttyd/user process (denial of service). SECURITY: callers report the
 * COUNT only — never these PIDs or any argv (T-04-04 precedent).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function findDspTtydOrphans(): Promise<number[]> {
  const { candidates } = await scanDspTtydProcesses();
  return [...candidates];
}

/**
 * Classify the unchanged Dispatch ttyd ownership fingerprint by runtime-contract compatibility.
 * Every fingerprint match remains sweepable, while only an exact current revision is adoptable.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
async function scanDspTtydProcesses(): Promise<{
  candidates: Set<number>;
  compatible: Set<number>;
}> {
  let out: string;
  try {
    ({ stdout: out } = await execFileP("ps", ["-axww", "-o", "pid=,command="]));
  } catch {
    return { candidates: new Set(), compatible: new Set() };
  }
  const candidates = new Set<number>();
  const compatible = new Set<number>();
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    const argv = m[2].trim().split(/\s+/);
    if (path.basename(argv[0]) !== "ttyd") continue;
    const hasCurrentRevision = m[2].includes(TTYD_RUNTIME_REVISION_MARKER);
    if (
      !(argv.includes("tmux") && argv.includes("attach")) &&
      !hasCurrentRevision
    )
      continue;
    candidates.add(pid);
    if (hasCurrentRevision) compatible.add(pid);
  }
  return { candidates, compatible };
}

/**
 * SIGTERM an ALREADY-SCANNED pid set, returning the killed COUNT — the destructive half of the
 * orphan sweep, split from the scan so a caller that must kill exactly what it showed the user
 * (`uninstall`) can pass the pids it captured at scan time instead of re-scanning at execution time
 * and killing something the user never saw. A pid that has since exited throws and is skipped, so a
 * stale set degrades to a no-op rather than an error.
 * @remarks SECURITY: callers report the COUNT only — never these PIDs or any argv (T-04-04
 * precedent).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function killTtydPids(pids: number[]): number {
  let killed = 0;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      killed++;
    } catch {}
  }
  return killed;
}
