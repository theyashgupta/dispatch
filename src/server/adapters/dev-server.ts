import { run } from "./exec.js";

/**
 * Every listening TCP port owned by each named session's process tree, keyed by session name —
 * an entry for EVERY key in `panePids`, deduplicated and sorted ascending. Read-only diagnostic
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
 * call. The pane pid IS the `claude` process (`newSession` launches `commandArgv` directly with
 * no interposed shell, `services/orchestration/steps.ts`), so the BFS root needs no shell-hop
 * skip.
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
): Promise<Map<string, number[]> | null> {
  if (panePids.size === 0) return new Map();

  let psOut: string;
  try {
    ({ stdout: psOut } = await run("ps", ["-axo", "pid=,ppid="]));
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

  const result = new Map<string, number[]>();
  for (const session of panePids.keys()) result.set(session, []);
  if (allPids.length === 0) return result;

  let lsofOut: string;
  try {
    ({ stdout: lsofOut } = await run("lsof", [
      "-a",
      "-nP",
      "-p",
      allPids.join(","),
      "-iTCP",
      "-sTCP:LISTEN",
      "-Fpn",
    ]));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "number") {
      lsofOut = ((err as { stdout?: string }).stdout as string) ?? "";
    } else {
      return null;
    }
  }

  let currentPid: number | null = null;
  for (const line of lsofOut.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith("n") && currentPid !== null) {
      const m = line.match(/:(\d+)$/);
      if (!m) continue;
      const session = sessionOfPid.get(currentPid);
      if (session == null) continue;
      result.get(session)?.push(Number(m[1]));
    }
  }

  for (const [session, ports] of result) {
    result.set(
      session,
      [...new Set(ports)].sort((a, b) => a - b),
    );
  }
  return result;
}
