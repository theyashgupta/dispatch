import { spawn, execFile, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { store } from "../store/board.store.js";

const execFileP = promisify(execFile);
/**
 * Bumped 5 -> 6 alongside the `-b` base path moving from card-keyed to session-keyed (`PROXY-01`).
 * A ttyd spawned by an earlier build carries a card-keyed `-b`, and adopting it would hand the app
 * a live-looking pane the new session-keyed route cannot address. Old-revision processes fall out
 * of `compatible`, are never re-adopted, and are therefore swept — a deliberate, one-time,
 * user-visible reconnect on first boot after upgrade, never a silent adoption of an unaddressable
 * pane. The re-adoption fingerprint has only NARROWED, per the rule below.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const TTYD_RUNTIME_REVISION = 6;
const TTYD_RUNTIME_REVISION_KEY = "DISPATCH_TTYD_REVISION";

/**
 * The sole re-adoption fingerprint, `-t`'d as a retained bare key (arbitrary value `1`) rather
 * than in the theme JSON that used to also carry it — that JSON is gone now that the native
 * client owns theme/font, so this key is the ONLY marker left. It lives in the KEY, not the
 * value, because ttyd rewrites `=`→space in its proctitle — a value-side revision would split
 * into two separate, ungreppable tokens (RESEARCH.md §4, empirically verified against installed
 * ttyd 1.7.7).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const TTYD_RUNTIME_REVISION_RETAINED_KEY = `${TTYD_RUNTIME_REVISION_KEY}_${TTYD_RUNTIME_REVISION}`;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ownership arm that survives ttyd's proctitle rewrite. ttyd overwrites its own argv buffer at
 * startup (rendering `-t key=value` as `-t key value`), and when an earlier token is large enough
 * to fill that fixed buffer the TRAILING command is dropped outright — a pre-2.7.0 ttyd carrying
 * the retired multi-KB theme JSON shows no `tmux attach` in `ps` at all, empirically confirmed
 * against ttyd 1.7.7. Such a process matched neither the `tmux`+`attach` arm nor the
 * current-revision arm, so it was never swept AND never adopted: it leaked across every restart
 * and upgrade, holding its port and serving its session from the retired patched index forever.
 * `-b /sessions/<sessionId>/terminal` is early enough to always survive the rewrite and is
 * specific enough to be dispatch's own. This widens the SWEEP arm ONLY — `compatible` still
 * demands the exact current revision key, because a re-adoption fingerprint may only ever narrow.
 * The regex itself is agnostic to what the single opaque segment between `/sessions/` and
 * `/terminal` names (a card id, formerly, or a session id, now), so it needs no code change here.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const DSP_BASE_PATH_RE = /(?:^|\s)-b\s+\/sessions\/[^\s/]+\/terminal(?:\s|$)/;

/**
 * `ps -axww` prints each process's FULL command line, and a leaked pre-2.7.0 ttyd contributes
 * ~140KB of retired theme JSON on its own. Node's 1 MiB `execFile` default is therefore reachable
 * on a machine that has accumulated a handful of them — and the failure is self-reinforcing, since
 * a scan that throws sweeps nothing, which leaks another ttyd, which enlarges the next scan.
 */
const PS_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Boundary-anchored matcher for the current revision inside a ttyd proctitle. A bare substring
 * `includes` of the retained key would also fire on a future revision 40–49 (`…REVISION_4` is a
 * prefix of `…REVISION_40`), silently adopting a process spawned by an incompatible runtime
 * contract. The trailing `(?!\d)` negative lookahead pins the match to exactly this revision.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const REVISION_RETAINED_KEY_RE = new RegExp(
  `${escapeRegExp(TTYD_RUNTIME_REVISION_RETAINED_KEY)}(?!\\d)`,
);

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
 * `sessionId` threads through to `spawnTtyd`'s `-b /sessions/<sessionId>/terminal` base-path so
 * the session-keyed reverse proxy (PROXY-01) can route to this exact process.
 * @remarks TERM-01: writable + loopback-only ttyd, single-flight spawn (T-03-07), port parsed
 * from stderr `Listening on port: N`.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function ensureTtyd(
  session: string,
  sessionId: string,
): Promise<number> {
  const existing = procs.get(session);
  if (existing) {
    if (existing.child === null) {
      return probeAdoption(existing.port).then((alive) => {
        if (alive) return existing.port;
        if (procs.get(session) === existing) procs.delete(session);
        const pending = inFlight.get(session);
        if (pending) return pending;
        return ensureTtyd(session, sessionId);
      });
    }
    if (existing.child.exitCode === null) return Promise.resolve(existing.port);
  }

  const pending = inFlight.get(session);
  if (pending) return pending;

  const promise = spawnTtyd(session, sessionId).finally(() =>
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
 * Read-only live-port lookup for the terminal proxy (PROXY-03) — never spawns, never mutates
 * `procs`; the proxy must re-resolve the port on every request/upgrade rather than caching it
 * once, so a mid-session ttyd respawn or boot re-adoption keeps reconnecting. Liveness follows
 * the same rule as `ensureTtyd`'s own check: a `child === null` entry is adopted-alive, a
 * non-null child is alive only while its `exitCode` is still `null`.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export function getLiveTtydPort(session: string): number | null {
  const entry = procs.get(session);
  if (!entry) return null;
  if (entry.child === null) return entry.port;
  return entry.child.exitCode === null ? entry.port : null;
}

/**
 * Spawn a fresh ttyd, parse its port, confirm readiness, and track it. Rejects on failure. `-b
 * /sessions/<sessionId>/terminal` scopes ttyd's own asset/WS routing to the session-keyed prefix
 * the reverse proxy forwards under (PROXY-01) — confirmed by a live spike (72-RESEARCH.md) to
 * change ttyd's server-side routing only, never the served bytes. ttyd stays loopback-bound (`-i
 * 127.0.0.1 -p 0` unchanged) — reachable only through the proxy.
 * @remarks This argv shape is fixed and unconditional — no environment variable selects an
 * alternate form. `disableLeaveAlert=true` and `TTYD_RUNTIME_REVISION_RETAINED_KEY=1` are the only
 * two `-t` tokens: no `-I` served index, no `-t theme|fontFamily|fontSize` (dispatch's own
 * built-bundle client now owns the look entirely), and the retained key is the sole re-adoption
 * fingerprint left once the theme JSON marker is gone.
 * @remarks `tmux -u` states the client's UTF-8 mode explicitly instead of letting tmux derive it
 * from `LANG`/`LC_ALL`/`LC_CTYPE`. This client inherits the backend's environment, and a
 * launchd-started dispatch gets a minimal one with no locale set at all — a non-UTF-8 tmux client
 * substitutes `_` for every non-ASCII cell as it writes to the pty, so `⏺`, em dashes and box
 * drawing arrive at the browser already destroyed, with a correct pane behind them (`capture-pane`
 * stays clean, which is why no pane-content probe can see this). `-u` is preferred over injecting a
 * synthetic `LANG` into the spawn env because it scopes the assertion to the attaching client and
 * leaves the environment the `claude` process itself sees untouched.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
async function spawnTtyd(session: string, sessionId: string): Promise<number> {
  const child = spawn(
    "ttyd",
    [
      "-W",
      "-i",
      "127.0.0.1",
      "-p",
      "0",
      "-b",
      `/sessions/${sessionId}/terminal`,
      "-t",
      "disableLeaveAlert=true",
      "-t",
      `${TTYD_RUNTIME_REVISION_RETAINED_KEY}=1`,
      "tmux",
      "-u",
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
 * Fingerprint (RESEARCH Probe 2/3): match iff basename(argv[0]) === "ttyd" AND the command has
 * argv "tmux" + "attach", OR Dispatch's exact current revision marker, OR Dispatch's
 * `-b /sessions/<sessionId>/terminal` base path. The basename check excludes the backend's own
 * node/ps/shell commands that merely mention "ttyd" (Pitfall 1); a generic full-command-line
 * substring match would self-match the backend (Pitfall 2), so only exact fixed markers are
 * accepted. Own pid/ppid are skipped explicitly.
 * @remarks The base-path arm exists because the other two both miss a leaked pre-2.7.0 ttyd: its
 * multi-KB theme JSON fills ttyd's proctitle buffer so the trailing `tmux attach` is dropped from
 * `ps` entirely, and its revision marker is by definition not the current one. Such a process was
 * neither swept nor adopted and leaked across every restart forever — see `DSP_BASE_PATH_RE`.
 * @remarks TERM-01 / RESIL-01 orphan sweep: keep every arm EXACT — a loose arm over-matches a
 * non-dsp ttyd/user process (denial of service). Widen the SWEEP arms only when a real ownership
 * token is provably missed; `compatible` (re-adoption) may only ever narrow. SECURITY: callers
 * report the COUNT only — never these PIDs or any argv (T-04-04 precedent).
 * @remarks A `ps` failure is tolerated (empty sets, never crashes boot) but is LOUD: silently
 * returning empty disables sweep and re-adoption wholesale, which is indistinguishable from a
 * clean machine and was how the leak above stayed invisible.
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
 * `hasCurrentRevision` now matches ONLY the retained-key token (`-t
 * DISPATCH_TTYD_REVISION_<N>=1`) — with the flag gone there is one argv shape, so the flag-OFF
 * JSON theme marker this used to also match no longer exists. A ttyd spawned by an older dispatch
 * build (pre-retirement, still carrying the JSON marker) therefore falls out of `compatible`: it
 * stays a sweep candidate via the unchanged `tmux`+`attach` fingerprint, gets killed on boot, and
 * the panel fresh-spawns a current-shape ttyd in its place. That one-time degradation on the first
 * restart after this ships is deliberate, not a bug — narrowing a re-adoption fingerprint may only
 * decline adoption, never widen it.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
async function scanDspTtydProcesses(): Promise<{
  candidates: Set<number>;
  compatible: Set<number>;
}> {
  let out: string;
  try {
    ({ stdout: out } = await execFileP("ps", ["-axww", "-o", "pid=,command="], {
      maxBuffer: PS_MAX_BUFFER,
    }));
  } catch (err) {
    console.error(
      "[ttyd] process scan failed — orphan sweep and re-adoption skipped this pass:",
      err instanceof Error ? err.message : String(err),
    );
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
    const hasCurrentRevision = REVISION_RETAINED_KEY_RE.test(m[2]);
    if (
      !(argv.includes("tmux") && argv.includes("attach")) &&
      !hasCurrentRevision &&
      !DSP_BASE_PATH_RE.test(m[2])
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
