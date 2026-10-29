import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "./exec.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "data-dir-test-"));
const throwaway = (pid: number): string =>
  path.join(os.tmpdir(), `dispatch-unisolated-${pid}`);

function labelFor(dir: string): string {
  return `dsp-${createHash("sha256").update(dir).digest("hex").slice(0, 12)}`;
}

/**
 * Import one module in a fresh child process with a fake HOME and answer the named export and the child pid.
 *
 * @remarks Both values are fixed at import time, so only a new process shows them. A blank variable counts as unset for the rule under test.
 */
async function exportInChild<T>(
  file: string,
  name: string,
  overrides: Record<string, string>,
): Promise<{ value: T; pid: number }> {
  const url = pathToFileURL(path.join(repoRoot, file)).href;
  const code = `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify({ value: m[${JSON.stringify(name)}], pid: process.pid }));`;
  const result = await run(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    {
      env: {
        HOME: fakeHome,
        NODE_TEST_CONTEXT: "",
        DISPATCH_DIR: "",
        ...overrides,
      },
      cwd: repoRoot,
    },
  );
  return JSON.parse(result.stdout) as { value: T; pid: number };
}

const dataDir = (overrides: Record<string, string>) =>
  exportInChild<string>(
    "src/server/store/data-dir.ts",
    "DISPATCH_DATA_DIR",
    overrides,
  );

const serverArgs = (overrides: Record<string, string>) =>
  exportInChild<string[]>(
    "src/server/adapters/tmux.ts",
    "TMUX_SERVER_ARGS",
    overrides,
  );

void test("a test-runner process with no DISPATCH_DIR gets a throwaway data folder", async () => {
  const { value, pid } = await dataDir({ NODE_TEST_CONTEXT: "child-v8" });
  assert.equal(value, throwaway(pid));
  assert.notEqual(value, path.join(fakeHome, ".dispatch"));
});

void test("a test-runner process with a blank DISPATCH_DIR gets a throwaway data folder", async () => {
  const { value, pid } = await dataDir({
    NODE_TEST_CONTEXT: "child-v8",
    DISPATCH_DIR: "   ",
  });
  assert.equal(value, throwaway(pid));
});

void test("a test-runner process honours an explicit DISPATCH_DIR", async () => {
  const override = path.join(fakeHome, "explicit", "..", "chosen");
  const { value } = await dataDir({
    NODE_TEST_CONTEXT: "child-v8",
    DISPATCH_DIR: override,
  });
  assert.equal(value, path.resolve(override));
});

void test("a test-runner process deletes its throwaway data folder at exit", async () => {
  const url = pathToFileURL(
    path.join(repoRoot, "src/server/store/data-dir.ts"),
  ).href;
  const code = `import fs from "node:fs"; const m = await import(${JSON.stringify(url)}); fs.mkdirSync(m.DISPATCH_DATA_DIR, { recursive: true }); fs.writeFileSync(m.DISPATCH_DATA_DIR + "/board.db", ""); console.log(m.DISPATCH_DATA_DIR);`;
  const result = await run(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    {
      env: { HOME: fakeHome, NODE_TEST_CONTEXT: "child-v8", DISPATCH_DIR: "" },
      cwd: repoRoot,
    },
  );
  const dir = result.stdout.trim();
  assert.ok(dir.includes("dispatch-unisolated-"));
  assert.equal(fs.existsSync(dir), false);
});

void test("a process outside the test runner with no DISPATCH_DIR uses the home data folder", async () => {
  assert.equal((await dataDir({})).value, path.join(fakeHome, ".dispatch"));
});

void test("a test-runner process with no DISPATCH_DIR gets a private tmux server", async () => {
  const { value, pid } = await serverArgs({ NODE_TEST_CONTEXT: "child-v8" });
  assert.deepEqual(value, ["-L", labelFor(throwaway(pid))]);
});

void test("a process outside the test runner with no DISPATCH_DIR uses the default tmux server", async () => {
  assert.deepEqual((await serverArgs({})).value, []);
});

void test("a DISPATCH_DIR override labels the tmux server from the resolved path", async () => {
  const override = path.join(fakeHome, "other", "..", "instance");
  const { value } = await serverArgs({ DISPATCH_DIR: override });
  assert.deepEqual(value, ["-L", labelFor(path.resolve(override))]);
});

void test.after(() => fs.rmSync(fakeHome, { recursive: true, force: true }));
