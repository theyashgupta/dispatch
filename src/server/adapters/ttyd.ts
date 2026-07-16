import { spawn, execFile, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { store } from "../store/board.store.js";

const execFileP = promisify(execFile);

interface TtydProc {
  child: ChildProcess;
  port: number;
}

/** Live ttyd processes, keyed by tmux session name ("dsp-<identifier>"). In-memory only. */
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
 *   2. Spawn already in flight → return THAT promise (concurrent callers share one spawn).
 *   3. Otherwise start the spawn, record it in-flight BEFORE any await, and clear the
 *      in-flight entry on settle (success or failure).
 * Steps 1-3 run with NO await between the check and the in-flight `set`, so a second concurrent
 * call always sees the entry — the whole point of the single-flight guard.
 * @remarks TERM-01: writable + loopback-only ttyd, single-flight spawn (T-03-07), port parsed
 * from stderr `Listening on port: N`.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function ensureTtyd(session: string): Promise<number> {
  const existing = procs.get(session);
  if (existing && existing.child.exitCode === null)
    return Promise.resolve(existing.port);

  const pending = inFlight.get(session);
  if (pending) return pending;

  const promise = spawnTtyd(session).finally(() => inFlight.delete(session));
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

/** Spawn a fresh ttyd, parse its port, confirm readiness, and track it. Rejects on failure. */
async function spawnTtyd(session: string): Promise<number> {
  const child = spawn(
    "ttyd",
    [
      "-W",
      "-i",
      "127.0.0.1",
      "-p",
      "0",
      "-t",
      "disableLeaveAlert=true",
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
function parsePort(child: ChildProcess): Promise<number> {
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
 */
export function killTtyd(session: string): void {
  const entry = procs.get(session);
  if (!entry) return;
  procs.delete(session);
  try {
    entry.child.kill();
  } catch {}
}

/**
 * The PIDs of every untracked `ttyd … tmux attach` process — the read-only half of the orphan
 * sweep, split out so a non-destructive caller (`uninstall --dry-run`) can COUNT orphans without
 * killing them.
 *
 * Fingerprint (RESEARCH Probe 2/3): match iff basename(argv[0]) === "ttyd" AND argv includes
 * "tmux" AND "attach". ttyd rewrites its own proctitle and STRIPS the `=dsp-<session>` target,
 * so dsp-scoping is impossible — the fingerprint is the app's unique signature on this
 * single-user host. The basename check excludes the backend's own node/ps/shell commands that
 * merely mention "ttyd" (Pitfall 1); a full-command-line substring match would self-match the
 * backend (Pitfall 2), so we parse `ps` and inspect argv[0] instead. Own pid/ppid are skipped
 * explicitly. Tolerant: `ps` failure returns an empty list, never crashes boot.
 * @remarks TERM-01 / RESIL-01 orphan sweep: keep the fingerprint EXACT — broadening it
 * over-matches a non-dsp ttyd/user process (denial of service). SECURITY: callers report the
 * COUNT only — never these PIDs or any argv (T-04-04 precedent).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function findDspTtydOrphans(): Promise<number[]> {
  let out: string;
  try {
    ({ stdout: out } = await execFileP("ps", ["-axww", "-o", "pid=,command="]));
  } catch {
    return [];
  }
  const pids: number[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    const argv = m[2].trim().split(/\s+/);
    if (path.basename(argv[0]) !== "ttyd") continue;
    if (!(argv.includes("tmux") && argv.includes("attach"))) continue;
    pids.push(pid);
  }
  return pids;
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

/**
 * Boot-time orphan sweep (Phase 5, RESIL-01): kill every untracked `ttyd … tmux attach`
 * process the fingerprint scan finds, returning the killed COUNT. After any restart the
 * procs/inFlight maps are empty, so every live dsp-ttyd is untracked; ports were already cleared
 * on load and the panel re-ensures on open, so a fresh spawn beats adopting a possibly-broken ttyd.
 * @remarks TERM-01 / RESIL-01: the fingerprint itself lives in `findDspTtydOrphans` — a `ps`
 * failure surfaces there as an empty list and still returns 0 killed here, so the sweep never
 * crashes boot. Scan-then-kill in one call is correct HERE (boot owns no prior plan to honor) but
 * NOT for `uninstall`, which must kill the set it already showed the user. SECURITY: logs the count
 * only — never PIDs or argv (T-04-04 precedent).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function killDspTtydOrphans(): Promise<number> {
  return killTtydPids(await findDspTtydOrphans());
}
