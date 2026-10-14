import test from "node:test";
import assert from "node:assert/strict";
import { run, spawnPiped } from "./exec.js";
import {
  parseEtime,
  parseProcessTable,
  readElapsed,
  signalTree,
  treeOf,
  type SignalTreeDeps,
} from "./process-tree.js";

const PS_TEXT = `    1     0
  100     1
  101   100
  102   100
  103   101
  200     1
  300   103
  100   103
garbage line
`;

function fakeDeps(
  tables: (Map<number, number[]> | null)[],
  failing: Record<number, string> = {},
): SignalTreeDeps & { calls: [number, string][] } {
  const calls: [number, string][] = [];
  let read = 0;
  return {
    calls,
    readTable: () =>
      Promise.resolve(tables[Math.min(read++, tables.length - 1)]),
    kill: (pid, signal) => {
      calls.push([pid, signal]);
      if (failing[pid]) {
        throw Object.assign(new Error("kill"), { code: failing[pid] });
      }
    },
  };
}

void test("treeOf walks root first, then each level, every pid once", () => {
  const table = parseProcessTable(PS_TEXT);
  assert.deepEqual(table.get(100), [101, 102]);
  assert.deepEqual(treeOf(table, [100]), [100, 101, 102, 103, 300]);
});

void test("signalTree stops root first, then descendants, then a pid seen only in the second read", async () => {
  const first = parseProcessTable("100 1\n101 100\n102 100\n");
  const second = parseProcessTable("100 1\n101 100\n102 100\n150 101\n");
  const deps = fakeDeps([first, second]);
  assert.deepEqual(
    await signalTree([100], "SIGSTOP", deps),
    [100, 101, 102, 150],
  );
  assert.deepEqual(deps.calls, [
    [100, "SIGSTOP"],
    [101, "SIGSTOP"],
    [102, "SIGSTOP"],
    [150, "SIGSTOP"],
  ]);
});

void test("signalTree continues the whole tree once", async () => {
  const table = parseProcessTable("100 1\n101 100\n102 100\n");
  const deps = fakeDeps([table, table]);
  assert.deepEqual(await signalTree([100], "SIGCONT", deps), [100, 101, 102]);
  assert.deepEqual(deps.calls, [
    [100, "SIGCONT"],
    [101, "SIGCONT"],
    [102, "SIGCONT"],
  ]);
});

void test("signalTree reads the table once for a SIGCONT", async () => {
  const table = parseProcessTable("100 1\n101 100\n");
  let reads = 0;
  const deps = fakeDeps([table]);
  const counted = {
    ...deps,
    readTable: () => {
      reads += 1;
      return deps.readTable();
    },
  };
  assert.deepEqual(await signalTree([100], "SIGCONT", counted), [100, 101]);
  assert.equal(reads, 1);
});

void test("signalTree keeps the first-pass pids of a SIGSTOP when the second read fails", async () => {
  const table = parseProcessTable("100 1\n101 100\n");
  const deps = fakeDeps([table, null]);
  assert.deepEqual(await signalTree([100], "SIGSTOP", deps), [100, 101]);
  assert.deepEqual(deps.calls, [
    [100, "SIGSTOP"],
    [101, "SIGSTOP"],
  ]);
});

void test("signalTree skips a gone pid and signals the rest", async () => {
  const table = parseProcessTable("100 1\n101 100\n102 100\n");
  const deps = fakeDeps([table, table], { 101: "ESRCH" });
  assert.deepEqual(await signalTree([100], "SIGSTOP", deps), [100, 102]);
  assert.deepEqual(deps.calls, [
    [100, "SIGSTOP"],
    [101, "SIGSTOP"],
    [102, "SIGSTOP"],
  ]);
});

void test("signalTree skips a pid that fails with EPERM and signals the rest", async () => {
  const table = parseProcessTable("100 1\n101 100\n102 100\n");
  const deps = fakeDeps([table, table], { 101: "EPERM" });
  assert.deepEqual(await signalTree([100], "SIGSTOP", deps), [100, 102]);
  assert.deepEqual(deps.calls, [
    [100, "SIGSTOP"],
    [101, "SIGSTOP"],
    [102, "SIGSTOP"],
  ]);
});

void test("signalTree never signals pid 0, pid 1, the server or its parent", async () => {
  const table = parseProcessTable(
    `100 1\n1 0\n${process.pid} 100\n${process.ppid} 100\n102 100\n`,
  );
  table.set(100, [0, 1, process.pid, process.ppid, 102]);
  const deps = fakeDeps([table, table]);
  assert.deepEqual(await signalTree([100], "SIGSTOP", deps), [100, 102]);
  assert.deepEqual(deps.calls, [
    [100, "SIGSTOP"],
    [102, "SIGSTOP"],
  ]);
});

void test("signalTree returns null and signals nothing when the first table read fails", async () => {
  const deps = fakeDeps([null]);
  assert.equal(await signalTree([100], "SIGSTOP", deps), null);
  assert.deepEqual(deps.calls, []);
});

const stateOf = async (pid: number): Promise<string> =>
  (await run("ps", ["-o", "stat=", "-p", String(pid)])).stdout.trim();

async function childrenOfPid(pid: number): Promise<number[]> {
  const { stdout } = await run("ps", ["-axo", "pid=,ppid="]);
  return parseProcessTable(stdout).get(pid) ?? [];
}

async function stoppedFlags(pids: number[]): Promise<boolean[]> {
  return Promise.all(
    pids.map(async (pid) => (await stateOf(pid)).startsWith("T")),
  );
}

void test("signalTree stops and continues a real process tree", async () => {
  const sh = spawnPiped("sh", ["-c", "sleep 30 & sleep 30 & wait"]);
  const root = sh.pid as number;
  let pids: number[] = [root];
  try {
    const deadline = Date.now() + 3000;
    while ((await childrenOfPid(root)).length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    pids = [root, ...(await childrenOfPid(root))];
    assert.equal(pids.length, 3);

    assert.deepEqual(await signalTree([root], "SIGSTOP"), pids);
    assert.deepEqual(await stoppedFlags(pids), [true, true, true]);

    await signalTree([root], "SIGCONT");
    assert.deepEqual(await stoppedFlags(pids), [false, false, false]);
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGCONT");
        process.kill(pid, "SIGKILL");
      } catch {
        continue;
      }
    }
  }
});

void test("parseEtime reads mm:ss, hh:mm:ss and dd-hh:mm:ss into seconds", () => {
  assert.equal(parseEtime("05:07"), 307);
  assert.equal(parseEtime("01:02:03"), 3723);
  assert.equal(parseEtime("2-03:04:05"), 183845);
  assert.equal(parseEtime("  00:09 "), 9);
});

void test("parseEtime answers null for text that is not an elapsed time", () => {
  assert.equal(parseEtime("garbage"), null);
  assert.equal(parseEtime(""), null);
  assert.equal(parseEtime("5"), null);
  assert.equal(parseEtime("2-05:07"), null);
});

void test("readElapsed reads a real process and answers an empty map for a pid that does not exist", async () => {
  const child = spawnPiped("sleep", ["30"]);
  const pid = child.pid as number;
  const done = spawnPiped("true", []);
  const gone = done.pid as number;
  await new Promise((resolve) => done.once("exit", resolve));
  try {
    const elapsed = await readElapsed([pid, gone]);
    assert.deepEqual([...(elapsed?.keys() ?? [])], [pid]);
    assert.ok((elapsed?.get(pid) ?? 99) < 5);
    assert.deepEqual(await readElapsed([gone]), new Map());
  } finally {
    child.kill("SIGKILL");
  }
});
