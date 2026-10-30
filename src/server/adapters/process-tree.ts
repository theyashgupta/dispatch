import { run } from "./exec.js";

/** Parse `ps -axo pid=,ppid=` text into a map from parent pid to child pids. */
export function parseProcessTable(text: string): Map<number, number[]> {
  const childrenOf = new Map<number, number[]>();
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const list = childrenOf.get(ppid) ?? [];
    list.push(pid);
    childrenOf.set(ppid, list);
  }
  return childrenOf;
}

/** Walk breadth first from the roots: roots first, then each level, every pid once. */
export function treeOf(
  childrenOf: Map<number, number[]>,
  roots: number[],
): number[] {
  const visited = new Set<number>();
  const order: number[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (visited.has(pid)) continue;
    visited.add(pid);
    order.push(pid);
    queue.push(...(childrenOf.get(pid) ?? []));
  }
  return order;
}

/** Read the process table, or null when `ps` fails. */
export async function readProcessTable(): Promise<Map<
  number,
  number[]
> | null> {
  try {
    const { stdout } = await run("ps", ["-axo", "pid=,ppid="], {
      timeout: 5000,
    });
    return parseProcessTable(stdout);
  } catch {
    return null;
  }
}

/** Parse a `ps` elapsed time `[[dd-]hh:]mm:ss` into seconds, or null when it does not match. */
export function parseEtime(text: string): number | null {
  const m = text.trim().match(/^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/);
  if (!m) return null;
  const [days, hours, minutes, seconds] = m.slice(1).map(Number);
  return (
    (Number.isNaN(days) ? 0 : days) * 86400 +
    (Number.isNaN(hours) ? 0 : hours) * 3600 +
    minutes * 60 +
    seconds
  );
}

/**
 * Read the elapsed seconds of each live pid, or null when `ps` fails.
 *
 * @remarks `ps` exits 1 when none of the pids exist, which is an empty map and not a failure.
 */
export async function readElapsed(
  pids: number[],
): Promise<Map<number, number> | null> {
  let stdout: string;
  try {
    ({ stdout } = await run("ps", ["-o", "pid=,etime=", "-p", pids.join(",")], {
      timeout: 5000,
    }));
  } catch (err) {
    if ((err as { code?: unknown }).code !== 1) return null;
    stdout = "";
  }
  const elapsed = new Map<number, number>();
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\S+)$/);
    const seconds = m ? parseEtime(m[2]) : null;
    if (m && seconds !== null) elapsed.set(Number(m[1]), seconds);
  }
  return elapsed;
}

export type TreeSignal = "SIGSTOP" | "SIGCONT";

export interface SignalTreeDeps {
  kill: (pid: number, signal: TreeSignal) => void;
  readTable: () => Promise<Map<number, number[]> | null>;
}

/** Whether a pid may be signalled: never pid 0 or 1, the server, or its parent. */
export function signalSafe(pid: number): boolean {
  return pid > 1 && pid !== process.pid && pid !== process.ppid;
}

const DEFAULT_DEPS: SignalTreeDeps = {
  kill: (pid, signal) => process.kill(pid, signal),
  readTable: readProcessTable,
};

/**
 * Send a stop or continue signal to every process under the roots, roots first.
 *
 * @remarks
 * A stop reads the table a second time and signals a process that forked during the first pass.
 * A pid whose signal fails (gone, or not ours) is skipped.
 */
export function signalTree(
  roots: number[],
  signal: TreeSignal,
  deps: SignalTreeDeps = DEFAULT_DEPS,
): Promise<number[] | null> {
  return signalFrom(roots, 0, signal, deps);
}

/**
 * Stop every process two levels or more below the roots: the processes under the pane job.
 *
 * @remarks
 * The pane shell and its job (the pty shim, or claude in an unwrapped pane) keep running,
 * so the shell never sees a stopped job, never takes the terminal and never leaves the pane tty
 * cooked. Under the shim this stops claude and its tool processes.
 */
export function stopBelowJob(
  roots: number[],
  deps: SignalTreeDeps = DEFAULT_DEPS,
): Promise<number[] | null> {
  return signalFrom(roots, 2, "SIGSTOP", deps);
}

function levelAt(
  childrenOf: Map<number, number[]>,
  roots: number[],
  depth: number,
): number[] {
  let level = roots;
  for (let i = 0; i < depth; i++)
    level = level.flatMap((pid) => childrenOf.get(pid) ?? []);
  return level;
}

async function signalFrom(
  roots: number[],
  depth: number,
  signal: TreeSignal,
  deps: SignalTreeDeps,
): Promise<number[] | null> {
  const first = await deps.readTable();
  if (!first) return null;
  const signalled: number[] = [];
  const tried = new Set<number>();
  const send = (pids: number[]): void => {
    for (const pid of pids) {
      if (tried.has(pid) || !signalSafe(pid)) continue;
      tried.add(pid);
      try {
        deps.kill(pid, signal);
        signalled.push(pid);
      } catch {
        continue;
      }
    }
  };
  send(treeOf(first, levelAt(first, roots, depth)));
  if (signal === "SIGSTOP") {
    const second = await deps.readTable();
    if (second) send(treeOf(second, levelAt(second, roots, depth)));
  }
  return signalled;
}
