import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { run } from "../adapters/exec.js";
import { runManualScript, shipPreflight } from "./orchestrator-client.js";

const SANDBOX_URL = process.env.DISPATCH_SANDBOX_URL;
const SANDBOX_TOKEN = process.env.DISPATCH_SANDBOX_TOKEN ?? "";
const SANDBOX_BOARD = process.env.DISPATCH_SANDBOX_BOARD ?? "";
const SANDBOX_REPO = process.env.DISPATCH_SANDBOX_REPO ?? "";

describe("orchestrator scripted client", () => {
  it(
    "completes every step of the manual run",
    { skip: !SANDBOX_URL },
    async () => {
      const steps = await runManualScript({
        baseUrl: SANDBOX_URL ?? "",
        token: SANDBOX_TOKEN,
        boardKey: SANDBOX_BOARD,
        repository: SANDBOX_REPO,
      });
      const failed = steps.filter((s) => !s.ok);
      assert.deepEqual(failed, [], JSON.stringify(steps, null, 2));
      assert.ok(steps.length > 0);
    },
  );
});

describe("ship preflight of the scripted client", () => {
  const originalPath = process.env.PATH;
  let root = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "client-preflight-"));
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function repoIn(dir: string, origin: string): Promise<string> {
    const repo = path.join(dir, "repos", "app");
    fs.mkdirSync(repo, { recursive: true });
    await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
    await run("git", ["remote", "add", "origin", origin], { cwd: repo });
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "gh"), "#!/bin/sh\n", {
      mode: 0o755,
    });
    return repo;
  }

  const putFirstOnPath = (dir: string) => {
    process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  };

  it("passes for a local origin and a gh inside the sandbox folder", async () => {
    const box = path.join(root, ".sandbox", "box");
    const repo = await repoIn(box, path.join(box, "origin.git"));
    putFirstOnPath(path.join(box, "bin"));
    assert.equal(await shipPreflight(repo, repo), null);
  });

  it("refuses an origin that is not an absolute path", async () => {
    const box = path.join(root, ".sandbox", "box");
    const repo = await repoIn(box, "git@github.com:acme/app.git");
    putFirstOnPath(path.join(box, "bin"));
    assert.match(
      (await shipPreflight(repo, repo)) ?? "",
      /^origin is not an absolute local path: git@github.com:acme\/app.git$/,
    );
  });

  it("refuses a repository with no origin", async () => {
    const box = path.join(root, ".sandbox", "box");
    const repo = await repoIn(box, "/unused");
    await run("git", ["remote", "remove", "origin"], { cwd: repo });
    putFirstOnPath(path.join(box, "bin"));
    assert.match((await shipPreflight(repo, repo)) ?? "", /no origin remote/);
  });

  it("refuses a gh that resolves outside the sandbox folder", async () => {
    const box = path.join(root, ".sandbox", "box");
    const repo = await repoIn(box, path.join(box, "origin.git"));
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "gh"), "#!/bin/sh\n", { mode: 0o755 });
    putFirstOnPath(outside);
    assert.match((await shipPreflight(repo, repo)) ?? "", /outside/);
  });

  it("refuses a repository that is not inside a .sandbox folder", async () => {
    const repo = await repoIn(root, path.join(root, "origin.git"));
    putFirstOnPath(path.join(root, "bin"));
    assert.match(
      (await shipPreflight(repo, repo)) ?? "",
      /is not inside a \.sandbox folder/,
    );
  });
});
