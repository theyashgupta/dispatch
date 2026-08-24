import { run } from "./exec.js";

/**
 * Bind addresses a `http://localhost:<port>` link actually reaches, mapped to the loopback host(s)
 * a reachability probe for that bind must dial.
 *
 * @remarks
 * Membership is the badge gate: the preview badge asserts reachability and the design has no
 * dead/stale state to fall back on, so a bind this map does not cover must not produce a badge at
 * all. A server bound to a specific LAN address is genuinely NOT reachable at `localhost`, and
 * matching on the port alone would promise otherwise.
 *
 * The VALUE exists because an address family is not interchangeable with the other: a listener
 * bound only to `::1` refuses a `127.0.0.1` connect outright, and since Node 17's `verbatim: true`
 * DNS default `listen(port, "localhost")` binds `::1` first on macOS — the single most common host
 * argument a dev server is given. A probe that assumed IPv4 therefore rejected a server the user
 * can open in the browser and then reported it as "nothing is listening". Probing the family `lsof`
 * actually reported is also strictly narrower than probing both unconditionally: it cannot confirm
 * a card's port via a socket some unrelated process happens to hold on the other family.
 */
const PROBE_HOSTS_FOR_BIND = new Map<string, string[]>([
  ["*", ["127.0.0.1", "::1"]],
  ["0.0.0.0", ["127.0.0.1"]],
  ["127.0.0.1", ["127.0.0.1"]],
  ["localhost", ["127.0.0.1", "::1"]],
  ["[::]", ["::1", "127.0.0.1"]],
  ["[::1]", ["::1"]],
  ["::1", ["::1"]],
]);

/**
 * One discovered listening port plus the loopback host(s) a reachability probe must dial for it,
 * derived from the bind address `lsof` reported rather than assumed to be IPv4. `pid` and
 * `bindAddress` are retained (not newly discovered) from the same parse loop that already builds
 * `probeHosts`.
 * @remarks When more than one `lsof` record maps to the same port (e.g. dual-stack, one listener
 * per family), `pid`/`bindAddress` are chosen by numerically LOWEST pid, tie-broken by the
 * lexicographically smallest raw bind token, never by parse/insertion order: the preview write
 * path is a `JSON.stringify` diff, so an order-dependent pid would rebroadcast the whole board on
 * a tick where nothing actually changed.
 */
export interface DiscoveredPort {
  port: number;
  probeHosts: string[];
  pid: number;
  /** Raw lsof-reported bind token (the `PROBE_HOSTS_FOR_BIND` lookup key), for evidence display. */
  bindAddress: string;
}

/**
 * Every listening TCP port owned by each named session's process tree, keyed by session name —
 * an entry for EVERY key in `panePids`, deduplicated and sorted ascending by port, each carrying
 * the loopback host(s) its `lsof`-reported bind address must be probed on. Read-only diagnostic
 * with a fixed argv array and only `Number()`-parsed integers interpolated (never a shell string,
 * never client input). Goes through the `adapters/exec.ts` chokepoint like every other subprocess
 * caller: `run()` surfaces `.code` alongside `.stdout`, which is all the exit-1 discrimination
 * below needs, so no carve-out is warranted here — and staying on the chokepoint keeps these
 * per-tick calls visible to the `DISPATCH_PERF_EXEC` harness that every optimization claim cites.
 *
 * @remarks
 * Three steps, three subprocess calls TOTAL regardless of session/tree size: (1) one system-wide
 * `ps -axo pid=,ppid=` builds a ppid→children index once; (2) an in-memory BFS from each
 * session's pane pids (visited-set guarded against a malformed/cyclic ppid chain) collects every
 * descendant, attributing each pid to the first session that reaches it; (3) one PID-scoped
 * `lsof -a -p <pids> -iTCP -sTCP:LISTEN -Fpn` resolves the whole pid set's listening ports in one
 * call. The pane pid is the pty shim, or `claude` itself when the shim is absent (`newSession`
 * launches `commandArgv` directly with no interposed SHELL either way,
 * `services/orchestration/steps.ts`); the BFS collects all descendants, so it needs no
 * shell-hop skip in either shape.
 *
 * The literal `-a` is MANDATORY: `lsof`'s `-p` and `-i`/`-s` selectors are ORed by default, so
 * without `-a` the call returns every listening socket on the machine from any process (14
 * unrelated sockets measured on this host during planning) — a card-poisoning false positive.
 *
 * `lsof` exit code 1 is ambiguous and must not be treated as failure: a pid can exit between the
 * `ps` scan and this call, so the ordinary "no listeners" case AND the "one stale pid in the
 * list" case both exit 1 while `stdout` still carries any other pid's valid records. The
 * discriminator is the error shape: a non-zero exit rejects with `typeof err.code === "number"`
 * and a populated `err.stdout` — parse it as a successful result. A spawn failure (`lsof`
 * missing) rejects with `typeof err.code === "string"` (e.g. `"ENOENT"`) — that is the only
 * genuine failure, and returns `null` so the caller leaves prior state untouched rather than
 * clearing it.
 *
 * Sorting is server-side and load-bearing, not cosmetic: the poller's write-skip comparison is a
 * `JSON.stringify` diff, so an unstable port order would write and SSE-broadcast every tick for
 * an unchanged card.
 *
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 */
export async function listeningPortsBySession(
  panePids: Map<string, number[]>,
): Promise<Map<string, DiscoveredPort[]> | null> {
  if (panePids.size === 0) return new Map();

  let psOut: string;
  try {
    ({ stdout: psOut } = await run("ps", ["-axo", "pid=,ppid="], {
      timeout: 5000,
    }));
  } catch {
    return null;
  }

  const childrenOf = new Map<number, number[]>();
  for (const line of psOut.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const list = childrenOf.get(ppid) ?? [];
    list.push(pid);
    childrenOf.set(ppid, list);
  }

  const sessionOfPid = new Map<number, string>();
  const allPids: number[] = [];
  for (const [session, roots] of panePids) {
    const visited = new Set<number>();
    const queue = [...roots];
    while (queue.length > 0) {
      const pid = queue.shift() as number;
      if (visited.has(pid)) continue;
      visited.add(pid);
      if (!sessionOfPid.has(pid)) sessionOfPid.set(pid, session);
      allPids.push(pid);
      queue.push(...(childrenOf.get(pid) ?? []));
    }
  }

  const result = new Map<string, DiscoveredPort[]>();
  for (const session of panePids.keys()) result.set(session, []);
  if (allPids.length === 0) return result;

  let lsofOut: string;
  try {
    ({ stdout: lsofOut } = await run(
      "lsof",
      ["-a", "-nP", "-p", allPids.join(","), "-iTCP", "-sTCP:LISTEN", "-Fpn"],
      { timeout: 5000 },
    ));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number") {
      lsofOut = ((err as { stdout?: string }).stdout as string) ?? "";
    } else {
      return null;
    }
  }

  const hostsByPort = new Map<string, Map<number, Set<string>>>();
  const attribByPort = new Map<
    string,
    Map<number, { pid: number; bindAddress: string }>
  >();
  let currentPid: number | null = null;
  for (const line of lsofOut.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith("n") && currentPid !== null) {
      const m = line.slice(1).match(/^(.*):(\d+)$/);
      if (!m) continue;
      const probeHosts = PROBE_HOSTS_FOR_BIND.get(m[1]);
      if (probeHosts == null) continue;
      const session = sessionOfPid.get(currentPid);
      if (session == null) continue;
      const byPort = hostsByPort.get(session) ?? new Map<number, Set<string>>();
      hostsByPort.set(session, byPort);
      const port = Number(m[2]);
      const hosts = byPort.get(port) ?? new Set<string>();
      for (const host of probeHosts) hosts.add(host);
      byPort.set(port, hosts);

      const bindAddress = m[1];
      const attrib =
        attribByPort.get(session) ??
        new Map<number, { pid: number; bindAddress: string }>();
      attribByPort.set(session, attrib);
      const existing = attrib.get(port);
      if (
        existing == null ||
        currentPid < existing.pid ||
        (currentPid === existing.pid && bindAddress < existing.bindAddress)
      ) {
        attrib.set(port, { pid: currentPid, bindAddress });
      }
    }
  }

  for (const [session, byPort] of hostsByPort) {
    const attrib = attribByPort.get(session);
    result.set(
      session,
      [...byPort.entries()]
        .sort(([a], [b]) => a - b)
        .map(([port, hosts]) => {
          const { pid, bindAddress } = attrib?.get(port) as {
            pid: number;
            bindAddress: string;
          };
          return { port, probeHosts: [...hosts], pid, bindAddress };
        }),
    );
  }
  return result;
}

/**
 * Working directory for each of the given pids, as `lsof` reports it, keyed by pid. Returns an
 * empty Map for an empty input (no subprocess spawned) or on a genuine `lsof` failure, never
 * `null`: this is a cross-check on top of the pane-pid walk, and its own failure must degrade a
 * preview's evidence to `source: "pane ancestry"` only, never touch `previewFailureCounts`, and
 * never clear `previews` (T-99-02).
 * @remarks A GENUINELY SEPARATE `lsof` call from the port scan, never a flag added to it: `-a`
 * ANDs selection options per file descriptor, and no descriptor is both a listening socket and
 * the cwd pseudo-descriptor, so a combined call would exit 0 with zero cwd rows (live-verified,
 * `99-RESEARCH.md` Pitfall 1). The argv array is fixed and `-a` is mandatory here exactly as it
 * is on the port scan: omitting it turned a single-pid query into 884 machine-wide rows when
 * live-probed. The only interpolated values are `Number`-typed pids already held in memory, never
 * a shell string and never client input (T-99-02). Reuses the port scan's exit-code-1-tolerant
 * discriminator verbatim in shape: a pid can exit between the port scan and this call, so a
 * non-zero exit with a numeric `.code` still carries valid `stdout` for the pids that survived.
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 * @public This wave lands the contract only; `adapters/artifact-detect.ts` becomes the consumer
 * in the evidence-assembly plan that follows.
 */
export async function cwdByPids(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;

  let cwdOut: string;
  try {
    ({ stdout: cwdOut } = await run(
      "lsof",
      ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"],
      { timeout: 5000 },
    ));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number") {
      cwdOut = ((err as { stdout?: string }).stdout as string) ?? "";
    } else {
      return result;
    }
  }

  let currentPid: number | null = null;
  for (const line of cwdOut.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith("n") && currentPid !== null) {
      if (!result.has(currentPid)) result.set(currentPid, line.slice(1));
    }
  }
  return result;
}
