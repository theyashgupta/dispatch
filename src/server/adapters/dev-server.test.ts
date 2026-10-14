import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listeningPortsBySession } from "./dev-server.js";

let binDir = "";
let previousPath: string | undefined;

function shim(name: string, body: string): void {
  const file = path.join(binDir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

beforeEach(() => {
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-server-shim-"));
  previousPath = process.env.PATH;
  process.env.PATH = binDir;
});

afterEach(() => {
  process.env.PATH = previousPath;
  fs.rmSync(binDir, { recursive: true, force: true });
});

void test("listeningPortsBySession maps a grandchild's port to the session whose pane pid is its grandparent", async () => {
  shim(
    "ps",
    `printf '    1     0\\n  100     1\\n  101   100\\n  102   101\\n  200     1\\n  201   200\\n  900     1\\n'`,
  );
  shim(
    "lsof",
    `printf '%s\\n' "$*" > "${path.join(binDir, "lsof-args")}"
printf 'p102\\nn127.0.0.1:3000\\nn[::1]:3000\\np201\\nn*:4000\\np900\\nn*:5000\\n'`,
  );

  const result = await listeningPortsBySession(
    new Map([
      ["a", [100]],
      ["b", [200]],
    ]),
  );

  assert.deepEqual(
    result,
    new Map([
      [
        "a",
        [
          {
            port: 3000,
            probeHosts: ["127.0.0.1", "::1"],
            pid: 102,
            bindAddress: "127.0.0.1",
          },
        ],
      ],
      [
        "b",
        [
          {
            port: 4000,
            probeHosts: ["127.0.0.1", "::1"],
            pid: 201,
            bindAddress: "*",
          },
        ],
      ],
    ]),
  );
  assert.equal(
    fs.readFileSync(path.join(binDir, "lsof-args"), "utf8").trim(),
    "-a -nP -p 100,101,102,200,201 -iTCP -sTCP:LISTEN -Fpn",
  );
});

void test("listeningPortsBySession returns null when the ps read fails", async () => {
  shim("ps", "exit 1");
  shim("lsof", `printf 'p100\\nn*:3000\\n'`);

  assert.equal(await listeningPortsBySession(new Map([["a", [100]]])), null);
});

void test("listeningPortsBySession returns an empty map without calling ps for no panes", async () => {
  const marker = path.join(binDir, "ps-called");
  shim("ps", `: > "${marker}"`);

  assert.deepEqual(await listeningPortsBySession(new Map()), new Map());
  assert.equal(fs.existsSync(marker), false);
});
