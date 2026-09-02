import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  REAL_INVALID_CODE_OUTPUT,
  REAL_LOGIN_OUTPUT,
  REAL_LOGIN_URL,
} from "../test-support/claude-transcripts.js";
import { isolateEnv } from "../test-support/fixtures.js";

const hostPath = process.env.PATH ?? "";
const env = isolateEnv();
const login = await import("./claude-login.js");
const { spawnPiped } = await import("./exec.js");
const { resolveBinaryPath } = await import("./resolve-binary.js");

function fakeLoginOutput(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawnPiped(claudePath, ["auth", "login"]);
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      if (out.includes("Invalid code")) {
        child.kill("SIGKILL");
        resolve(out);
      }
    });
    child.stdin?.write("bad\n");
  });
}
const claudePath = path.join(env.binDir, "claude");

const OSC8_ST =
  "If the browser didn't open, visit: \x1b]8;;https://claude.com/x?code=1\x1b\\https://claude.com/x?code=1\x1b]8;;\x1b\\\nPaste code here if prompted > ";
const OSC8_BEL =
  "If the browser didn't open, visit: \x1b]8;;https://claude.com/x?code=1\x07https://claude.com/x?code=1\x1b]8;;\x07\nPaste code here if prompted > ";

void test("extractLoginUrl strips OSC 8 wrappers (BEL or ST terminated) and ignores text without a url", () => {
  assert.equal(login.extractLoginUrl(OSC8_ST), "https://claude.com/x?code=1");
  assert.equal(login.extractLoginUrl(OSC8_BEL), "https://claude.com/x?code=1");
  assert.equal(
    login.extractLoginUrl("visit: https://platform.claude.com/oauth?x=1 now"),
    "https://platform.claude.com/oauth?x=1",
  );
  assert.equal(login.extractLoginUrl("Opening browser to sign in…"), null);
  assert.equal(login.extractLoginUrl("visit: nowhere"), null);
});

void test("the recorded real CLI transcript parses: BEL-terminated OSC 8 url with ?code=true, then the invalid-code line", () => {
  assert.equal(login.extractLoginUrl(REAL_LOGIN_OUTPUT), REAL_LOGIN_URL);
  assert.match(REAL_LOGIN_URL, /\?code=true&/);
  assert.equal(login.hasInvalidCode(REAL_LOGIN_OUTPUT), false);
  assert.equal(login.hasInvalidCode(REAL_INVALID_CODE_OUTPUT), true);
  assert.equal(login.hasAccessDenied(REAL_LOGIN_OUTPUT), false);
});

void test("the fake CLI's login output takes the same parser paths as the real transcript", async () => {
  const output = await fakeLoginOutput();
  assert.equal(
    output.includes("\x1b]8;;"),
    REAL_LOGIN_OUTPUT.includes("\x1b]8;;"),
  );
  assert.equal(output.includes("\x07"), REAL_LOGIN_OUTPUT.includes("\x07"));
  assert.match(
    login.extractLoginUrl(output) ?? "",
    /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/,
  );
  assert.equal(login.hasInvalidCode(output), true);
  assert.equal(login.hasAccessDenied(output), false);
});

void test(
  "real CLI (DISPATCH_REAL_CLAUDE=1): login reaches the url and a bad code is rejected without exiting",
  { skip: !process.env.DISPATCH_REAL_CLAUDE },
  async () => {
    const isolatedPath = process.env.PATH;
    process.env.PATH = hostPath;
    const realClaude = (await resolveBinaryPath("claude")) ?? "claude";
    process.env.PATH = isolatedPath;
    process.env.BROWSER = "/usr/bin/true";
    const dir = loginDir("login-real");
    let url = "";
    let rejected = false;
    const proc = login.spawnClaudeLogin(realClaude, dir, {
      onUrl: (u) => {
        url = u;
        proc.submitCode("not-a-real-code");
      },
      onInvalidCode: () => {
        rejected = true;
        proc.kill();
      },
    });
    const exit = await proc.exited;
    assert.match(
      url,
      /^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&/,
    );
    assert.equal(rejected, true);
    assert.notEqual(exit.code, 0);
    assert.equal(fs.existsSync(path.join(dir, ".credentials.json")), false);
  },
);

void test("invalid-code and access-denied detection", () => {
  assert.equal(
    login.hasInvalidCode(
      "Invalid code. Please make sure the full code was copied.",
    ),
    true,
  );
  assert.equal(login.hasInvalidCode("Paste code here"), false);
  assert.equal(login.hasAccessDenied("error=access_denied&x"), true);
  assert.equal(login.hasAccessDenied("all good"), false);
});

function loginDir(name: string): string {
  const dir = path.join(env.root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

void test("spawnClaudeLogin surfaces the url, accepts a good code, exits 0", async () => {
  const dir = loginDir("login-good");
  let url = "";
  const proc = login.spawnClaudeLogin(claudePath, dir, {
    onUrl: (u) => {
      url = u;
      proc.submitCode("good");
    },
    onInvalidCode: () => {},
  });
  const exit = await proc.exited;
  assert.equal(exit.code, 0);
  assert.equal(exit.accessDenied, false);
  assert.equal(
    url,
    "https://claude.com/cai/oauth/authorize?code=abc&state=xyz",
  );
  assert.equal(fs.existsSync(path.join(dir, ".fake-login")), true);
});

void test("spawnClaudeLogin reports a rejected code (the CLI re-prompts, the caller kills)", async () => {
  const dir = loginDir("login-bad");
  let rejected = false;
  const proc = login.spawnClaudeLogin(claudePath, dir, {
    onUrl: () => proc.submitCode("bad"),
    onInvalidCode: () => {
      rejected = true;
      proc.kill();
    },
  });
  const exit = await proc.exited;
  assert.equal(rejected, true);
  assert.notEqual(exit.code, 0);
  assert.equal(fs.existsSync(path.join(dir, ".fake-login")), false);
});

void test("kill ends a hung login", async () => {
  const dir = loginDir("login-hang");
  const proc = login.spawnClaudeLogin(claudePath, dir, {
    onUrl: () => {
      proc.submitCode("hang");
      setTimeout(() => proc.kill(), 200);
    },
    onInvalidCode: () => {},
  });
  const exit = await proc.exited;
  assert.notEqual(exit.code, 0);
});

void test.after(() => env.cleanup());
